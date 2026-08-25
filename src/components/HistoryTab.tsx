import { useMemo, useState } from "react";
import type { HistoryEntry } from "../types";
import { METHOD_CLASS, envDotClass, slaBreached, statusClass } from "../types";
import { formatBytes, formatMs, highlightJson, prettyBody } from "../lib/format";
import { jsonDiff, tryParse, type DiffEntry } from "../lib/jsonDiff";
import { buildReportPrompt } from "../lib/report";
import { DiffRows } from "./DiffRows";

/** Botão que copia um prompt de relatório para colar numa IA. */
function CopyPromptButton({
  entries,
  maxMs,
  label,
}: {
  entries: HistoryEntry[];
  maxMs?: number | null;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildReportPrompt(entries, maxMs));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard indisponível */
    }
  };
  return (
    <button
      className="btn-ghost"
      style={{ padding: "4px 11px", fontSize: 11 }}
      onClick={(e) => {
        e.stopPropagation();
        copy();
      }}
      title="copia um prompt com os dados das execuções para colar numa IA e gerar um relatório da rota"
    >
      {copied ? "prompt copiado — cole na sua IA" : label}
    </button>
  );
}

function ContractChip({ entry }: { entry: HistoryEntry }) {
  const c = entry.contract;
  if (!c || c.type === "none") return null;
  if (c.status === "ok")
    return (
      <span className="mono c-ok" style={{ fontSize: 11 }} title={c.operation}>
        contrato {c.type} ok
      </span>
    );
  if (c.status === "fail")
    return (
      <span className="mono c-err" style={{ fontSize: 11 }} title={c.operation}>
        contrato {c.type} falhou ({c.violations.length})
      </span>
    );
  return (
    <span className="mono c-faint" style={{ fontSize: 11 }}>
      contrato {c.type} não validado
    </span>
  );
}

