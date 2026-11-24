# Pedizap - Documentação da API

Documentação e coleção de requisições da **API do Pedizap** (plataforma de cardápio digital, pedidos e delivery), disponibilizada em dois formatos complementares:

- **Especificação OpenAPI** ([openapi.json](openapi.json)), gerada a partir da coleção Bruno e renderizada como referência interativa via [Scalar](https://github.com/scalar/scalar) ([index.html](index.html));
- **Coleção Bruno** ([opencollection.yml](opencollection.yml) + pastas de requisições), para explorar e testar os endpoints localmente.

## Estrutura do repositório

```
openapi.json          Especificação OpenAPI 3.0 gerada a partir da coleção (não editar à mão)
index.html            Página que renderiza openapi.json com o Scalar API Reference
opencollection.yml    Metadados da coleção Bruno
scripts/              Geração do openapi.json
environments/          Ambiente(s) da coleção Bruno (variáveis como domain, token, etc.)
<Recurso>/             Uma pasta por recurso da API, cada uma com um folder.yml
                        e um arquivo .yml por requisição
```

Cada pasta de recurso corresponde a uma área da API:

| Pasta | Descrição |
|---|---|
| `OAuth` | Autenticação (obtenção e renovação de token) |
| `Cliente` | Cadastro de clientes |
| `Produto`, `Produto - Sub-Produto`, `Produto - Categoria`, `Produto - Marca`, `Produto - Complemento`, `Produto - Galeria`, `Produto - CSV`, `Produto - Complemento - CSV` | Catálogo de produtos e seus relacionamentos |
| `Pedidos` | Criação, importação (ERP/PDV), consulta, edição e status de pedidos |
| `Tabela de Preço`, `Tabela de Preço - Preços` | Tabelas de preço |
| `Configuração`, `Configuração - Webhook` | Configurações gerais da loja e webhooks |
| `Configuração - Serviço de Entrega`, `... - Periodo`, `... - Zona` | Áreas, períodos e zonas de entrega |
| `Conteúdo`, `Conteúdo - Categoria`, `Conteúdo - Campos Extras`, `Conteúdo - Galeria` | Páginas/conteúdo do cardápio |
| `Galeria de Mídia` | Upload e gestão de mídias |
| `SEO` | Configurações de SEO |

## Visualizando a documentação

Abra [index.html](index.html) em um navegador (ou sirva a pasta com qualquer servidor estático). A página carrega `openapi.json` via Scalar e apresenta a referência interativa da API, com exemplos de requisição/resposta e suporte a testar chamadas diretamente pelo navegador.

```bash
npx serve .
# depois acesse http://localhost:3000
```

## Atualizando a especificação

A coleção Bruno é a fonte da documentação. Altere os `.yml` e gere o `openapi.json` de novo, sem editá-lo à mão:

```bash
npm install
npm run openapi        # grava o openapi.json
npm run openapi:check  # falha se o openapi.json estiver desatualizado
```

Não use o export de OpenAPI do próprio Bruno: ele descarta os exemplos de requisição, sobrescreve requisições com o mesmo método e URL e gera rotas inválidas.

### Formatos do corpo

Na coleção, o corpo de cada requisição pode estar em form-urlencoded, multipart ou JSON: o gerador lê qualquer um. No `openapi.json`, todo corpo sai em JSON (o formato que o Scalar abre) e nos formatos de formulário que a API aceita naquele método:

| Método | Formatos |
|---|---|
| POST | JSON, `multipart/form-data`, `application/x-www-form-urlencoded` |
| PUT | JSON, `application/x-www-form-urlencoded` (no PUT a API ignora multipart) |
| DELETE | JSON |

Nos formatos de formulário, listas e objetos do JSON viram campos com colchetes (`itens[0][sku]`), do jeito que o PHP monta o array. Os campos de upload (`file`, `photo_file`) só aparecem em multipart; se surgir outro, inclua o nome em `CAMPOS_ARQUIVO` no [gerador](scripts/gerar-openapi.js).

### Variações da mesma rota

O OpenAPI não aceita duas operações com o mesmo método e rota, mas a coleção separa variações de uma rota (ex.: `Produto Editar` e `Produto - Imagem Editar`, ambas `PUT /api/produto/{produtoId}`). No `openapi.json` cada requisição continua sendo uma operação própria: a primeira na ordem da coleção fica com a rota, e as outras ganham espaços no fim da chave do path (`"/api/produto/{produtoId} "`, depois `"/api/produto/{produtoId}  "`).

O espaço só separa a variação no Scalar: não aparece no cabeçalho nem no código de exemplo e não chega à API, porque o navegador o descarta ao montar a URL. Não apague esses espaços do `openapi.json` (ele é gerado). Para mudar qual variação fica com a chave sem espaço, mude a ordem (`seq`) no Bruno.

### Ordem do menu

O menu do Scalar segue a ordem da coleção: as pastas e as requisições pelo `seq` do Bruno. Sozinho, o Scalar ordenaria cada grupo pela ordem das chaves em `paths`, que mistura as variações da mesma rota. Por isso o gerador grava em cada tag a ordem das operações (`x-scalar-order`), com o id que o Scalar dá a cada uma. Esse id começa pelo slug do documento (`api-1`), que precisa ser o mesmo no [index.html](index.html) e em `SLUG_DO_DOCUMENTO` no [gerador](scripts/gerar-openapi.js).

### Links entre requisições

Para citar outra requisição na documentação (`docs`), aponte para o arquivo `.yml` dela com caminho relativo ao arquivo atual, com os espaços como `%20`:

```html
<a href="./Produto%20-%20Imagem%20Editar.yml">Produto - Imagem Editar</a>
<a href="../Produto%20-%20Complemento/Complemento%20Detalhe.yml">Complemento Detalhe</a>
```

O link em markdown (`[Complemento Detalhe](../Produto%20-%20Complemento/Complemento%20Detalhe.yml)`) também vale. Na página publicada esse caminho não existe; o gerador troca o link pelo endereço da operação no Scalar (`#tag/produto/PUT/api/produto/{produtoId}`). Se o arquivo não existir (por exemplo, depois de renomear uma requisição), `npm run openapi` falha e diz qual link corrigir.

## Usando a coleção no Bruno

1. Abra o [Bruno](https://www.usebruno.com/) e importe esta pasta como coleção (`opencollection.yml`).
2. Selecione o ambiente `cardapio` (em [environments/cardapio.yml](environments/cardapio.yml)) e configure as variáveis, principalmente:
   - `domain` — domínio da loja (ex.: `minhaloja.pedizap.com.br`)
   - `token` — token de acesso (Bearer)
3. Use a pasta `OAuth` para obter/renovar o token antes de chamar os demais endpoints.

## Autenticação

A forma usual de autenticação é por **chave de API (key)**, gerada pelo próprio usuário no sistema Pedizap e enviada no header `Authorization` das requisições, sem prefixo `Bearer` (o valor do header é a própria chave). Na coleção Bruno, isso é feito através da variável de ambiente `token`.

A pasta `OAuth` (login com e-mail/senha via `jwtlogin` e renovação via `jwtrefreshtoken`) é um fluxo à parte, usado apenas por integrações administrativas específicas — não é o método usado pela maioria dos clientes da API.
