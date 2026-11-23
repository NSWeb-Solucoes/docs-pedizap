#!/usr/bin/env node
// Gera o openapi.json a partir da colecao Bruno, que e a fonte unica da documentacao.
//
//   npm run openapi          grava o openapi.json
//   npm run openapi:check    falha se o openapi.json estiver desatualizado

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'openapi.json');
const DOMINIO_PADRAO = 'minhaloja.pedizap.com.br';

const PASTAS_IGNORADAS = new Set(['environments', 'node_modules', 'scripts']);
const HEADERS_PADRAO = new Set(['accept', 'authorization', 'content-type']);

const JSON_ = 'application/json';
const MULTIPART = 'multipart/form-data';
const URLENCODED = 'application/x-www-form-urlencoded';

const MEDIA_TYPES = {
  json: JSON_,
  'form-urlencoded': URLENCODED,
  'multipart-form': MULTIPART,
  text: 'text/plain',
  xml: 'application/xml'
};

// O corpo de toda requisicao vai nos formatos que a API le naquele metodo, com o JSON primeiro
// (o Scalar abre no primeiro). No nsite, o BaseController mescla o JSON ao $_POST; no PUT o
// PutHandler do ZF1 so interpreta urlencoded (parse_str); no DELETE o PHP nao le formulario.
const FORMATOS_POR_METODO = {
  post: [JSON_, MULTIPART, URLENCODED],
  put: [JSON_, URLENCODED],
  delete: [JSON_]
};

const AVISO_DO_METODO = {
  put: 'No PUT a API lê o corpo em JSON ou `application/x-www-form-urlencoded`: em `multipart/form-data` os campos são ignorados.',
  delete: 'No DELETE a API só lê o corpo em JSON.'
};

// Upload de arquivo binario so existe em multipart/form-data
const CAMPOS_ARQUIVO = new Set(['file', 'photo_file']);

const lerYaml = (arquivo) => YAML.parse(fs.readFileSync(arquivo, 'utf8'));

const porSeq = (a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.nome.localeCompare(b.nome, 'pt-BR');

const slug = (texto) => String(texto)
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'exemplo';

const chaveUnica = (mapa, base) => {
  let chave = base;
  for (let n = 2; Object.hasOwn(mapa, chave); n++) chave = `${base}_${n}`;
  return chave;
};

// Valor utilizavel como exemplo: vazio e variavel do Bruno ({{x}}) nao dizem nada para quem le a doc
const valorOuNada = (valor) => {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const texto = String(valor);
  return texto.includes('{{') ? undefined : texto;
};

const interpretar = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
};

const normalizarRota = (url) => url
  .split('?')[0]
  .replace(/^\{\{proto\}\}:\/\/\{\{domain\}\}/, '')
  .replace(/:(\w+)/g, '{$1}')
  .replace(/\{\{(\w+)\}\}/g, '{$1}')
  .replace(/\/+$/, '') || '/';

const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);

// Formulario nao tem lista nem objeto: o PHP monta o array a partir dos colchetes (itens[0][sku]).
// Segue o http_build_query: true/false viram 1/0 e null fica de fora.
function achatarValor(valor, prefixo = '', saida = {}) {
  for (const [chave, item] of Object.entries(valor)) {
    const nome = prefixo ? `${prefixo}[${chave}]` : chave;
    if (item === null || item === undefined) continue;
    if (typeof item === 'object') achatarValor(item, nome, saida);
    else saida[nome] = typeof item === 'boolean' ? (item ? '1' : '0') : String(item);
  }

  return saida;
}

function achatarSchema(propriedades, prefixo = '', saida = {}) {
  for (const [chave, schema] of Object.entries(propriedades)) {
    const nome = prefixo ? `${prefixo}[${chave}]` : chave;
    if (schema.type === 'object' && schema.properties) achatarSchema(schema.properties, nome, saida);
    else if (schema.type === 'array') achatarSchema({ 0: schema.items }, nome, saida);
    else saida[nome] = schema;
  }

  return saida;
}

const inferirSchema = (valor) => {
  if (valor === null) return { type: 'string', nullable: true };
  if (Array.isArray(valor)) return { type: 'array', items: valor.length ? inferirSchema(valor[0]) : { type: 'string' } };
  if (typeof valor === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, inferirSchema(v)])) };
  }
  return { type: ['number', 'boolean'].includes(typeof valor) ? typeof valor : 'string' };
};