function EntryDetail({ entry }: { entry: HistoryEntry }) {
  const [showSchema, setShowSchema] = useState(false);
  const pretty = prettyBody(entry.body);
  const c = entry.contract;
  return (
    <div className="hist-detail" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <CopyPromptButton
          entries={[entry]}
          maxMs={entry.max_ms}
          label="copiar prompt desta execução para IA"
        />
      </div>
      <div className="hist-detail-sect">
        <span className="sect-label">request</span>
        <div className="mono" style={{ fontSize: 12, marginTop: 6 }}>
          <span className={METHOD_CLASS[entry.method ?? ""] ?? "c-dim"} style={{ fontWeight: 700 }}>
            {entry.method ?? "?"}
          </span>{" "}
          <span style={{ wordBreak: "break-all" }}>{entry.url ?? "(url não gravada)"}</span>
        </div>
        {entry.request_body && (
          <pre className="hist-detail-pre">{entry.request_body}</pre>
        )}
      </div>

      <div className="hist-detail-sect">
        <span className="sect-label">response · {formatBytes(entry.size_bytes)}</span>
        <pre
          className="hist-detail-pre"
          dangerouslySetInnerHTML={{ __html: highlightJson(pretty) }}
        />
      </div>

      <div className="hist-detail-sect">
        <span className="sect-label">contrato nesta execução</span>
        {!c || c.type === "none" ? (
          <div className="hint-block c-faint" style={{ fontSize: 12 }}>
            sem contrato configurado nesta execução
          </div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <div className="mono" style={{ fontSize: 12 }}>
              {c.status === "ok" && <span className="c-ok">✓ passou</span>}
              {c.status === "fail" && <span className="c-err">✕ falhou</span>}
              {c.status === "none" && <span className="c-faint">— não validado</span>}
              {" · "}
              <span className="c-accent">{c.type}</span>
              {c.operation && <span className="c-dim"> · {c.operation}</span>}
            </div>
            {c.violations.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {c.violations.map(([path, msg], i) => (
                  <div key={i} className="viol-row" style={{ padding: "8px 11px", marginBottom: 5 }}>
                    <span className="path">{path}</span>
                    <span className="msg">{msg}</span>
                  </div>
                ))}
              </div>
            )}
            {c.source && (
              <>
                <button className="trace-mini-btn" onClick={() => setShowSchema((s) => !s)}>
                  {showSchema ? "ocultar schema usado" : "ver schema usado"}
                </button>
                {showSchema && <pre className="hist-detail-pre">{c.source}</pre>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_FILL: Record<string, string> = {
  "c-ok": "var(--ok)",
  "c-info": "var(--info)",
  "c-warn": "var(--warn)",
  "c-err": "var(--err)",
};

function Sparkline({ entries, maxMs }: { entries: HistoryEntry[]; maxMs?: number | null }) {
  const w = 600;
  const h = 48;
  const pad = 4;
  const vals = entries.map((e) => e.total_ms);
  const domain = typeof maxMs === "number" && maxMs > 0 ? [...vals, maxMs] : vals;
  const max = Math.max(...domain);
  const min = Math.min(...domain);
  const rng = max - min || 1;
  const slaY =
    typeof maxMs === "number" && maxMs > 0
      ? h - pad - ((maxMs - min) / rng) * (h - 2 * pad)
      : null;
  const pts = entries.map((e, i) => {
    const x = entries.length === 1 ? w / 2 : pad + (i / (entries.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((e.total_ms - min) / rng) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="raiospark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(224,166,58,.26)" />
          <stop offset="100%" stopColor="rgba(224,166,58,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#raiospark)" />
      {slaY !== null && (
        <line
          x1={pad}
          x2={w - pad}
          y1={slaY}
          y2={slaY}
          stroke="var(--err)"
          strokeWidth="1"
          strokeDasharray="5 4"
          opacity="0.7"
        />
      )}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r="2.6"
          fill={STATUS_FILL[statusClass(entries[i].status)]}
          stroke="var(--ground)"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function HistoryTab({
  history,
  maxMs,
  onRestore,
}: {
  history: HistoryEntry[];
  /** SLA atual da rota, para a linha-guia da sparkline */
  maxMs?: number | null;
  onRestore: (entry: HistoryEntry) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? history.filter(
        (h) =>
          String(h.status).includes(q) ||
          h.env.toLowerCase().includes(q) ||
          h.body.toLowerCase().includes(q),
      )
    : history;

  const pick = (id: string) => {
    setSel((prev) => {
      const next = [...prev];
      const i = next.indexOf(id);
      if (i >= 0) next.splice(i, 1);
      else {
        next.push(id);
        if (next.length > 2) next.shift();
      }
      return next;
    });
  };

  const pair = useMemo(() => {
    if (sel.length !== 2) return null;
    const found = sel
      .map((id) => history.find((h) => h.id === id))
      .filter((h): h is HistoryEntry => !!h)
      .sort((a, b) => history.indexOf(a) - history.indexOf(b));
    return found.length === 2 ? found : null;
  }, [sel, history]);

  const pairDiff = useMemo<DiffEntry[] | null>(() => {
    if (!pair) return null;
    const a = tryParse(pair[0].body);
    const b = tryParse(pair[1].body);
    if (!a.ok || !b.ok) return null;
    return jsonDiff(a.value, b.value);
  }, [pair]);

  if (history.length === 0)
    return (
      <div className="hint-block c-faint">
        nenhuma execução ainda — clique em Enviar para registrar a primeira.
      </div>
    );

  const ms = history.map((h) => h.total_ms);

  return (
    <div>
      <div className="hist-spark-card">
        <div className="hist-spark-head">
          <span className="sect-label">latência · {history.length} execuções</span>
          <div style={{ flex: 1 }} />
          <CopyPromptButton entries={history} maxMs={maxMs} label="copiar prompt para IA gerar relatório" />
          <input
            className="inp"
            style={{ padding: "4px 9px", fontSize: 11.5, width: 170 }}
            placeholder="filtrar: status, env, texto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="mono c-dim" style={{ fontSize: 11.5 }}>
            {Math.min(...ms)}–{Math.max(...ms)}ms
          </span>
        </div>
        <Sparkline entries={history} maxMs={maxMs} />
      </div>

      {pair && (
        <div className="hist-diff-card">
          <div className="hist-diff-head mono">
            <span className="c-info" style={{ fontWeight: 700 }}>{clock(pair[0].at)}</span>
            <span className="c-faint">→</span>
            <span className="c-accent" style={{ fontWeight: 700 }}>{clock(pair[1].at)}</span>
            <span className="c-faint">· {pairDiff ? `${pairDiff.length} diferenças` : "bodies não-JSON"}</span>
            {(() => {
              const dMs = pair[1].total_ms - pair[0].total_ms;
              const ratio = pair[0].total_ms > 0 ? pair[1].total_ms / pair[0].total_ms : null;
              const dB = pair[1].size_bytes - pair[0].size_bytes;
              return (
                <>
                  <span className={dMs > 0 ? (ratio && ratio >= 1.25 ? "c-err" : "c-warn") : dMs < 0 ? "c-ok" : "c-faint"}>
                    · {dMs === 0 ? "= tempo" : `${dMs > 0 ? "+" : "−"}${formatMs(Math.abs(dMs))}`}
                    {ratio && ratio !== 1 ? ` (${ratio.toFixed(1)}×)` : ""}
                  </span>
                  {dB !== 0 && (
                    <span className="c-faint">· {dB > 0 ? "+" : "−"}{formatBytes(Math.abs(dB))}</span>
                  )}
                </>
              );
            })()}
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" style={{ padding: "4px 11px", fontSize: 11 }} onClick={() => setSel([])}>
              limpar
            </button>
          </div>
          {pairDiff && pairDiff.length === 0 && (
            <div className="ok-banner" style={{ fontSize: 12.5, padding: "11px 14px" }}>
              <span>=</span> respostas idênticas — nenhuma diferença estrutural
            </div>
          )}
          {pairDiff && pairDiff.length > 0 && <DiffRows diff={pairDiff} max={100} />}
          {!pairDiff && (
            <div className="hint-block">bodies não-JSON — compare restaurando cada execução.</div>
          )}
        </div>
      )}

      {q && visible.length === 0 && (
        <div className="hint-block c-faint">nenhuma execução bate com o filtro.</div>
      )}
      {[...visible].reverse().map((h) => {
        const idx = sel.indexOf(h.id);
        const isSel = idx >= 0;
        const isOpen = expanded === h.id;
        const sCls = statusClass(h.status);
        return (
          <div key={h.id} className={"hist-block" + (isOpen ? " open" : "")}>
            <div
              className={"hist-row" + (isSel ? " sel" : "")}
              onClick={() => onRestore(h)}
              title="clique para restaurar a response"
            >
              <button
                className={"hist-pick" + (isSel ? " on" : "")}
                title="comparar"
                onClick={(e) => {
                  e.stopPropagation();
                  pick(h.id);
                }}
              >
                {isSel ? idx + 1 : ""}
              </button>
              <button
                className="btn-icon"
                style={{ fontSize: 12 }}
                title={isOpen ? "recolher detalhes" : "ver detalhes (request, response, contrato)"}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(isOpen ? null : h.id);
                }}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <span className={"dot " + sCls} style={{ background: "currentColor" }} />
              <span className={"mono " + sCls} style={{ flex: "0 0 104px", fontSize: 12.5, fontWeight: 700 }}>
                {h.status} {h.status_text.replace(/^\d+\s*/, "")}
              </span>
              <span
                className={"mono " + (slaBreached(h.total_ms, h.max_ms) ? "c-err" : "c-dim")}
                style={{ fontSize: 12, fontWeight: slaBreached(h.total_ms, h.max_ms) ? 700 : 400 }}
              >
                {formatMs(h.ttfb_ms)} <span className="c-faint">/</span> {formatMs(h.total_ms)}
              </span>
              {slaBreached(h.total_ms, h.max_ms) && (
                <span className="mono c-err" style={{ fontSize: 11 }} title={`SLA vigente: ${h.max_ms}ms`}>
                  acima do SLA
                </span>
              )}
              <span className="mono c-dim" style={{ fontSize: 12 }}>{formatBytes(h.size_bytes)}</span>
              <ContractChip entry={h} />
              {h.trace_error && (
                <span className="mono c-err" style={{ fontSize: 11 }}>erro interno no trace</span>
              )}
              <div style={{ flex: 1 }} />
              <span className="mono c-dim" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                <span className={"dot " + envDotClass(h.env)} style={{ background: "currentColor", width: 6, height: 6 }} />
                {h.env || "—"}
              </span>
              <span className="mono c-faint" style={{ fontSize: 11.5, flex: "0 0 44px", textAlign: "right" }}>
                {clock(h.at)}
              </span>
            </div>
            {isOpen && <EntryDetail entry={h} />}
          </div>
        );
      })}
      <div className="trace-onboard-hint" style={{ marginTop: 11 }}>
        clique numa execução para restaurar a response · marque o quadradinho de duas para comparar
      </div>
    </div>
  );
}
