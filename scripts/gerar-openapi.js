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
const MEDIA_TYPES = {
  json: 'application/json',
  'form-urlencoded': 'application/x-www-form-urlencoded',
  'multipart-form': 'multipart/form-data',
  text: 'text/plain',
  xml: 'application/xml'
};

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

function adicionarCorpo(op, body, rotulo) {
  if (!body?.data?.length) return;

  op.requestBody ??= { required: true, content: {} };
  const mediaType = MEDIA_TYPES[body.type] ?? 'text/plain';
  const destino = (op.requestBody.content[mediaType] ??= {});

  let valor;
  if (Array.isArray(body.data)) {
    destino.schema ??= { type: 'object', properties: {} };
    const campos = [];

    for (const campo of body.data) {
      const schema = { type: 'string' };
      const exemplo = valorOuNada(campo.value);
      if (campo.description) schema.description = String(campo.description);
      if (exemplo !== undefined) schema.example = exemplo;
      destino.schema.properties[campo.name] ??= schema;
      if (exemplo !== undefined && !campo.disabled) campos.push([campo.name, exemplo]);
    }

    if (!campos.length) return;
    valor = Object.fromEntries(campos);
  } else {
    valor = interpretar(body.data);
    if (typeof valor === 'object') destino.schema ??= inferirSchema(valor);
  }

  // Exemplos 200 e 401 da mesma requisicao costumam repetir o corpo: mostra so uma vez
  const exemplos = (destino.examples ??= {});
  const serializado = JSON.stringify(valor);
  if (Object.values(exemplos).some((e) => JSON.stringify(e.value) === serializado)) return;

  exemplos[chaveUnica(exemplos, slug(rotulo))] = { summary: rotulo, value: valor };
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

// O OpenAPI nao aceita duas operacoes com o mesmo metodo e rota: as requisicoes da colecao
// que caem nesse caso (ex: formas de enviar foto) viram variantes de uma operacao so.
function montarOperacao(rota, variantes) {
  const unificada = variantes.length > 1;
  const op = { parametros: {}, responses: {} };

  for (const [, nome] of rota.matchAll(/\{(\w+)\}/g)) {
    op.parametros[`path:${nome}`] = { nome, local: 'path' };
  }

  // O nome da requisicao so vai na frente do exemplo quando dois exemplos teriam o mesmo nome
  const nomes = variantes.flatMap((v) => (v.examples ?? []).map((e) => e.name));
  const repetidos = new Set(nomes.filter((nome, i) => nomes.indexOf(nome) !== i));

  for (const { nome, http, examples = [] } of variantes) {
    const consultaBase = consultaDe(http.params);

    for (const p of http.params ?? []) {
      adicionarParametro(op, p.name, p.type, { descricao: p.description, valor: p.disabled ? undefined : p.value });
    }

    for (const h of http.headers ?? []) {
      if (!HEADERS_PADRAO.has(h.name.toLowerCase())) adicionarParametro(op, h.name, 'header', { valor: h.value });
    }

    adicionarCorpo(op, http.body, nome);

    for (const exemplo of examples) {
      const rotulo = repetidos.has(exemplo.name) ? `${nome}: ${exemplo.name}` : exemplo.name;
      const consulta = consultaDe(exemplo.request?.params);
      const mudou = exemplo.request && consulta.join('&') !== consultaBase.join('&');
      const requisicao = mudou ? requisicaoDoExemplo(http.method, rota, consulta) : null;

      adicionarResposta(op, exemplo, rotulo, requisicao);
      adicionarCorpo(op, exemplo.request?.body, rotulo);
    }
  }

  const docs = variantes.filter((v) => v.docs).map((v) => (unificada ? `### ${v.nome}\n\n${v.docs}` : v.docs));
  const usaChave = variantes.some((v) => v.http.headers?.some((h) => h.name.toLowerCase() === 'authorization'));

  return {
    summary: variantes.map((v) => v.nome).join(' / '),
    operationId: slug(variantes[0].relativo.replace(/\.yml$/, '')),
    tags: [...new Set(variantes.map((v) => v.tag))],
    ...(docs.length && { description: docs.join('\n\n') }),
    ...(!usaChave && { security: [] }),
    parameters: Object.values(op.parametros).map(montarParametro),
    ...(op.requestBody && { requestBody: op.requestBody }),
    responses: Object.keys(op.responses).length ? op.responses : { 200: { description: 'OK' } }
  };
}

function tituloDaColecao() {
  const arquivo = path.join(RAIZ, 'opencollection.yml');
  return fs.existsSync(arquivo) ? lerYaml(arquivo).info.name : 'Pedizap - API';
}

function gerarOpenApi() {
  const pastas = carregarColecao();
  const operacoes = new Map();

  for (const requisicao of pastas.flatMap((pasta) => pasta.requisicoes)) {
    const metodo = requisicao.http.method.toLowerCase();
    const rota = normalizarRota(requisicao.http.url);
    const chave = `${metodo} ${rota}`;

    if (!operacoes.has(chave)) operacoes.set(chave, { metodo, rota, variantes: [] });
    operacoes.get(chave).variantes.push(requisicao);
  }

  const paths = {};
  for (const { metodo, rota, variantes } of operacoes.values()) {
    (paths[rota] ??= {})[metodo] = montarOperacao(rota, variantes);
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
