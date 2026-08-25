import { useState } from "react";
import type { TraceData, TraceEvent } from "../types";
import { highlightJson } from "../lib/format";

const KIND_CLASS: Record<string, string> = {
  route: "c-info",
  check: "c-accent",
  cache: "c-faint",
  query: "c-purple",
  error: "c-err",
  response: "c-ok",
};
const KIND_LABEL: Record<string, string> = {
  route: "rota",
  check: "check",
  cache: "cache",
  query: "query",
  error: "erro",
  response: "resp",
};

function Payload({ data }: { data: unknown }) {
  if (typeof data === "string")
    return <pre className="trace-payload-pre">{data}</pre>;
  return (
    <pre
      className="trace-payload-pre"
      dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(data, null, 2)) }}
    />
  );
}

function EventRow({
  ev,
  next,
  span,
  pulsing,
}: {
  ev: TraceEvent;
  next: TraceEvent | undefined;
  span: number;
  pulsing: boolean;
}) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const isErr = ev.kind === "error";
  const gap = next ? next.t - ev.t : 0;
  const barH = next ? Math.max(6, Math.round((gap / span) * 130)) : 0;
  const kindCls = KIND_CLASS[ev.kind] ?? "c-dim";
  const hasPayload = ev.data !== undefined && !pulsing;
  const payloadKind = typeof ev.data === "string" ? "texto" : "json";

  return (
    <div className="trace-row">
      <span className="trace-off">+{ev.t}ms</span>
      <div className="trace-rail">
        <span
          className={"trace-dot " + kindCls + (pulsing ? " pulsing" : "") + (isErr ? " err" : "")}
        />
        {next && <span className={"trace-bar" + (isErr ? " err" : "")} style={{ height: barH }} />}
      </div>
      <div className="trace-body">
        <div className="trace-line">
          <span className={"trace-kind " + kindCls}>{KIND_LABEL[ev.kind] ?? ev.kind}</span>
          <span className={"trace-label" + (pulsing ? " c-accent" : isErr ? " c-err" : "")}>
            {pulsing ? "executando…" : ev.label}
          </span>
          {ev.dur !== undefined && <span className="trace-dur">({ev.dur}ms)</span>}
        </div>
        {hasPayload && (
          <>
            <button className="trace-mini-btn" onClick={() => setPayloadOpen((o) => !o)}>
              {payloadOpen ? "ocultar dados" : `ver dados · ${payloadKind}`}
            </button>
            {payloadOpen && (
              <div className="trace-payload">
                <Payload data={ev.data} />
              </div>
            )}
          </>
        )}
        {isErr && ev.at && (
          <div className="trace-at">
            em <span className="c-accent">{ev.at}</span>
          </div>
        )}
        {isErr && (ev.stack?.length ?? 0) > 0 && (
          <>
            <button className="trace-mini-btn err" onClick={() => setStackOpen((o) => !o)}>
              {stackOpen ? "ocultar stack" : `ver stack (${ev.stack!.length})`}
            </button>
            {stackOpen && (
              <div className="trace-stack">
                {ev.stack!.map((s, i) => (
                  <div key={i} className="trace-stack-line">{s}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TraceTab({
  trace,
  live,
  port,
}: {
  trace: TraceData | null;
  live: boolean;
  port: number;
}) {
  if (!trace || trace.events.length === 0) {
    if (live)
      return (
        <div className="hint-block">
          <span className="pulse-dot" style={{ display: "inline-block", marginRight: 10 }} />
          aguardando eventos do app…
        </div>
      );
    return (
      <div style={{ maxWidth: 560 }}>
        <div className="trace-onboard-title">Veja a execução por dentro</div>
        <div className="modal-hint">
          Instale <span className="mono c-accent">@raio/trace</span> no seu app para o raio gravar
          checkpoints do código enquanto a request executa — queries, checks manuais e exceptions
          com stack. A lib só faz um POST local para o raio.
        </div>
        <div className="code-panel" style={{ background: "#1c1813" }}>
          <div className="code-panel-head">
            <span className="chip-sq" />
            <span>terminal + app.js</span>
          </div>
          <pre className="export-pre" style={{ fontSize: 12.5, lineHeight: 1.85 }}>
{`# instala a lib
npm i @raio/trace

// app.js — Express
const raio = require('@raio/trace');
app.use(raio.middleware({ raioUrl: 'http://127.0.0.1:${port}' }));`}
          </pre>
        </div>
        <div className="trace-onboard-hint">
          depois marque pontos no seu código com{" "}
          <span className="c-accent">raio.check('busca-usuario')</span> — eles aparecem aqui.
        </div>
      </div>
    );
  }

  const evs = trace.events;
  const span = Math.max(evs[evs.length - 1].t, 1);
  const showGhost = live && !trace.done;

  return (
    <div style={{ padding: "2px 2px 0" }}>
      {evs.map((ev, i) => (
        <EventRow key={i} ev={ev} next={evs[i + 1]} span={span} pulsing={false} />
      ))}
      {showGhost && (
        <div className="trace-row">
          <span className="trace-off" />
          <div className="trace-rail">
            <span className="trace-dot c-accent pulsing" />
          </div>
          <div className="trace-body">
            <div className="trace-line">
              <span className="trace-label c-accent">executando…</span>
            </div>
          </div>
        </div>
      )}
      {!showGhost && (
        <div className="trace-footer">
          trace via @raio/trace
          {trace.source && <> · {trace.source}</>}
          {trace.runtime && <> · {trace.runtime}</>} · {evs.length} eventos
        </div>
      )}
    </div>
  );
}
