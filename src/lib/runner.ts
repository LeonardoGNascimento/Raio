import { api } from "../api";
import { buildSendSpec, resolveBase, withBase } from "./spec";
import { contractForHistory, evaluateContract } from "./contract";
import { runChecks } from "./checks";
import {
  slaBreached,
  type Collection,
  type HistoryEntry,
  type RequestDef,
} from "../types";

export interface RouteRun {
  ok: boolean;
  problems: string[]; // descrições curtas ("contrato: 2 violações", "status 500"…)
}

/**
 * Executa uma rota no ambiente dado, grava histórico e devolve os problemas.
 * Usado pelo vigia por rota.
 */
export async function runRoute(
  coll: Collection,
  folder: string | null,
  req: RequestDef,
  spec: Record<string, unknown> | null,
  envName: string,
): Promise<RouteRun> {
  const baseEnv = coll.environments.find((e) => e.name === envName) ?? null;
  const env = withBase(baseEnv, resolveBase(coll, envName));
  const problems: string[] = [];

  try {
    const sendSpec = buildSendSpec(req, env);
    const resp = await api.sendRequest(sendSpec);
    const contentType = resp.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
    const contract = evaluateContract(req, spec, env, resp.status, contentType, resp.body);
    const checkResults = runChecks(req.checks ?? "", resp);
    const failedChecks = checkResults.filter((c) => !c.ok);

    if (resp.status >= 500) problems.push(`status ${resp.status}`);
    if (contract.kind === "violations")
      problems.push(`contrato: ${contract.violations.length} violações`);
    if (slaBreached(resp.total_ms, req.max_ms))
      problems.push(`SLA: ${resp.total_ms}ms > ${req.max_ms}ms`);
    if (failedChecks.length > 0) problems.push(`${failedChecks.length} check(s) falharam`);

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
      body: resp.is_binary ? "" : resp.body,
      headers: resp.headers,
      trace_error: false,
      method: req.method,
      url: sendSpec.url,
      request_body: "",
      contract: contractForHistory(req, spec, contract),
      max_ms: req.max_ms ?? null,
      checks_total: checkResults.length,
      checks_failed: failedChecks.length,
    };
    api.appendHistory(coll.name, folder, req.name, entry).catch(() => {});
  } catch (e) {
    problems.push("rede: " + String(e));
  }
  return { ok: problems.length === 0, problems };
}
