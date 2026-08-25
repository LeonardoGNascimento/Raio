import { useMemo } from "react";
import type { Environment, HttpResponseData, TraceData } from "../types";
import { envDotClass, slaBreached, statusClass } from "../types";
import { jsonDiff, tryParse, type DiffEntry } from "../lib/jsonDiff";
import { formatBytes, formatMs } from "../lib/format";
import { Dropdown } from "./Dropdown";
import { DiffRows } from "./DiffRows";

export interface DiffResult {
  leftEnv: string;
  rightEnv: string;
  left: HttpResponseData | { error: string } | null;
  right: HttpResponseData | { error: string } | null;
  leftTrace?: TraceData | null;
  rightTrace?: TraceData | null;
}

function queryCount(t: TraceData): number {
  return t.events.filter((e) => e.kind === "query").length;
}

function TraceCol({ env, trace, warn }: { env: string; trace: TraceData; warn: boolean }) {
  const q = queryCount(trace);
  return (
    <div className={"tracediff-col" + (warn ? " warn" : "")}>
      <div className="tracediff-head">
        <span className={"dot " + envDotClass(env)} style={{ background: "currentColor" }} />
        <span className={"mono " + envDotClass(env)} style={{ fontSize: 11.5, fontWeight: 700 }}>
          {env}
        </span>
        <div style={{ flex: 1 }} />
        <span className={"query-chip" + (warn ? " warn" : "")}>
          {q === 1 ? "1 consulta ao banco" : `${q} consultas ao banco`}
        </span>
      </div>
      {trace.events.map((e, i) => (
        <div key={i} className="tracediff-ev">
          <span className="off">+{e.t}ms</span>
          <span className={"lbl" + (e.kind === "error" ? " warn" : "")}>
            {e.label} {e.dur !== undefined && <span className="dur">({e.dur}ms)</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  result: DiffResult;
  environments: Environment[];
  running: boolean;
  /** SLA da rota (ms), para o veredito por ambiente */
  maxMs?: number | null;
  onRun: (leftEnv: string, rightEnv: string) => void;
  onClose: () => void;
}

function isResp(v: DiffResult["left"]): v is HttpResponseData {
  return !!v && !("error" in v);
}

/** Delta direita vs esquerda: texto assinado + razão, colorido pela direção. */
function delta(l: number, r: number, fmt: (n: number) => string) {
  const d = r - l;
  const ratio = l > 0 ? r / l : null;
  const cls = d > 0 ? (ratio !== null && ratio >= 1.25 ? "c-err" : "c-warn") : d < 0 ? "c-ok" : "c-faint";
  const text =
    d === 0
      ? "="
      : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}${ratio !== null && ratio !== 1 ? ` · ${ratio.toFixed(1)}×` : ""}`;
  return { text, cls };
}

function PerfAnalysis({
  left,
  right,
  leftEnv,
  rightEnv,
  maxMs,
}: {
  left: HttpResponseData;
  right: HttpResponseData;
  leftEnv: string;
  rightEnv: string;
  maxMs?: number | null;
}) {
  const rows: { label: string; l: number; r: number; fmt: (n: number) => string }[] = [
    { label: "TTFB", l: left.ttfb_ms, r: right.ttfb_ms, fmt: formatMs },
    { label: "total", l: left.total_ms, r: right.total_ms, fmt: formatMs },
    {
      label: "download",
      l: Math.max(0, left.total_ms - left.ttfb_ms),
      r: Math.max(0, right.total_ms - right.ttfb_ms),
      fmt: formatMs,
    },
    { label: "tamanho", l: left.size_bytes, r: right.size_bytes, fmt: formatBytes },
  ];
  const maxTotal = Math.max(left.total_ms, right.total_ms, 1);
  const bar = (resp: HttpResponseData, env: string, cls: string) => {
    const ttfbPct = (resp.ttfb_ms / maxTotal) * 100;
    const dlPct = (Math.max(0, resp.total_ms - resp.ttfb_ms) / maxTotal) * 100;
    return (
      <div className="perf-bar-row">
        <span className={"perf-bar-env mono " + cls}>{env}</span>
        <div className="perf-bar-track">
          <span className="perf-seg ttfb" style={{ width: `${ttfbPct}%` }} title={`TTFB ${formatMs(resp.ttfb_ms)}`} />
          <span className="perf-seg dl" style={{ width: `${dlPct}%` }} title={`download ${formatMs(resp.total_ms - resp.ttfb_ms)}`} />
        </div>
        <span className="mono c-dim" style={{ fontSize: 11.5, flexShrink: 0 }}>{formatMs(resp.total_ms)}</span>
      </div>
    );
  };

  return (
    <div className="perf-panel">
      <span className="sect-label">análise de performance · {leftEnv} → {rightEnv}</span>
      <div className="perf-bars">
        {bar(left, leftEnv, "c-info")}
        {bar(right, rightEnv, "c-accent")}
        <div className="perf-legend mono">
          <span><span className="perf-seg ttfb legend" /> TTFB</span>
          <span><span className="perf-seg dl legend" /> download</span>
        </div>
      </div>
      <div className="perf-table mono">
        {rows.map(({ label, l, r, fmt }) => {
          const d = delta(l, r, fmt);
          return (
            <div key={label} className="perf-row">
              <span className="c-faint">{label}</span>
              <span className="c-info">{fmt(l)}</span>
              <span className="c-accent">{fmt(r)}</span>
              <span className={d.cls}>{d.text}</span>
            </div>
          );
        })}
        {typeof maxMs === "number" && maxMs > 0 && (
          <div className="perf-row">
            <span className="c-faint">SLA {maxMs}ms</span>
            <span className={slaBreached(left.total_ms, maxMs) ? "c-err" : "c-ok"}>
              {slaBreached(left.total_ms, maxMs) ? "estourou o SLA" : "dentro do SLA"}
            </span>
            <span className={slaBreached(right.total_ms, maxMs) ? "c-err" : "c-ok"}>
              {slaBreached(right.total_ms, maxMs) ? "estourou o SLA" : "dentro do SLA"}
            </span>
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function EnvPicker({
  cls,
  value,
  environments,
  disabled,
  onPick,
}: {
  cls: "from" | "to";
  value: string;
  environments: Environment[];
  disabled: boolean;
  onPick: (name: string) => void;
}) {
  return (
    <Dropdown
      button={() => (
        <button className={"env-pill " + cls} disabled={disabled}>
          {value} <span style={{ opacity: 0.6 }}>▾</span>
        </button>
      )}
    >
      {(close) => (
        <>
          {environments.map((e) => (
            <button
              key={e.name}
              className={"dd-item" + (e.name === value ? " active" : "")}
              onClick={() => {
                close();
                onPick(e.name);
              }}
            >
              <span className={"dot " + envDotClass(e.name)} style={{ background: "currentColor" }} />
              {e.name}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function DiffView({ result, environments, running, maxMs, onRun, onClose }: Props) {
  const { left, right } = result;

  const diff = useMemo<DiffEntry[] | null>(() => {
    if (!isResp(left) || !isResp(right)) return null;
    const l = tryParse(left.body);
    const r = tryParse(right.body);
    if (!l.ok || !r.ok) return null;
    return jsonDiff(l.value, r.value);
  }, [left, right]);

  const statusDiffers = isResp(left) && isResp(right) && left.status !== right.status;

  const card = (env: string, cls: string, r: DiffResult["left"]) => (
    <div className="diffenv-card">
      <div className={"env-name " + cls}>
        <span className="dot" style={{ background: "currentColor" }} />
        {env}
      </div>
      <div className="stats">
        {r === null && <span className="c-dim">{running ? "enviando…" : "—"}</span>}
        {r !== null && !isResp(r) && <span className="c-err">✕ {r.error}</span>}
        {isResp(r) && (
          <>
            <span className={statusClass(r.status) + " mono"} style={{ fontWeight: 700 }}>
              {r.status} {r.status_text}
            </span>
            <span className={slaBreached(r.total_ms, maxMs) ? "c-err" : "c-dim"}>
              {formatMs(r.ttfb_ms)} <span className="c-faint">/</span> {formatMs(r.total_ms)}
              {slaBreached(r.total_ms, maxMs) && " ⏱"}
            </span>
            <span className="c-dim">{formatBytes(r.size_bytes)}</span>
            <span className="c-faint">{r.http_version}</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="diffenv">
      <div className="diffenv-head">
        <span className="env-label">Comparando</span>
        <EnvPicker
          cls="from"
          value={result.leftEnv}
          environments={environments}
          disabled={running}
          onPick={(n) => onRun(n, result.rightEnv)}
        />
        <span className="c-faint mono">→</span>
        <EnvPicker
          cls="to"
          value={result.rightEnv}
          environments={environments}
          disabled={running}
          onPick={(n) => onRun(result.leftEnv, n)}
        />
        <button
          className="btn-ghost"
          onClick={() => onRun(result.leftEnv, result.rightEnv)}
          disabled={running}
        >
          {running ? "…" : "reexecutar"}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={onClose}>← voltar à response</button>
      </div>

      {statusDiffers && (
        <div className="diffenv-alert">
          <span style={{ fontSize: 15 }}>⚠</span> status divergente entre ambientes — provável quebra
          no deploy
        </div>
      )}

      <div className="diffenv-cards">
        {card(result.leftEnv, "c-info", left)}
        {card(result.rightEnv, "c-accent", right)}
      </div>

      <div className="diffenv-list">
        {isResp(left) && isResp(right) && (
          <PerfAnalysis
            left={left}
            right={right}
            leftEnv={result.leftEnv}
            rightEnv={result.rightEnv}
            maxMs={maxMs}
          />
        )}
        {diff !== null && (
          <>
            <span className="sect-label">
              {diff.length === 0 ? "nenhuma diferença estrutural" : `${diff.length} diferenças estruturais`}
            </span>
            {diff.length === 0 ? (
              <div className="ok-banner">
                <span className="big">✓</span> bodies estruturalmente idênticos entre os ambientes
              </div>
            ) : (
              <DiffRows diff={diff} />
            )}
          </>
        )}
        {diff === null && isResp(left) && isResp(right) && (
          <div className="hint-block">
            {left.body === right.body
              ? "✓ bodies idênticos (não-JSON)"
              : "⚠ bodies não-JSON diferem — compare no modo raw de cada ambiente"}
          </div>
        )}

        {result.leftTrace &&
          result.rightTrace &&
          result.leftTrace.events.length > 0 &&
          result.rightTrace.events.length > 0 && (
            <>
              <span className="sect-label" style={{ display: "block", margin: "20px 0 10px" }}>
                trace da execução · {result.leftEnv} vs {result.rightEnv}
              </span>
              <div className="tracediff-cols">
                {(() => {
                  const lq = queryCount(result.leftTrace!);
                  const rq = queryCount(result.rightTrace!);
                  const warnL = lq > 5 && lq > rq * 3;
                  const warnR = rq > 5 && rq > lq * 3;
                  return (
                    <>
                      <TraceCol env={result.leftEnv} trace={result.leftTrace!} warn={warnL} />
                      <TraceCol env={result.rightEnv} trace={result.rightTrace!} warn={warnR} />
                    </>
                  );
                })()}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
