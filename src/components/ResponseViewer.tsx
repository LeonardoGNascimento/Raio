import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry, HttpResponseData, Snapshot, TraceData } from "../types";
import { slaBreached, statusClass } from "../types";
import { formatBytes, formatMs, highlightJson, prettyBody } from "../lib/format";
import { jsonDiff, tryParse, type DiffEntry } from "../lib/jsonDiff";
import type { ContractState } from "../lib/openapi";
import type { CheckResult } from "../lib/checks";
import { jsonToTs } from "../lib/typegen";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { JsonTree } from "./JsonTree";
import { DiffRows } from "./DiffRows";

/** acima disso a árvore ficaria pesada: mantém o texto plano */
const MAX_TREE_CHARS = 300_000;
import { TraceTab } from "./TraceTab";
import { HistoryTab } from "./HistoryTab";

interface Props {
  response: HttpResponseData | null;
  error: string | null;
  sending: boolean;
  contract: ContractState;
  checks: CheckResult[];
  snapshot: Snapshot | null;
  trace: TraceData | null;
  tracePort: number;
  history: HistoryEntry[];
  /** HH:MM quando a response exibida veio do histórico */
  restoredFrom?: string | null;
  /** SLA de latência da rota (ms) */
  maxMs?: number | null;
  onRestoreHistory: (entry: HistoryEntry) => void;
  onSaveSnapshot: () => void;
  onDeleteSnapshot: () => void;
}

type Tab = "body" | "headers" | "raw" | "contrato" | "checks" | "snapshot" | "trace" | "histórico";

const MAX_FIND_MATCHES = 500;

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Marca ocorrências (case-insensitive) de q no texto, escapando HTML. */
function markMatches(text: string, q: string, cur: number): { html: string; count: number } {
  if (!q) return { html: escHtml(text), count: 0 };
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  let count = 0;
  let out = "";
  while (count < MAX_FIND_MATCHES) {
    const j = lower.indexOf(ql, i);
    if (j < 0) break;
    out += escHtml(text.slice(i, j));
    const isCur = count === cur;
    out += `<mark class="find${isCur ? " cur" : ""}"${isCur ? ' id="find-cur"' : ""}>${escHtml(
      text.slice(j, j + q.length),
    )}</mark>`;
    i = j + q.length;
    count++;
  }
  out += escHtml(text.slice(i));
  return { html: out, count };
}