function carregarRequisicoes(pasta, tag) {
  const dir = path.join(RAIZ, pasta);

  return fs.readdirSync(dir, { recursive: true })
    .filter((arquivo) => arquivo.endsWith('.yml') && path.basename(arquivo) !== 'folder.yml')
    .map((arquivo) => {
      const item = lerYaml(path.join(dir, arquivo));
      return { ...item, nome: item.info.name, seq: item.info.seq, tag, relativo: path.join(pasta, arquivo) };
    })
    .sort(porSeq);
}

function carregarColecao() {
  return fs.readdirSync(RAIZ, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !PASTAS_IGNORADAS.has(e.name))
    .map((e) => {
      const arquivo = path.join(RAIZ, e.name, 'folder.yml');
      const info = fs.existsSync(arquivo) ? lerYaml(arquivo).info : {};
      return { nome: info.name ?? e.name, seq: info.seq, dir: e.name };
    })
    .sort(porSeq)
    .map((pasta) => ({ ...pasta, requisicoes: carregarRequisicoes(pasta.dir, pasta.nome) }));
}

function adicionarParametro(op, nome, local, { descricao, valor }) {
  const chave = `${local}:${nome}`;

  // Exemplo antigo pode citar um trecho que nao existe mais na rota
  if (local === 'path' && !op.parametros[chave]) return;

  op.parametros[chave] ??= { nome, local };

  const parametro = op.parametros[chave];
  if (descricao) parametro.descricao ??= String(descricao);
  parametro.exemplo ??= valorOuNada(valor);
}

function montarParametro({ nome, local, descricao, exemplo }) {
  const parametro = { name: nome, in: local, required: local === 'path', schema: { type: 'string' } };
  if (descricao) parametro.description = descricao;
  if (exemplo !== undefined) parametro.example = exemplo;

  return parametro;
}

const consultaDe = (params = []) => params
  .filter((p) => p.type === 'query' && !p.disabled && valorOuNada(p.value) !== undefined)
  .map((p) => `${p.name}=${p.value}`);

// O Scalar nao troca o codigo da requisicao junto com o exemplo de resposta.
// Quando a busca do exemplo difere da requisicao base, ela vai na descricao, ao lado da resposta.
// Cada filtro fica em uma linha: dentro da URL ele seria cortado no painel estreito.
function requisicaoDoExemplo(metodo, rota, consulta) {
  const linhas = [`curl 'https://${DOMINIO_PADRAO}${rota}'`];

  if (metodo !== 'GET') linhas.push(`--request ${metodo}`);
  for (const filtro of consulta) linhas.push(`--url-query '${filtro.replace(/'/g, "'\\''")}'`);
  linhas.push("--header 'Authorization: SUA_CHAVE'");

  return ['**Requisição deste exemplo:**', '', '```bash', linhas.join(' \\\n  '), '```'].join('\n');
}

// Junta os campos e exemplos de todas as variantes da operacao, venham de formulario ou de JSON.
// O requestBody so e montado no fim, em cada formato aceito pelo metodo (montarCorpo).
function adicionarCorpo(op, body, rotulo) {
  if (!body?.data?.length) return;

  const corpo = (op.corpo ??= { propriedades: {}, arquivos: {}, exemplos: {} });

  let valor;
  if (Array.isArray(body.data)) {
    const campos = [];

    for (const campo of body.data) {
      const schema = { type: 'string' };
      if (campo.description) schema.description = String(campo.description);

      if (body.type === 'multipart-form' && CAMPOS_ARQUIVO.has(campo.name)) {
        corpo.arquivos[campo.name] ??= { ...schema, format: 'binary' };
        continue;
      }

      const exemplo = valorOuNada(campo.value);
      if (exemplo !== undefined) schema.example = exemplo;
      corpo.propriedades[campo.name] ??= schema;
      if (exemplo !== undefined && !campo.disabled) campos.push([campo.name, exemplo]);
    }

    if (!campos.length) return;
    valor = Object.fromEntries(campos);
  } else {
    valor = interpretar(body.data);
    if (ehObjeto(valor)) {
      for (const [chave, schema] of Object.entries(inferirSchema(valor).properties)) corpo.propriedades[chave] ??= schema;
    }
  }

  // Exemplos 200 e 401 da mesma requisicao costumam repetir o corpo: mostra so uma vez
  const serializado = JSON.stringify(valor);
  if (Object.values(corpo.exemplos).some((e) => JSON.stringify(e.value) === serializado)) return;

  corpo.exemplos[chaveUnica(corpo.exemplos, slug(rotulo))] = { summary: rotulo, value: valor };
}

