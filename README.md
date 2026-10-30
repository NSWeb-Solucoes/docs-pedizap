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
| `Produto`, `Produto - Categoria`, `Produto - Marca`, `Produto - Complemento`, `Produto - Galeria`, `Produto - CSV`, `Produto - Complemento - CSV` | Catálogo de produtos e seus relacionamentos |
| `Pedidos` | Criação, consulta, edição e status de pedidos |
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

## Usando a coleção no Bruno

1. Abra o [Bruno](https://www.usebruno.com/) e importe esta pasta como coleção (`opencollection.yml`).
2. Selecione o ambiente `cardapio` (em [environments/cardapio.yml](environments/cardapio.yml)) e configure as variáveis, principalmente:
   - `domain` — domínio da loja (ex.: `minhaloja.pedizap.com.br`)
   - `token` — token de acesso (Bearer)
3. Use a pasta `OAuth` para obter/renovar o token antes de chamar os demais endpoints.

## Autenticação

A forma usual de autenticação é por **chave de API (key)**, gerada pelo próprio usuário no sistema Pedizap e enviada no header `Authorization` das requisições, sem prefixo `Bearer` (o valor do header é a própria chave). Na coleção Bruno, isso é feito através da variável de ambiente `token`.

A pasta `OAuth` (login com e-mail/senha via `jwtlogin` e renovação via `jwtrefreshtoken`) é um fluxo à parte, usado apenas por integrações administrativas específicas — não é o método usado pela maioria dos clientes da API.