export function ResponseViewer(props: Props) {
  const { response, error, sending, contract, checks, snapshot, trace, history } = props;
  const checksFailed = checks.filter((c) => !c.ok).length;
  const [tab, setTab] = useState<Tab>("body");
  const [copied, setCopied] = useState(false);
  const [typeCopied, setTypeCopied] = useState<"ok" | "err" | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeEpoch, setTreeEpoch] = useState(0);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const traceHasError = !!trace?.events.some((e) => e.kind === "error");
  const slaBreach = !!response && slaBreached(response.total_ms, props.maxMs);

  const copyBody = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard indisponível */
    }
  };

  const saveBinary = async () => {
    if (!response?.body_base64) return;
    try {
      const ct = response.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
      const ext = ct.includes("png") ? "png" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
        : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : ct.includes("pdf") ? "pdf"
        : ct.includes("zip") ? "zip" : "bin";
      const path = await saveFileDialog({ defaultPath: `response.${ext}`, title: "Salvar body" });
      if (typeof path === "string") await api.saveBody(path, response.body_base64);
    } catch (e) {
      alert(String(e));
    }
  };

  const copyType = async () => {
    if (!response) return;
    const parsed = tryParse(response.body);
    if (!parsed.ok) {
      setTypeCopied("err");
      setTimeout(() => setTypeCopied(null), 1800);
      return;
    }
    try {
      await navigator.clipboard.writeText(jsonToTs(parsed.value, "ApiResponse"));
      setTypeCopied("ok");
      setTimeout(() => setTypeCopied(null), 1400);
    } catch {
      /* clipboard indisponível */
    }
  };

  const contentType = response?.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];

  const pretty = useMemo(
    () => (response ? prettyBody(response.body, contentType) : ""),
    [response, contentType],
  );
  const html = useMemo(() => highlightJson(pretty), [pretty]);
  const gutter = useMemo(() => {
    const n = pretty ? pretty.split("\n").length : 0;
    return Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }, [pretty]);

  const snapDiff = useMemo<DiffEntry[] | null>(() => {
    if (!snapshot || !response) return null;
    const a = tryParse(snapshot.body);
    const b = tryParse(response.body);
    if (!a.ok || !b.ok) return null;
    return jsonDiff(a.value, b.value);
  }, [snapshot, response]);

  const snapChanged =
    snapshot && response
      ? snapshot.status !== response.status ||
        (snapDiff ? snapDiff.length > 0 : snapshot.body !== response.body)
      : false;

  const hasContractTab = contract.kind !== "no-spec";
  const hasSnapshotTab = snapshot !== null;

  useEffect(() => {
    if ((tab === "contrato" && !hasContractTab) || (tab === "snapshot" && !hasSnapshotTab))
      setTab("body");
  }, [tab, hasContractTab, hasSnapshotTab]);

  // Ctrl+F abre a busca no response; Esc fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        if ((e.target as HTMLElement | null)?.closest?.(".modal-backdrop")) return;
        e.preventDefault();
        setFindOpen(true);
        if (tab !== "body" && tab !== "raw") setTab("body");
        setTimeout(() => findInputRef.current?.select(), 0);
      } else if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, findOpen]);

  // árvore de JSON com fold (body JSON, fora do modo busca, tamanho razoável)
  const parsedBody = useMemo(
    () => (response && pretty.length <= MAX_TREE_CHARS ? tryParse(response.body) : { ok: false as const }),
    [response, pretty.length],
  );
  const treeAvailable = parsedBody.ok;

  // Ctrl+A com body/raw aberto seleciona só o conteúdo do body
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== "a" && e.key !== "A")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (t?.closest?.(".modal-backdrop")) return;
      if (tab !== "body" && tab !== "raw") return;
      const el = bodyContentRef.current;
      if (!el) return;
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const findActive = findOpen && findQ.length > 0 && (tab === "body" || tab === "raw");
  const findTarget = tab === "raw" ? (response?.body ?? "") : pretty;
  const marked = useMemo(
    () => (findActive ? markMatches(findTarget, findQ, findIdx) : null),
    [findActive, findTarget, findQ, findIdx],
  );
  const matchCount = marked?.count ?? 0;

  useEffect(() => {
    // índice sempre dentro do total e match atual visível
    if (findActive && findIdx >= matchCount && matchCount > 0) setFindIdx(0);
    if (findActive && matchCount > 0)
      document.getElementById("find-cur")?.scrollIntoView({ block: "center" });
  }, [findActive, findIdx, matchCount]);

  const findStep = (dir: 1 | -1) => {
    if (matchCount === 0) return;
    setFindIdx((i) => (i + dir + matchCount) % matchCount);
  };

  if (sending)
    return (
      <div className="response">
        <div className="resp-center" style={{ flex: "0 0 auto", padding: "40px 24px 16px" }}>
          <span className="pulse-dot" /> enviando…
        </div>
        {trace && trace.events.length > 0 && (
          <div className="tab-content" style={{ paddingTop: 4 }}>
            <TraceTab trace={trace} live port={props.tracePort} />
          </div>
        )}
      </div>
    );
  if (error)
    return (
      <div className="response">
        <div className="resp-center c-err">✕ {error}</div>
      </div>
    );
  if (!response)
    return (
      <div className="response">
        <div className="resp-center">envie a request para ver a response aqui — Enter na URL funciona</div>
      </div>
    );

  const tabs: { key: Tab; badge?: { text: string; cls: string } }[] = [
    { key: "body" },
    { key: "headers" },
    { key: "raw" },
  ];
  if (hasContractTab)
    tabs.push({
      key: "contrato",
      badge:
        contract.kind === "violations"
          ? {
              text: contract.violations.length === 1 ? "1 erro" : `${contract.violations.length} erros`,
              cls: "c-err",
            }
          : contract.kind === "ok"
            ? { text: "ok", cls: "c-ok" }
            : undefined,
    });
  if (hasSnapshotTab)
    tabs.push({
      key: "snapshot",
      badge: snapChanged ? { text: "mudou", cls: "c-warn" } : { text: "igual", cls: "c-ok" },
    });
  if (checks.length > 0)
    tabs.push({
      key: "checks",
      badge:
        checksFailed > 0
          ? { text: `${checksFailed} de ${checks.length} falhou`, cls: "c-err" }
          : { text: `${checks.length} ok`, cls: "c-ok" },
    });
  tabs.push({
    key: "trace",
    badge:
      trace && trace.events.length > 0
        ? traceHasError
          ? { text: "erro interno", cls: "c-err" }
          : { text: `${trace.events.length} eventos`, cls: "c-ok" }
        : undefined,
  });
  tabs.push({
    key: "histórico",
    badge:
      history.length > 0
        ? { text: history.length === 1 ? "1 execução" : `${history.length} execuções`, cls: "c-dim" }
        : undefined,
  });

  const sCls = statusClass(response.status);

  return (
    <div className="response">
      <div className="resp-meta">
        <span className={"resp-status " + sCls}>
          <span className="dot" />
          {response.status} {response.status_text}
        </span>
        <span
          className={"resp-chip" + (slaBreach ? " c-err" : "")}
          style={slaBreach ? { fontWeight: 700 } : undefined}
          title="TTFB / total"
        >
          {formatMs(response.ttfb_ms)} <span className="c-faint">/</span> {formatMs(response.total_ms)}
        </span>
        {slaBreach && (
          <span className="snap-chip c-err" title="a rota tem SLA de latência configurado no editor">
            resposta acima do SLA de {props.maxMs} ms
          </span>
        )}
        <span className="resp-chip">{formatBytes(response.size_bytes)}</span>
        <span className="resp-chip">{response.http_version}</span>
        {props.restoredFrom && (
          <span className="snap-chip c-info" title="response restaurada da aba histórico">
            restaurada do histórico às {props.restoredFrom}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="btn-ghost"
          onClick={props.onSaveSnapshot}
          title="salva esta response como referência versionável; execuções seguintes mostram o diff"
        >
          snapshot
        </button>
        {hasSnapshotTab && (
          <span className={"snap-chip " + (snapChanged ? "c-warn" : "c-ok")}>
            {snapChanged ? "mudou desde o snapshot" : "sem mudanças desde o snapshot"}
          </span>
        )}
      </div>

      {findOpen && (
        <div className="find-bar">
          <input
            ref={findInputRef}
            className="inp"
            placeholder="buscar no response…"
            value={findQ}
            autoFocus
            onChange={(e) => {
              setFindQ(e.target.value);
              setFindIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") findStep(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setFindOpen(false);
            }}
          />
          <span className="mono c-dim" style={{ fontSize: 11.5, minWidth: 74, textAlign: "center" }}>
            {findQ
              ? matchCount > 0
                ? `${findIdx + 1} de ${matchCount}${matchCount >= 500 ? "+" : ""}`
                : "nenhum resultado"
              : ""}
          </span>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => findStep(-1)} title="anterior (Shift+Enter)">
            ↑
          </button>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => findStep(1)} title="próximo (Enter)">
            ↓
          </button>
          <button className="btn-icon" onClick={() => setFindOpen(false)} title="fechar (Esc)">
            ×
          </button>
        </div>
      )}

      {response.body_truncated && (
        <div className="var-warn" style={{ margin: "14px 20px 0" }}>
          ⚠ body maior que 10MB — exibindo trecho inicial
        </div>
      )}

      {contract.kind === "violations" && tab !== "contrato" && (
        <div className="contract-alert" onClick={() => setTab("contrato")}>
          <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 14 }}>⚠</span> {contract.violations.length} violações de contrato
          </span>
          <span className="sub">— a response não bate com a spec OpenAPI</span>
          <span className="cta">ver contrato →</span>
        </div>
      )}

      {traceHasError && tab !== "trace" && (
        <div className="contract-alert" onClick={() => setTab("trace")}>
          <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 15 }}>⚠</span> exception engolida no servidor
          </span>
          <span className="sub">— a API respondeu {response.status} mas o código quebrou por dentro</span>
          <span className="cta">ver trace →</span>
        </div>
      )}

      <div className="tabs">
        {tabs.map(({ key, badge }) => (
          <button key={key} className={"tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
            {key}
            {badge && (
              <span className={"tab-note " + badge.cls}>
                <span className="c-faint">·</span> {badge.text}
              </span>
            )}
          </button>
        ))}
        <div className="fill tab-actions">
          {(tab === "body" || tab === "raw") && (
            <>
              {tab === "body" && treeAvailable && !findActive && (
                <>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setTreeCollapsed(true);
                      setTreeEpoch((n) => n + 1);
                    }}
                    title="recolhe todas as chaves e arrays"
                  >
                    recolher tudo
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setTreeCollapsed(false);
                      setTreeEpoch((n) => n + 1);
                    }}
                    title="expande todas as chaves e arrays"
                  >
                    expandir tudo
                  </button>
                </>
              )}
              <button className="btn-ghost" onClick={copyBody} title="copiar body da response">
                {copied ? "copiado ✓" : "copiar body"}
              </button>
              <button
                className="btn-ghost"
                onClick={copyType}
                title="gera interfaces TypeScript a partir do body e copia"
              >
                {typeCopied === "ok"
                  ? "type copiado ✓"
                  : typeCopied === "err"
                    ? "body não é JSON"
                    : "copiar type TS"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tab-content">
        {(tab === "body" || tab === "raw") && response.is_binary && (
          <div className="binary-view">
            {(() => {
              const ct = contentType ?? "";
              if (ct.startsWith("image/") && response.body_base64)
                return (
                  <img
                    className="binary-img"
                    src={`data:${ct.split(";")[0]};base64,${response.body_base64}`}
                    alt="response"
                  />
                );
              return (
                <div className="hint-block">
                  conteúdo binário · {contentType || "tipo desconhecido"} ·{" "}
                  {formatBytes(response.size_bytes)}
                </div>
              );
            })()}
            <div>
              <button className="btn-ghost" onClick={saveBinary} disabled={!response.body_base64}>
                salvar arquivo…
              </button>
              {response.body_truncated && (
                <span className="c-warn" style={{ marginLeft: 10, fontSize: 12 }}>
                  body maior que 10MB — salvo só o trecho baixado
                </span>
              )}
            </div>
          </div>
        )}
        {(tab === "body" || tab === "raw") && !response.is_binary && (
          <div ref={bodyContentRef}>
            {tab === "body" &&
              (findActive && marked ? (
                <div className="json-view">
                  <pre className="gutter">{gutter}</pre>
                  <pre className="code" dangerouslySetInnerHTML={{ __html: marked.html }} />
                </div>
              ) : treeAvailable && parsedBody.ok ? (
                <JsonTree key={treeEpoch} value={parsedBody.value} defaultCollapsed={treeCollapsed} />
              ) : (
                <div className="json-view">
                  <pre className="gutter">{gutter}</pre>
                  <pre className="code" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ))}
            {tab === "raw" &&
              (findActive && marked ? (
                <pre className="raw-pre" dangerouslySetInnerHTML={{ __html: marked.html }} />
              ) : (
                <pre className="raw-pre">{response.body}</pre>
              ))}
          </div>
        )}
        {tab === "headers" && (
          <>
            {response.request_headers.length > 0 && (
              <>
                <span className="sect-label" style={{ display: "block", marginBottom: 8 }}>
                  request — enviados
                </span>
                {response.request_headers.map(([k, v], i) => (
                  <div key={"rq" + i} className="hdr-view-row">
                    <span className="k c-accent">{k}</span>
                    <span className="v">{v}</span>
                  </div>
                ))}
              </>
            )}
            <span
              className="sect-label"
              style={{ display: "block", margin: response.request_headers.length ? "18px 0 8px" : "0 0 8px" }}
            >
              response — recebidos
            </span>
            {response.headers.map(([k, v], i) => (
              <div key={i} className="hdr-view-row">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </>
        )}

        {tab === "contrato" && (
          <>
            {contract.kind === "ok" && (
              <div className="ok-banner">
                <span className="big">✓</span> response válida — nenhuma violação ·{" "}
                <span className="c-dim">{contract.operation}</span>
              </div>
            )}
            {contract.kind === "no-match" && (
              <div className="hint-block">
                Rota/método não encontrado na spec OpenAPI desta collection.
              </div>
            )}
            {contract.kind === "no-schema" && (
              <div className="hint-block">
                <span className="c-accent">{contract.operation}</span> existe na spec, mas sem schema
                JSON para este status.
              </div>
            )}
            {contract.kind === "not-json" && (
              <div className="hint-block">
                Spec define schema JSON, mas a response veio com content-type não-JSON.
              </div>
            )}
            {contract.kind === "violations" && (
              <div>
                <div className="viol-count">
                  {contract.violations.length} violações contra a spec ·{" "}
                  <span className="c-dim">{contract.operation}</span>
                </div>
                {contract.violations.map((v, i) => (
                  <div key={i} className="viol-row">
                    <span className="path">{v.path}</span>
                    <span className="msg">{v.message}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "checks" && (
          <div>
            {checksFailed === 0 ? (
              <div className="ok-banner">
                <span className="big">✓</span> todos os {checks.length} checks passaram
              </div>
            ) : (
              <div className="viol-count">
                {checksFailed} de {checks.length} checks falharam
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              {checks.map((c, i) => (
                <div key={i} className={"diff-row " + (c.ok ? "k-add" : "k-remove")}>
                  <span className="sign">{c.ok ? "✓" : "✕"}</span>
                  <div className="body">
                    <div className="path">{c.expr}</div>
                    {!c.ok && <div className="vals c-dim">valor observado: {c.actual}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "trace" && <TraceTab trace={trace} live={false} port={props.tracePort} />}
        {tab === "histórico" && (
          <HistoryTab history={history} maxMs={props.maxMs} onRestore={props.onRestoreHistory} />
        )}

        {tab === "snapshot" && snapshot && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 13 }}>
              <span className="hint-block" style={{ fontSize: 12 }}>
                snapshot de {new Date(snapshot.saved_at).toLocaleString()}
                {snapshot.env && <> · env <span className="c-accent">{snapshot.env}</span></>}
              </span>
              <button
                className="btn-danger-ghost"
                onClick={() => {
                  if (confirm("Excluir snapshot?")) props.onDeleteSnapshot();
                }}
              >
                excluir snapshot
              </button>
            </div>
            {!snapChanged && (
              <div className="ok-banner">
                <span className="big">=</span> idêntica ao snapshot salvo — nenhuma mudança
              </div>
            )}
            {snapChanged && (
              <div>
                {snapshot.status !== response.status && (
                  <div className="status-alert">
                    ⚠ status mudou:{" "}
                    <span className="c-dim">
                      {snapshot.status} › {response.status}
                    </span>
                  </div>
                )}
                <span className="sect-label" style={{ display: "block", marginBottom: 10 }}>
                  mudanças vs snapshot
                </span>
                {snapDiff !== null ? (
                  <DiffRows diff={snapDiff} />
                ) : (
                  <div className="hint-block">bodies não-JSON diferem — compare no modo raw</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
