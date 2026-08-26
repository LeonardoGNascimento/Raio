import { useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { Environment, MultipartField, RequestAuth, RequestDef } from "../types";
import { METHOD_CLASS, METHODS } from "../types";
import { missingVars } from "../lib/interpolate";
import { compileZod, parseJsonSchema } from "../lib/contract";
import { handleCodeEditorKeys } from "../lib/codeEditor";
import { expandUrl, pathParamNames } from "../lib/spec";
import { highlightJson } from "../lib/format";
import { CodeArea } from "./CodeArea";
import { VarInput } from "./VarInput";
import { Dropdown } from "./Dropdown";

interface Props {
  crumb: string; // "collection" ou "collection / pasta"
  request: RequestDef;
  env: Environment | null;
  envName: string;
  sending: boolean;
  dirty: boolean;
  diffOn: boolean;
  canDiff: boolean;
  onChange: (req: RequestDef) => void;
  onSend: () => void;
  onCancel: () => void;
  onSave: () => void;
  onToggleDiff: () => void;
  onExport: () => void;
  /** collection tem spec OpenAPI (para o modo herdado) */
  hasSpec: boolean;
  /** nomes dos ambientes da collection (para a vigia por rota) */
  envNames: string[];
  /** salva/edita uma variável no ambiente atual da collection (popover do hover) */
  onSaveVar?: (name: string, value: string) => void;
}

const ZOD_PLACEHOLDER = `z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().email().nullable(),
  items: z.array(z.object({ sku: z.string(), qty: z.number() })),
})`;

const SCHEMA_PLACEHOLDER = `{
  "type": "object",
  "required": ["id", "name"],
  "properties": {
    "id": { "type": "integer" },
    "name": { "type": "string" }
  }
}`;

const BODY_MODES = [
  ["none", "none"],
  ["json", "json"],
  ["text", "text"],
  ["urlencoded", "form-url"],
  ["multipart", "multipart"],
] as const;

type EditorTab = "params" | "auth" | "headers" | "body" | "contrato" | "config";

const AUTH_TYPES = [
  ["none", "sem auth"],
  ["bearer", "bearer"],
  ["basic", "basic"],
  ["apikey", "api key"],
] as const;

/** Select no padrão dos dropdowns do app para escolher tipo (auth/body/contrato). */
function TypeSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  const label = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <Dropdown
      align="right"
      button={() => (
        <button className="env-btn">
          {label} <span className="c-faint">▾</span>
        </button>
      )}
    >
      {(close) => (
        <>
          {options.map(([v, l]) => (
            <button
              key={v}
              className={"dd-item" + (v === value ? " active" : "")}
              onClick={() => {
                close();
                onChange(v);
              }}
            >
              {l}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function RequestEditor(props: Props) {
  const { request, env } = props;
  const set = (patch: Partial<RequestDef>) => props.onChange({ ...request, ...patch });
  const [tab, setTab] = useState<EditorTab>("headers");

  // request nova sem headers cai direto no body quando tem corpo
  useEffect(() => {
    setTab(request.body_type !== "none" && request.headers.length === 0 ? "body" : "headers");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const nameRef = useRef<HTMLInputElement>(null);

  const formatBody = () => {
    try {
      set({ body: JSON.stringify(JSON.parse(request.body), null, 2) });
    } catch {
      alert("Body não é JSON válido — nada formatado.");
    }
  };

  const setHeader = (i: number, key: string, val: string) =>
    set({
      headers: request.headers.map((h, idx) =>
        idx === i ? ([key, val] as [string, string]) : h,
      ),
    });

  const contractMode = request.contract?.type ?? "openapi";
  const setContractMode = (mode: "openapi" | "zod" | "json-schema") => {
    if (mode === "openapi") set({ contract: null });
    else set({ contract: { type: mode, source: request.contract?.source ?? "" } });
  };

  const contractCheck = useMemo(() => {
    const c = request.contract;
    if (!c || !c.source.trim()) return null;
    const result = c.type === "zod" ? compileZod(c.source) : parseJsonSchema(c.source);
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }, [request.contract]);

  const missing = missingVars(
    request.url +
      " " +
      request.headers.map((h) => h.join(" ")).join(" ") +
      " " +
      (request.query ?? []).map((q) => q.join(" ")).join(" ") +
      " " +
      (request.path_params ?? []).map((p) => p[1]).join(" ") +
      " " +
      request.body,
    env,
  );

  const query = request.query ?? [];
  const setQuery = (i: number, key: string, val: string) =>
    set({ query: query.map((q, idx) => (idx === i ? ([key, val] as [string, string]) : q)) });

  const pathNames = pathParamNames(request.url);
  const pathValues = new Map(request.path_params ?? []);
  const setPathParam = (name: string, val: string) => {
    const next = new Map(pathValues);
    next.set(name, val);
    // guarda só os que existem na URL, na ordem detectada
    set({ path_params: pathNames.map((n) => [n, next.get(n) ?? ""] as [string, string]) });
  };

  const bodyType = request.body_type === "form" ? "urlencoded" : request.body_type;
  const auth: RequestAuth = request.auth ?? { type: "none" };
  const setAuth = (patch: Partial<RequestAuth>) => set({ auth: { ...auth, ...patch } });
  const form = request.form ?? [];
  const setForm = (i: number, k: string, v: string) =>
    set({ form: form.map((p, idx) => (idx === i ? ([k, v] as [string, string]) : p)) });
  const multipart = request.multipart ?? [];
  const setPart = (i: number, patch: Partial<MultipartField>) =>
    set({ multipart: multipart.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const opts = request.options ?? {};
  const setOpts = (patch: Partial<NonNullable<RequestDef["options"]>>) =>
    set({ options: { ...opts, ...patch } });

  const pickFile = async (i: number) => {
    try {
      const path = await openFileDialog({ multiple: false, title: "Escolher arquivo" });
      if (typeof path === "string") setPart(i, { value: path });
    } catch {
      /* diálogo cancelado */
    }
  };


  return (
    <div className="editor">
      <div className="ed-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ed-crumb">{props.crumb} /</div>
          <input
            ref={nameRef}
            className="ed-name"
            value={request.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <button className="btn-ghost" onClick={props.onExport}>Exportar</button>
        <button
          className={props.dirty ? "btn-save-dirty" : "btn-save-clean"}
          onClick={props.onSave}
          disabled={!props.dirty}
          title="Ctrl+S"
        >
          {props.dirty ? "Salvar •" : "Salvo"}
        </button>
      </div>

      <div className="url-bar">
        <Dropdown
          button={() => (
            <button className={"method-btn " + (METHOD_CLASS[request.method] ?? "c-dim")}>
              {request.method} <span className="caret">▾</span>
            </button>
          )}
        >
          {(close) => (
            <>
              {METHODS.map((m) => (
                <button
                  key={m}
                  className={"dd-item " + (METHOD_CLASS[m] ?? "c-dim") + (m === request.method ? " active" : "")}
                  style={{ fontWeight: 700 }}
                  onClick={() => {
                    close();
                    set({ method: m });
                  }}
                >
                  {m}
                </button>
              ))}
            </>
          )}
        </Dropdown>
        <VarInput onSaveVar={props.onSaveVar}
          className="url-input"
          placeholder="{{@base}}/rota ou https://api.exemplo.com/rota"
          title={"envia para: " + expandUrl(request, env)}
          value={request.url}
          env={env}
          onChange={(url) => set({ url })}
          onKeyDown={(e) => e.key === "Enter" && props.onSend()}
        />
        {props.sending ? (
          <button
            className="btn-danger-ghost"
            onClick={props.onCancel}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
            title="aborta o envio em andamento"
          >
            Cancelar ✕
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={props.onSend}
            disabled={!request.url}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
            title="Ctrl+Enter"
          >
            Enviar <span style={{ fontSize: 12 }}>↵</span>
          </button>
        )}
      </div>
      {request.url && expandUrl(request, env) !== request.url && (
        <div className="url-tip mono" title="URL final: base, params e variáveis resolvidos">
          <span className="c-faint">→</span> {expandUrl(request, env)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className={"diff-toggle" + (props.diffOn ? " on" : "")}
          onClick={props.onToggleDiff}
          disabled={!props.canDiff}
          title={props.canDiff ? "comparar a mesma request em dois ambientes" : "precisa de 2+ ambientes"}
        >
          <span className="mono">≠</span> Diff env
        </button>
      </div>

      {missing.length > 0 && (
        <div className="var-warn">
          ⚠ variável sem valor em <span style={{ color: "var(--text)" }}>{props.envName || "(nenhum ambiente)"}</span>:{" "}
          {missing.map((v) => `{{${v}}}`).join(", ")}
        </div>
      )}

      <div className="ed-tabs">
        <div className="seg">
          {(["params", "auth", "headers", "body", "contrato", "config"] as EditorTab[]).map(
            (key) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
                {key}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="ed-tab-content">
      {tab === "params" && (
        <div>
          <span className="sect-label" style={{ display: "block", marginBottom: 8 }}>
            query params
          </span>
          {query.map(([k, v], i) => (
            <div key={i} className="hdr-row">
              <VarInput onSaveVar={props.onSaveVar} className="inp key" placeholder="param" value={k} env={env} onChange={(nk) => setQuery(i, nk, v)} />
              <VarInput onSaveVar={props.onSaveVar} className="inp val" placeholder="valor" value={v} env={env} onChange={(nv) => setQuery(i, k, nv)} />
              <button
                className="btn-icon danger"
                onClick={() => set({ query: query.filter((_, idx) => idx !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          {query.length === 0 && (
            <div className="body-empty">nenhum query param — serão anexados à URL no envio</div>
          )}
          <button className="link-btn" onClick={() => set({ query: [...query, ["", ""]] })}>
            + adicionar query param
          </button>

          <span className="sect-label" style={{ display: "block", margin: "18px 0 8px" }}>
            path params
          </span>
          {pathNames.length === 0 ? (
            <div className="body-empty">
              nenhum placeholder na URL — use <span className="mono c-accent">{"{id}"}</span> ou{" "}
              <span className="mono c-accent">/:id</span> na URL para criar path params
            </div>
          ) : (
            pathNames.map((name) => (
              <div key={name} className="hdr-row">
                <span className="inp key mono" style={{ display: "flex", alignItems: "center", color: "var(--accent)" }}>
                  {name}
                </span>
                <VarInput onSaveVar={props.onSaveVar}
                  className="inp val"
                  placeholder="valor"
                  value={pathValues.get(name) ?? ""}
                  env={env}
                  onChange={(v) => setPathParam(name, v)}
                />
              </div>
            ))
          )}

          <div className="trace-onboard-hint" style={{ marginTop: 14 }}>
            URL final: <span className="c-accent" style={{ wordBreak: "break-all" }}>{expandUrl(request, env)}</span>
          </div>
        </div>
      )}

      {tab === "auth" && (
        <div>
          <div className="body-head">
            <span className="sect-label">autenticação da rota</span>
            <div style={{ flex: 1 }} />
            <TypeSelect value={auth.type} options={AUTH_TYPES} onChange={(type) => setAuth({ type })} />
          </div>
          {auth.type === "none" && (
            <div className="body-empty">
              sem autenticação — escolha bearer, basic ou api key acima. Valores aceitam{" "}
              <span className="mono c-accent">{"{{variáveis}}"}</span> do ambiente.
            </div>
          )}
          {auth.type === "bearer" && (
            <div className="hdr-row">
              <span className="inp key mono" style={{ display: "flex", alignItems: "center" }}>token</span>
              <VarInput onSaveVar={props.onSaveVar}
                className="inp val"
                placeholder="{{token}} ou o token direto"
                value={auth.token ?? ""}
                env={env}
                onChange={(token) => setAuth({ token })}
              />
            </div>
          )}
          {auth.type === "basic" && (
            <>
              <div className="hdr-row">
                <span className="inp key mono" style={{ display: "flex", alignItems: "center" }}>usuário</span>
                <VarInput onSaveVar={props.onSaveVar} className="inp val" value={auth.username ?? ""} env={env} onChange={(username) => setAuth({ username })} />
              </div>
              <div className="hdr-row">
                <span className="inp key mono" style={{ display: "flex", alignItems: "center" }}>senha</span>
                <input className="inp val" type="password" value={auth.password ?? ""} onChange={(e) => setAuth({ password: e.target.value })} spellCheck={false} />
              </div>
            </>
          )}
          {auth.type === "apikey" && (
            <>
              <div className="hdr-row">
                <span className="inp key mono" style={{ display: "flex", alignItems: "center" }}>nome</span>
                <VarInput onSaveVar={props.onSaveVar} className="inp val" placeholder="X-Api-Key" value={auth.key ?? ""} env={env} onChange={(key) => setAuth({ key })} />
              </div>
              <div className="hdr-row">
                <span className="inp key mono" style={{ display: "flex", alignItems: "center" }}>valor</span>
                <VarInput onSaveVar={props.onSaveVar} className="inp val" placeholder="{{apikey}}" value={auth.value ?? ""} env={env} onChange={(value) => setAuth({ value })} />
              </div>
              <div className="body-head" style={{ marginTop: 4 }}>
                <span className="sect-label">enviar em</span>
                <div className="seg">
                  {(
                    [
                      ["header", "header"],
                      ["query", "query param"],
                    ] as const
                  ).map(([where, label]) => (
                    <button
                      key={where}
                      className={(auth.in ?? "header") === where ? "active" : ""}
                      onClick={() => setAuth({ in: where })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {auth.type !== "none" && (
            <div className="trace-onboard-hint">
              aplicado no envio sem sobrescrever um header Authorization que você já tenha criado
              manualmente.
            </div>
          )}
        </div>
      )}
      {tab === "headers" && (
        <div>
          {request.headers.map(([k, v], i) => (
            <div key={i} className="hdr-row">
              <VarInput onSaveVar={props.onSaveVar} className="inp key" placeholder="nome" value={k} env={env} onChange={(nk) => setHeader(i, nk, v)} />
              <VarInput onSaveVar={props.onSaveVar} className="inp val" placeholder="valor" value={v} env={env} onChange={(nv) => setHeader(i, k, nv)} />
              <button
                className="btn-icon danger"
                onClick={() => set({ headers: request.headers.filter((_, idx) => idx !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          {request.headers.length === 0 && (
            <div className="body-empty">nenhum header — adicione abaixo</div>
          )}
          <button
            className="link-btn"
            onClick={() => set({ headers: [...request.headers, ["", ""]] })}
          >
            + adicionar header
          </button>
        </div>
      )}

      {tab === "body" && (
        <div>
        <div className="body-head">
          <span className="sect-label">formato</span>
          <div style={{ flex: 1 }} />
          <TypeSelect
            value={bodyType}
            options={BODY_MODES}
            onChange={(t) => {
              const patch: Partial<RequestDef> = { body_type: t };
              if (
                t === "json" &&
                !request.headers.some(([k]) => k.toLowerCase() === "content-type")
              ) {
                patch.headers = [...request.headers, ["Content-Type", "application/json"]];
              }
              set(patch);
            }}
          />
        </div>
        {bodyType === "urlencoded" && (
          <div>
            {form.map(([k, v], i) => (
              <div key={i} className="hdr-row">
                <VarInput onSaveVar={props.onSaveVar} className="inp key" placeholder="campo" value={k} env={env} onChange={(nk) => setForm(i, nk, v)} />
                <VarInput onSaveVar={props.onSaveVar} className="inp val" placeholder="valor" value={v} env={env} onChange={(nv) => setForm(i, k, nv)} />
                <button className="btn-icon danger" onClick={() => set({ form: form.filter((_, idx) => idx !== i) })}>×</button>
              </div>
            ))}
            {form.length === 0 && (
              <div className="body-empty">enviado como application/x-www-form-urlencoded</div>
            )}
            <button className="link-btn" onClick={() => set({ form: [...form, ["", ""]] })}>
              + adicionar campo
            </button>
          </div>
        )}
        {bodyType === "multipart" && (
          <div>
            {multipart.map((p, i) => (
              <div key={i} className="hdr-row">
                <input
                  className="inp key"
                  placeholder="campo"
                  value={p.name}
                  onChange={(e) => setPart(i, { name: e.target.value })}
                />
                <div className="seg" style={{ flexShrink: 0 }}>
                  {(
                    [
                      ["text", "texto"],
                      ["file", "arquivo"],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      className={p.kind === kind ? "active" : ""}
                      onClick={() => setPart(i, { kind, value: "" })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {p.kind === "text" ? (
                  <input
                    className="inp val"
                    placeholder="valor"
                    value={p.value}
                    onChange={(e) => setPart(i, { value: e.target.value })}
                  />
                ) : (
                  <button
                    className="btn-ghost"
                    style={{ flex: 1, justifyContent: "flex-start", overflow: "hidden" }}
                    onClick={() => pickFile(i)}
                    title={p.value || "escolher arquivo"}
                  >
                    {p.value ? p.value.split("/").pop() : "escolher arquivo…"}
                  </button>
                )}
                <button
                  className="btn-icon danger"
                  onClick={() => set({ multipart: multipart.filter((_, idx) => idx !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            {multipart.length === 0 && (
              <div className="body-empty">enviado como multipart/form-data — campos de texto e upload de arquivo</div>
            )}
            <button
              className="link-btn"
              onClick={() => set({ multipart: [...multipart, { name: "", kind: "text", value: "" }] })}
            >
              + adicionar campo
            </button>
          </div>
        )}
        {(bodyType === "json" || bodyType === "text") ? (
          <div className="code-panel">
            <div className="code-panel-head">
              <span className="chip-sq" />
              <span>request.{request.body_type}</span>
              <span className="meta">{new Blob([request.body]).size} bytes</span>
              {request.body_type === "json" && request.body.trim() && (
                <button className="copy-btn" onClick={formatBody} title="formatar JSON (2 espaços)">
                  formatar
                </button>
              )}
            </div>
            {request.body_type === "json" ? (
              <CodeArea
                value={request.body}
                placeholder='{ "chave": "valor" }'
                highlight={highlightJson}
                onChange={(v) => set({ body: v })}
                onKeyDown={(e) => handleCodeEditorKeys(e, (v) => set({ body: v }))}
              />
            ) : (
              <textarea
                className="body-input"
                placeholder="corpo da request"
                value={request.body}
                onChange={(e) => set({ body: e.target.value })}
                onKeyDown={(e) => handleCodeEditorKeys(e, (v) => set({ body: v }))}
                spellCheck={false}
              />
            )}
          </div>
        ) : bodyType === "none" ? (
          <div className="body-empty">corpo vazio — escolha um formato acima para editar</div>
        ) : null}
        </div>
      )}

      {tab === "contrato" && (
        <div>
        <div className="body-head">
          {contractCheck && (
            <span className={"mono " + (contractCheck.ok ? "c-ok" : "c-err")} style={{ fontSize: 11 }}>
              {contractCheck.ok ? "schema válido" : contractCheck.error}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <TypeSelect
            value={contractMode}
            options={
              [
                ["openapi", "openapi (collection)"],
                ["zod", "zod"],
                ["json-schema", "json schema"],
              ] as const
            }
            onChange={setContractMode}
          />
        </div>
        {contractMode === "openapi" ? (
          <div className="body-empty">
            {props.hasSpec
              ? "✓ herdando a spec OpenAPI da collection — a rota é validada contra ela a cada envio"
              : "sem contrato: a collection não tem spec OpenAPI. Escolha zod ou schema para validar só esta rota."}
          </div>
        ) : (
          <div className="code-panel">
            <div className="code-panel-head">
              <span className="chip-sq" />
              <span>{contractMode === "zod" ? "contract.zod.ts" : "contract.schema.json"}</span>
              <span className="meta">
                {contractMode === "zod" ? "expressão com z no escopo" : "JSON Schema"}
              </span>
            </div>
            {contractMode === "json-schema" ? (
              <CodeArea
                value={request.contract?.source ?? ""}
                placeholder={SCHEMA_PLACEHOLDER}
                highlight={highlightJson}
                onChange={(v) => set({ contract: { type: contractMode, source: v } })}
                onKeyDown={(e) =>
                  handleCodeEditorKeys(e, (v) => set({ contract: { type: contractMode, source: v } }))
                }
              />
            ) : (
              <textarea
                className="body-input"
                placeholder={ZOD_PLACEHOLDER}
                value={request.contract?.source ?? ""}
                onChange={(e) =>
                  set({ contract: { type: contractMode, source: e.target.value } })
                }
                onKeyDown={(e) =>
                  handleCodeEditorKeys(e, (v) => set({ contract: { type: contractMode, source: v } }))
                }
                spellCheck={false}
              />
            )}
          </div>
        )}

        <span className="sect-label" style={{ display: "block", margin: "18px 0 8px" }}>
          checks — um por linha, avaliados a cada envio
        </span>
        <div className="code-panel">
          <div className="code-panel-head">
            <span className="chip-sq" />
            <span>checks</span>
            <span className="meta">status · time · size · body.path · headers.nome</span>
          </div>
          <textarea
            className="body-input"
            style={{ minHeight: 90 }}
            placeholder={"status == 200\ntime < 500\nbody.items.length > 0\nheaders.content-type contains json\nbody.user.id exists"}
            value={request.checks ?? ""}
            onChange={(e) => set({ checks: e.target.value })}
            spellCheck={false}
          />
        </div>
        </div>
      )}

      {tab === "config" && (
        <div>
          <span className="sect-label" style={{ display: "block", marginBottom: 8 }}>
            SLA de latência
          </span>
          <div className="opts-row">
            <label className="sla-field mono" style={{ marginTop: 0 }}>
              máximo
              <input
                className="inp"
                type="number"
                min={0}
                placeholder="—"
                value={request.max_ms ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  set({ max_ms: Number.isFinite(n) && n > 0 ? n : null });
                }}
              />
              ms
            </label>
            <span className="trace-onboard-hint" style={{ marginTop: 0 }}>
              resposta acima disso gera alerta na tela, no histórico e no dashboard
            </span>
          </div>

          <span className="sect-label" style={{ display: "block", margin: "18px 0 8px" }}>
            envio
          </span>
          <div className="opts-row">
            <label className="sla-field mono" style={{ marginTop: 0 }}>
              timeout
              <input
                className="inp"
                type="number"
                min={0}
                placeholder="30000"
                value={opts.timeout_ms ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setOpts({ timeout_ms: Number.isFinite(n) && n > 0 ? n : null });
                }}
              />
              ms
            </label>
            <label className="opt-check">
              <input
                type="checkbox"
                checked={opts.follow_redirects ?? true}
                onChange={(e) => setOpts({ follow_redirects: e.target.checked })}
              />
              seguir redirects
            </label>
            <label className="opt-check" title="aceita certificado TLS inválido — use só em dev/staging">
              <input
                type="checkbox"
                checked={opts.insecure ?? false}
                onChange={(e) => setOpts({ insecure: e.target.checked })}
              />
              ignorar TLS inválido
            </label>
          </div>
          {opts.insecure && (
            <div className="warn-box" style={{ marginTop: 12 }}>
              certificado TLS não será validado nesta rota — nunca use contra produção.
            </div>
          )}

          <span className="sect-label" style={{ display: "block", margin: "18px 0 8px" }}>
            vigiar esta rota
          </span>
          <div className="opts-row">
            <label className="opt-check">
              <input
                type="checkbox"
                checked={!!request.watch}
                disabled={props.envNames.length === 0}
                onChange={(e) =>
                  set({
                    watch: e.target.checked
                      ? { env: props.envNames[0] ?? "", minutes: 5 }
                      : null,
                  })
                }
              />
              ativa
            </label>
            {request.watch && (
              <>
                <label className="sla-field mono" style={{ marginTop: 0 }}>
                  a cada
                  <input
                    className="inp"
                    type="number"
                    min={1}
                    value={request.watch.minutes}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      set({
                        watch: { ...request.watch!, minutes: Number.isFinite(n) && n > 0 ? n : 5 },
                      });
                    }}
                  />
                  min
                </label>
                <span className="env-label">no ambiente</span>
                <TypeSelect
                  value={request.watch.env}
                  options={props.envNames.map((n) => [n, n] as const)}
                  onChange={(envSel) => set({ watch: { ...request.watch!, env: envSel } })}
                />
              </>
            )}
          </div>
          <div className="trace-onboard-hint" style={{ marginTop: 8 }}>
            {props.envNames.length === 0
              ? "crie um ambiente na collection para poder vigiar esta rota."
              : "reexecuta no intervalo enquanto o raio estiver aberto e notifica quando quebrar (5xx, contrato, checks, SLA). Salve a request para valer."}
          </div>

          <span className="sect-label" style={{ display: "block", margin: "18px 0 8px" }}>
            extrair da response (chain)
          </span>
          {(request.extract ?? []).map(([varName, path], i) => (
            <div key={i} className="hdr-row">
              <input
                className="inp key"
                placeholder="variável (ex.: token)"
                value={varName}
                onChange={(e) =>
                  set({
                    extract: (request.extract ?? []).map((p, idx) =>
                      idx === i ? ([e.target.value, p[1]] as [string, string]) : p,
                    ),
                  })
                }
                spellCheck={false}
              />
              <input
                className="inp val"
                placeholder="path (ex.: $.data.token)"
                value={path}
                onChange={(e) =>
                  set({
                    extract: (request.extract ?? []).map((p, idx) =>
                      idx === i ? ([p[0], e.target.value] as [string, string]) : p,
                    ),
                  })
                }
                spellCheck={false}
              />
              <button
                className="btn-icon danger"
                onClick={() =>
                  set({ extract: (request.extract ?? []).filter((_, idx) => idx !== i) })
                }
              >
                ×
              </button>
            </div>
          ))}
          {(request.extract ?? []).length === 0 && (
            <div className="body-empty">
              após cada envio, extrai valores do body para variáveis de sessão — use{" "}
              <span className="mono c-accent">{"{{token}}"}</span> em qualquer request depois. Não
              vai para o disco.
            </div>
          )}
          <button
            className="link-btn"
            onClick={() => set({ extract: [...(request.extract ?? []), ["", ""]] })}
          >
            + adicionar extração
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
