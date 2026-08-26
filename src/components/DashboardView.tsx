import { useCallback, useEffect, useRef, useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { exportPostman, textToBase64 } from "../lib/importers";
import { buildSendSpec, resolveBase, withBase } from "../lib/spec";
import type { ContractState } from "../lib/openapi";
import { contractForHistory, evaluateContract } from "../lib/contract";
import { jsonDiff, tryParse } from "../lib/jsonDiff";
import { formatMs } from "../lib/format";
import { METHOD_CLASS, flattenRequests, slaBreached, statusClass, type Collection, type Environment, type HistoryEntry, type RequestDef, type Snapshot } from "../types";

type SpecJson = Record<string, unknown>;
type SnapState = "none" | "same" | "changed";

interface Row {
  folder: string | null;
  req: RequestDef;
  last: HistoryEntry | null;
  snapshot: Snapshot | null;
  running: boolean;
  netError: string | null;
}

interface Props {
  collection: Collection;
  spec: SpecJson | null;
  env: Environment | null;
  envName: string;
  onOpenRequest: (folder: string | null, req: RequestDef) => void;
  onClose: () => void;
}

function contractOf(spec: SpecJson | null, row: Row, env: Environment | null): ContractState {
  if (!row.last) return { kind: "no-spec" };
  const contentType = row.last.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
  return evaluateContract(row.req, spec, env, row.last.status, contentType, row.last.body);
}

function snapStateOf(row: Row): SnapState {
  if (!row.snapshot || !row.last) return row.snapshot ? "same" : "none";
  if (row.snapshot.status !== row.last.status) return "changed";
  const a = tryParse(row.snapshot.body);
  const b = tryParse(row.last.body);
  if (a.ok && b.ok) return jsonDiff(a.value, b.value).length > 0 ? "changed" : "same";
  return row.snapshot.body !== row.last.body ? "changed" : "same";
}

export function DashboardView({
  collection,
  spec,
  env,
  envName,
  onOpenRequest,
  onClose,
}: Props) {
  const allRequests = flattenRequests(collection);

  const [rows, setRows] = useState<Row[]>(() =>
    allRequests.map(({ folder, req }) => ({
      folder,
      req,
      last: null,
      snapshot: null,
      running: false,
      netError: null,
    })),
  );
  const [runningAll, setRunningAll] = useState(false);

  const envForRow = (_folder: string | null): Environment | null =>
    withBase(env, resolveBase(collection, envName));
  const cancelRef = useRef(false);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.req.id === id ? { ...r, ...patch } : r)));

  // carrega último envio + snapshot de cada rota
  const loadAll = useCallback(() => {
    for (const { folder, req } of allRequests) {
      api
        .loadHistory(collection.name, folder, req.name)
        .then((h) => patchRow(req.id, { last: h[h.length - 1] ?? null }))
        .catch(() => {});
      api
        .loadSnapshot(collection.name, folder, req.name)
        .then((s) => patchRow(req.id, { snapshot: s }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.name]);

  useEffect(() => {
    loadAll();
    return () => {
      cancelRef.current = true;
    };
  }, [loadAll]);

  const runAll = async () => {
    setRunningAll(true);
    cancelRef.current = false;
    for (const { folder, req } of allRequests) {
      if (cancelRef.current) break;
      patchRow(req.id, { running: true, netError: null });
      try {
        const rowEnv = envForRow(folder);
        const sendSpec = buildSendSpec(req, rowEnv);
        const resp = await api.sendRequest(sendSpec);
        const contentType = resp.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
        const cState = evaluateContract(req, spec, rowEnv, resp.status, contentType, resp.body);
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          env: envName,
          status: resp.status,
          status_text: resp.status_text,
          ttfb_ms: resp.ttfb_ms,
          total_ms: resp.total_ms,
          size_bytes: resp.size_bytes,
          http_version: resp.http_version,
          body: resp.body,
          headers: resp.headers,
          trace_error: false,
          method: req.method,
          url: sendSpec.url,
          request_body: sendSpec.body ?? "",
          contract: contractForHistory(req, spec, cState),
          max_ms: req.max_ms ?? null,
        };
        api.appendHistory(collection.name, folder, req.name, entry).catch(() => {});
        patchRow(req.id, { last: entry, running: false });
      } catch (e) {
        patchRow(req.id, { running: false, netError: String(e) });
      }
    }
    setRunningAll(false);
  };

  // saúde geral
  let bad = 0;
  let warn = 0;
  let okCount = 0;
  let pending = 0;
  for (const row of rows) {
    const c = contractOf(spec, row, envForRow(row.folder));
    const s = snapStateOf(row);
    if (!row.last && !row.netError) {
      pending++;
      continue;
    }
    const slaMiss = !!row.last && slaBreached(row.last.total_ms, row.last.max_ms);
    if (row.netError || (row.last && row.last.status >= 500) || c.kind === "violations" || row.last?.trace_error) bad++;
    else if ((row.last && row.last.status >= 400) || s === "changed" || slaMiss) warn++;
    else okCount++;
  }
  const health =
    bad > 0
      ? { label: "com problemas", cls: "c-err" }
      : warn > 0
        ? { label: "requer atenção", cls: "c-warn" }
        : okCount > 0
          ? { label: "API saudável", cls: "c-ok" }
          : { label: "sem execuções ainda", cls: "c-faint" };

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="ed-crumb">collection</div>
          <div className="dash-title">
            {collection.name}
            {collection.has_spec && <span className="spec-badge" style={{ marginLeft: 10 }}>✓ spec</span>}
          </div>
        </div>
        <span className={"dash-health mono " + health.cls}>{health.label}</span>
        <div className="dash-counts mono">
          <span className="c-ok">{okCount} {okCount === 1 ? "rota saudável" : "rotas saudáveis"}</span>
          <span className="c-warn">{warn} em atenção</span>
          <span className="c-err">{bad} com problema</span>
          {pending > 0 && <span className="c-faint">{pending} sem execução</span>}
        </div>
        <div style={{ flex: 1 }} />
        {runningAll ? (
          <button className="btn-danger-ghost" onClick={() => (cancelRef.current = true)}>
            parar
          </button>
        ) : (
          <button className="btn-primary" onClick={runAll} disabled={allRequests.length === 0}>
            ▶ rodar tudo · {envName || "(sem env)"}
          </button>
        )}
        <button
          className="btn-ghost"
          title="exporta a collection no formato Postman v2.1"
          onClick={async () => {
            try {
              const path = await saveFileDialog({
                defaultPath: `${collection.name}.postman_collection.json`,
                title: "Exportar collection",
              });
              if (typeof path === "string")
                await api.saveBody(path, textToBase64(exportPostman(collection)));
            } catch (e) {
              alert(String(e));
            }
          }}
        >
          exportar
        </button>
        <button className="btn-ghost" onClick={onClose}>fechar</button>
      </div>

      <div className="dash-grid-head mono">
        <span>rota</span>
        <span>último status</span>
        <span>tempo</span>
        <span>contrato</span>
        <span>snapshot</span>
        <span>trace</span>
      </div>

      <div className="dash-list">
        {rows.map((row) => {
          const c = contractOf(spec, row, envForRow(row.folder));
          const s = snapStateOf(row);
          return (
            <div
              key={row.req.id}
              className="dash-row"
              onClick={() => onOpenRequest(row.folder, row.req)}
              title="abrir request"
            >
              <span className="dash-route mono">
                <span className={"req-method " + (METHOD_CLASS[row.req.method] ?? "c-dim")}>
                  {row.req.method}
                </span>
                <span className="dash-name">
                  {row.folder && <span className="c-faint">{row.folder}/</span>}
                  {row.req.name}
                </span>
              </span>

              <span className="mono">
                {row.running && <span className="c-accent">enviando…</span>}
                {!row.running && row.netError && (
                  <span className="c-err" title={row.netError}>✕ rede</span>
                )}
                {!row.running && !row.netError && row.last && (
                  <span className={statusClass(row.last.status)} style={{ fontWeight: 700 }}>
                    {row.last.status}
                  </span>
                )}
                {!row.running && !row.netError && !row.last && <span className="c-faint">—</span>}
              </span>

              <span
                className={
                  "mono " +
                  (row.last && slaBreached(row.last.total_ms, row.last.max_ms) ? "c-err" : "c-dim")
                }
                title={
                  row.last && slaBreached(row.last.total_ms, row.last.max_ms)
                    ? `estourou SLA de ${row.last.max_ms}ms`
                    : undefined
                }
              >
                {row.last && !row.running
                  ? formatMs(row.last.total_ms) +
                    (slaBreached(row.last.total_ms, row.last.max_ms) ? " · acima do SLA" : "")
                  : ""}
              </span>

              <span className="mono">
                {c.kind === "ok" && <span className="c-ok">válido</span>}
                {c.kind === "violations" && (
                  <span className="c-err">{c.violations.length} violações</span>
                )}
                {c.kind === "no-match" && <span className="c-faint">fora da spec</span>}
                {(c.kind === "no-schema" || c.kind === "not-json") && (
                  <span className="c-faint">sem schema</span>
                )}
                {c.kind === "no-spec" && <span className="c-faint">sem contrato</span>}
              </span>

              <span className="mono">
                {s === "same" && <span className="c-ok">igual</span>}
                {s === "changed" && <span className="c-warn">mudou</span>}
                {s === "none" && <span className="c-faint">sem snapshot</span>}
              </span>

              <span className="mono">
                {row.last?.trace_error ? (
                  <span className="c-err">erro interno</span>
                ) : (
                  <span className="c-faint">sem erro</span>
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="hint-block c-faint" style={{ padding: 16 }}>
            collection vazia — crie requests para o dashboard fazer sentido.
          </div>
        )}
      </div>
      <div className="trace-onboard-hint" style={{ padding: "0 20px 16px" }}>
        contrato e snapshot são avaliados sobre a última execução de cada rota · "rodar tudo"
        executa sequencial no ambiente atual e grava no histórico
      </div>
    </div>
  );
}