function descreverCorpo(metodo, propriedadesForm, arquivos, formatos) {
  const avisos = [];
  if (AVISO_DO_METODO[metodo]) avisos.push(AVISO_DO_METODO[metodo]);

  const aninhado = Object.keys(propriedadesForm).find((nome) => nome.includes('['));
  if (aninhado && formatos.length > 1) {
    avisos.push(`Nos formatos de formulário, listas e objetos vão com colchetes (\`${aninhado}\`) e \`true\`/\`false\` viram \`1\`/\`0\`.`);
  }

  const nomesArquivo = Object.keys(arquivos);
  if (nomesArquivo.length && formatos.includes(MULTIPART)) {
    const lista = nomesArquivo.map((nome) => `\`${nome}\``).join(', ');
    avisos.push(`O arquivo (${lista}) só vai em \`multipart/form-data\`.`);
  }

  return avisos.join('\n\n');
}

function montarCorpo(corpo, metodo) {
  const formatos = FORMATOS_POR_METODO[metodo] ?? [JSON_];
  const propriedadesForm = achatarSchema(corpo.propriedades);
  const content = {};

  for (const formato of formatos) {
    const formulario = formato !== JSON_;
    const propriedades = formulario ? { ...propriedadesForm } : corpo.propriedades;
    if (formato === MULTIPART) Object.assign(propriedades, corpo.arquivos);

    const exemplos = {};
    for (const [chave, { summary, value }] of Object.entries(corpo.exemplos)) {
      if (!formulario) exemplos[chave] = { summary, value };
      else if (ehObjeto(value)) exemplos[chave] = { summary, value: achatarValor(value) };
    }

    if (!Object.keys(propriedades).length && !Object.keys(exemplos).length) continue;

    content[formato] = {
      schema: { type: 'object', properties: propriedades },
      ...(Object.keys(exemplos).length && { examples: exemplos })
    };
  }

  const descricao = descreverCorpo(metodo, propriedadesForm, corpo.arquivos, Object.keys(content));

  return {
    required: true,
    ...(descricao && { description: descricao }),
    content
  };
}

function adicionarResposta(op, exemplo, rotulo, requisicao) {
  const resposta = exemplo.response ?? {};
  const status = String(resposta.status ?? 200);
  const destino = (op.responses[status] ??= { description: resposta.statusText || status });

  // Sem corpo (204 e afins) o status documentado ja e a resposta completa
  const corpo = resposta.body?.data;
  if (!corpo) return;

  const header = resposta.headers?.find((h) => h.name.toLowerCase() === 'content-type');
  const mediaType = header?.value ?? MEDIA_TYPES[resposta.body.type] ?? 'text/plain';
  const exemplos = ((destino.content ??= {})[mediaType] ??= { examples: {} }).examples;

  const entrada = { summary: rotulo, value: interpretar(corpo) };
  const descricao = [exemplo.description, requisicao].filter(Boolean).join('\n\n');
  if (descricao) entrada.description = descricao;
  exemplos[chaveUnica(exemplos, slug(rotulo))] = entrada;
}

const avisoDoFragmento = (metodo, rota, fragmento) => `> O \`#${fragmento}\` no endereço só separa esta variação de `
  + `\`${metodo.toUpperCase()} ${rota}\` na documentação: não faz parte da URL e não é enviado à API.`;

function montarOperacao(metodo, rota, { nome, http, examples = [], docs, tag, relativo }, fragmento) {
  const op = { parametros: {}, responses: {}, corpo: null };

  for (const [, parametro] of rota.matchAll(/\{(\w+)\}/g)) {
    op.parametros[`path:${parametro}`] = { nome: parametro, local: 'path' };
  }

  const consultaBase = consultaDe(http.params);

  for (const p of http.params ?? []) {
    adicionarParametro(op, p.name, p.type, { descricao: p.description, valor: p.disabled ? undefined : p.value });
  }

  for (const h of http.headers ?? []) {
    if (!HEADERS_PADRAO.has(h.name.toLowerCase())) adicionarParametro(op, h.name, 'header', { valor: h.value });
  }

  adicionarCorpo(op, http.body, nome);

  for (const exemplo of examples) {
    const consulta = consultaDe(exemplo.request?.params);
    const mudou = exemplo.request && consulta.join('&') !== consultaBase.join('&');
    const requisicao = mudou ? requisicaoDoExemplo(http.method, rota, consulta) : null;

    adicionarResposta(op, exemplo, exemplo.name, requisicao);
    adicionarCorpo(op, exemplo.request?.body, exemplo.name);
  }

  const descricao = [fragmento && avisoDoFragmento(metodo, rota, fragmento), docs].filter(Boolean).join('\n\n');
  const usaChave = http.headers?.some((h) => h.name.toLowerCase() === 'authorization');

  return {
    summary: nome,
    operationId: slug(relativo.replace(/\.yml$/, '')),
    tags: [tag],
    ...(descricao && { description: descricao }),
    ...(!usaChave && { security: [] }),
    parameters: Object.values(op.parametros).map(montarParametro),
    ...(op.corpo && { requestBody: montarCorpo(op.corpo, metodo) }),
    responses: Object.keys(op.responses).length ? op.responses : { 200: { description: 'OK' } }
  };
}

