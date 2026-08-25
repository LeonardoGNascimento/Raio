# ⚡ raio

Client HTTP desktop (Tauri 2 + React + Rust) — rápido, 100% offline, sem conta, git-friendly.

## Diferenciais

- **Diff entre ambientes**: dispara a mesma request contra dois ambientes (ex. staging vs prod) em paralelo e mostra o diff **estrutural** do JSON — path a path, com adicionados/removidos/alterados. Ideal para validar deploy.
- **Snapshot + diff temporal**: salve a response atual como snapshot (📸). Vira arquivo versionável em `.snapshots/` dentro da collection. Toda execução seguinte mostra o que mudou desde o snapshot — status e body, path a path. Detector de breaking change sem escrever teste.
- **Validação OpenAPI automática**: importe a spec (JSON ou YAML) na collection (botão 📜). Toda response passa a ser validada contra o schema da rota: tipo errado, campo obrigatório ausente, enum inválido, campo não previsto, status não documentado — tudo aparece inline na aba "contrato", com alerta clicável.
- **Collections são arquivos**: cada request vira um arquivo JSON legível em `~/raio-collections/<collection>/`. Versione com git, revise no PR.
- **Import de curl**: cole um comando `curl` (do DevTools, de doc de API) e vire request editável. Suporta `-X`, `-H`, `-d/--data*`, `-u`, `-b`, `-A`, aspas e multiline.
- **Ambientes com `{{var}}`**: interpolação em URL, headers e body, com aviso inline de variável sem valor.
- **Timing real**: TTFB e tempo total medidos no Rust (reqwest), não no webview.
- **Pastas e base URL**: collections têm subpastas; collection e pasta aceitam base URL (botão "base" na sidebar) usada ao criar requests novas.
- **Exportar request**: gera cURL, fetch, axios, TypeScript ou Python da request atual (já interpolada), com copiar.

- **Trace de execução (@raio/trace)**: o raio injeta o header `x-raio-trace: <uuid>` em toda request e sobe um listener local em `http://127.0.0.1:7741`. A lib no seu app (futura `@raio/trace`) só precisa fazer POST dos eventos — a aba "trace" mostra a timeline do código (rota, checks manuais, queries com duração, exceptions com stack), com modo live durante o envio, alerta "exception engolida no servidor" quando a API responde 200 mas quebrou por dentro, e dot vermelho na sidebar. No Diff env, os traces dos dois ambientes aparecem lado a lado com contagem de queries (pega N+1).
- **Histórico por request**: cada envio é gravado em `.history/<request>.json` (últimas 10, para não crescer em disco). Aba "histórico" tem sparkline de latência, restaurar qualquer response com um clique e comparação estrutural entre duas execuções.

### Protocolo do trace (para implementar a lib)

`POST http://127.0.0.1:7741/trace` — pode ser chamado várias vezes durante a request (append):

```json
{
  "trace_id": "<valor do header x-raio-trace>",
  "source": "app local",
  "runtime": "node 20",
  "done": false,
  "events": [
    { "t": 0,  "kind": "route",    "label": "GET /users · entrada de rota", "data": { "query": {} } },
    { "t": 2,  "kind": "check",    "label": "busca-usuario" },
    { "t": 48, "kind": "query",    "label": "SELECT * FROM users", "dur": 34, "data": "-- rows: 3" },
    { "t": 82, "kind": "error",    "label": "TypeError: ...", "at": "services/billing.js:42",
      "stack": ["at loadPlan (services/billing.js:42:18)"] },
    { "t": 103, "kind": "response", "label": "response 200 OK" }
  ]
}
```

`t` = offset em ms desde o início da request. `kind`: `route | check | cache | query | error | response`. Último POST manda `"done": true`. Limites: 500 eventos por trace, 100 traces em memória, body 1MB. O listener só aceita conexões locais (127.0.0.1) — a lib deve ficar desligada em produção.

## Visual

Tema dark warm (design "raio v3 dark" do Claude Design): fundo `#17140f` com gradiente radial, acento âmbar `#e0a63a`, tipografia Bricolage Grotesque (display) + Public Sans (UI) + JetBrains Mono (dados). Layout lado a lado: editor à esquerda, response/diff à direita. Empty state com CTA que cria collection de exemplo (jsonplaceholder).

## Rodar

```bash
npm install
npm run tauri dev      # desenvolvimento
npm run tauri build    # gera binário/AppImage/deb em src-tauri/target/release
```

Dependências de sistema (Ubuntu/Debian): `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`.

## Estrutura

```
src/                  # React (UI)
  components/         # Sidebar, RequestEditor, ResponseViewer, DiffView, modais
  lib/                # curl parser, json diff, interpolação, formatação
src-tauri/src/
  http.rs             # comando send_request (reqwest, rustls, gzip/brotli)
  workspace.rs        # persistência das collections e ambientes em disco
```

## Formato dos arquivos

`~/raio-collections/minha-api/GET _users.json`:

```json
{
  "id": "…",
  "name": "GET /users",
  "method": "GET",
  "url": "{{base}}/users",
  "headers": [["Authorization", "Bearer {{token}}"]],
  "body": "",
  "body_type": "none"
}
```

`~/raio-collections/environments.json`:

```json
[
  { "name": "dev",  "vars": [["base", "https://dev.api.exemplo.com"], ["token", "…"]] },
  { "name": "prod", "vars": [["base", "https://api.exemplo.com"], ["token", "…"]] }
]
```

> Atenção: variáveis ficam em texto plano. Não commite `environments.json` com secrets — adicione ao `.gitignore` do workspace.

## Roadmap (ideias)

- Histórico persistente de responses com busca full-text
- Asserts declarativos por request, rodáveis via CLI no CI
- Secrets via comando externo (`op read`, `aws secretsmanager`)
- Waterfall de timing (DNS/TLS/TTFB) detalhado