const fragmentoDe = (texto) => String(texto)
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// O que o nome da variante tem a mais que o da base: "Produto Editar Imagem" -> "imagem"
function fragmentoDaVariante(base, variante) {
  const palavrasBase = base.split(/\s+/);
  const palavras = variante.split(/\s+/);
  let comum = 0;
  while (comum < palavras.length - 1 && palavras[comum] === palavrasBase[comum]) comum++;

  return fragmentoDe(palavras.slice(comum).join(' ')) || 'variacao';
}

// O OpenAPI nao aceita duas operacoes com o mesmo metodo e rota, mas a colecao separa variacoes
// de uma rota (ex: Produto Editar Imagem). A primeira requisicao fica com a rota e cada uma das
// outras ganha um fragmento na chave do path (/api/produto/{produtoId}#imagem), o que basta para o
// Scalar lista-la separada. O fragmento nunca chega a API: o navegador, o proxy do Scalar, o curl
// e o Guzzle o descartam ao montar a requisicao.
function fragmentosDasVariantes(requisicoes) {
  const grupos = Map.groupBy(requisicoes, (r) => `${r.http.method.toLowerCase()} ${normalizarRota(r.http.url)}`);
  const fragmentos = new Map();

  for (const [base, ...variantes] of grupos.values()) {
    const usados = new Set();

    for (const variante of variantes) {
      const sugerido = fragmentoDaVariante(base.nome, variante.nome);
      let fragmento = sugerido;
      for (let n = 2; usados.has(fragmento); n++) fragmento = `${sugerido}-${n}`;

      usados.add(fragmento);
      fragmentos.set(variante, fragmento);
    }
  }

  return fragmentos;
}

function tituloDaColecao() {
  const arquivo = path.join(RAIZ, 'opencollection.yml');
  return fs.existsSync(arquivo) ? lerYaml(arquivo).info.name : 'Pedizap - API';
}

function gerarOpenApi() {
  const pastas = carregarColecao();
  const requisicoes = pastas.flatMap((pasta) => pasta.requisicoes);
  const fragmentos = fragmentosDasVariantes(requisicoes);

  // Na ordem da colecao: o Scalar lista as operacoes na ordem dos paths (e, dentro de um path, por metodo)
  const paths = {};
  for (const requisicao of requisicoes) {
    const metodo = requisicao.http.method.toLowerCase();
    const rota = normalizarRota(requisicao.http.url);
    const fragmento = fragmentos.get(requisicao);

    (paths[fragmento ? `${rota}#${fragmento}` : rota] ??= {})[metodo] = montarOperacao(metodo, rota, requisicao, fragmento);
  }

  return {
    openapi: '3.0.3',
    info: { title: tituloDaColecao(), version: '1.0.0' },
    servers: [{
      url: '{proto}://{domain}',
      variables: {
        proto: { default: 'https', enum: ['https', 'http'] },
        domain: { default: DOMINIO_PADRAO, description: 'Domínio da loja' }
      }
    }],
    security: [{ chaveApi: [] }],
    tags: pastas.map((pasta) => ({ name: pasta.nome })),
    paths,
    components: {
      securitySchemes: {
        chaveApi: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Chave de API gerada no sistema Pedizap, enviada sem o prefixo Bearer.'
        }
      }
    }
  };
}

const conteudo = `${JSON.stringify(gerarOpenApi(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, 'utf8') : null;

  if (atual !== conteudo) {
    console.error('openapi.json desatualizado. Rode: npm run openapi');
    process.exit(1);
  }

  console.log('openapi.json em dia');
} else {
  fs.writeFileSync(SAIDA, conteudo);
  console.log(`openapi.json gerado (${(Buffer.byteLength(conteudo) / 1024 / 1024).toFixed(2)} MB)`);
}
