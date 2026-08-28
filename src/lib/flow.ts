import { api } from "../api";
import { buildSendSpec, resolveBase, withBase } from "./spec";
import { contractForHistory, evaluateContract } from "./contract";
import { runChecks } from "./checks";
import { getByPath } from "./jsonpath";
import {
  flattenRequests,
  slaBreached,
  type Collection,
  type Environment,
  type HistoryEntry,
  type RequestDef,
} from "../types";

// ---------- modelo ----------

export type EdgeCond = "always" | "success" | "fail";

export interface FlowNode {
  id: string;
  kind: "start" | "request" | "delay";
  x: number;
  y: number;
  /** request node: id da request na collection */
  requestId?: string;
  /** delay node: espera em ms */
  delayMs?: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  cond: EdgeCond;
}

export interface Flow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function newFlow(name: string): Flow {
  return {
    id: crypto.randomUUID(),
    name,
    nodes: [{ id: crypto.randomUUID(), kind: "start", x: 60, y: 200 }],
    edges: [],
  };
}

// ---------- execução ----------

export interface NodeResult {
  ok: boolean;
  status?: number;
  totalMs?: number;
  problems: string[];
  extracted: [string, string][];
  skipped?: boolean;
}

export interface FlowRunState {
  running: boolean;
  /** por nó: "running" | resultado */
  results: Record<string, NodeResult | "running">;
  vars: Record<string, string>;
}

interface RunCallbacks {
  onNode: (nodeId: string, state: NodeResult | "running") => void;
  onVars: (vars: Record<string, string>) => void;
}

/** roda uma request do fluxo com as vars de sessão acumuladas */
async function runFlowRequest(
  coll: Collection,
  folder: string | null,
  req: RequestDef,
  spec: Record<string, unknown> | null,
  envName: string,
  vars: Record<string, string>,
): Promise<NodeResult> {
  const baseEnv = coll.environments.find((e) => e.name === envName) ?? null;
  const overlay: Environment = {
    name: baseEnv?.name ?? "(fluxo)",
    vars: [...(baseEnv?.vars ?? []), ...Object.entries(vars)] as [string, string][],
  };
  const env = withBase(overlay, resolveBase(coll, envName));
  const problems: string[] = [];
  const extracted: [string, string][] = [];

  try {
    const sendSpec = buildSendSpec(req, env);
    const resp = await api.sendRequest(sendSpec);
    const contentType = resp.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
    const contract = evaluateContract(req, spec, env, resp.status, contentType, resp.body);
    const checkResults = runChecks(req.checks ?? "", resp);
    const failedChecks = checkResults.filter((c) => !c.ok);

    if (resp.status >= 400) problems.push(`status ${resp.status}`);
    if (contract.kind === "violations")
      problems.push(`contrato: ${contract.violations.length} violações`);
    if (slaBreached(resp.total_ms, req.max_ms))
      problems.push(`SLA: ${resp.total_ms}ms > ${req.max_ms}ms`);
    if (failedChecks.length > 0) problems.push(`${failedChecks.length} check(s) falharam`);

    if (req.extract?.length && !resp.is_binary) {
      try {
        const parsed = JSON.parse(resp.body);
        for (const [varName, path] of req.extract) {
          if (!varName.trim()) continue;
          const v = getByPath(parsed, path);
          if (v !== undefined) extracted.push([varName, String(v)]);
        }
      } catch {
        /* body não é JSON: sem extração */
      }
    }

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

    return {
      ok: problems.length === 0,
      status: resp.status,
      totalMs: resp.total_ms,
      problems,
      extracted,
    };
  } catch (e) {
    return { ok: false, problems: ["rede: " + String(e)], extracted: [] };
  }
}

/**
 * Executa o fluxo a partir do nó start, seguindo arestas cuja condição bate
 * com o resultado do nó de origem. Vars extraídas encadeiam para os próximos.
 */
export async function runFlow(
  flow: Flow,
  coll: Collection,
  spec: Record<string, unknown> | null,
  envName: string,
  cb: RunCallbacks,
): Promise<void> {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const reqIndex = new Map(
    flattenRequests(coll).map(({ folder, req }) => [req.id, { folder, req }]),
  );
  const vars: Record<string, string> = {};
  const visited = new Set<string>();

  const start = flow.nodes.find((n) => n.kind === "start");
  if (!start) return;

  // fila sequencial: nó -> roda -> enfileira saídas compatíveis
  const queue: string[] = [start.id];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue; // proteção contra ciclo
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) continue;

    let outcome: "success" | "fail" = "success";
    if (node.kind === "request") {
      const target = node.requestId ? reqIndex.get(node.requestId) : undefined;
      if (!target) {
        cb.onNode(nodeId, { ok: false, problems: ["request não existe mais"], extracted: [] });
        outcome = "fail";
      } else {
        cb.onNode(nodeId, "running");
        const result = await runFlowRequest(coll, target.folder, target.req, spec, envName, vars);
        for (const [k, v] of result.extracted) vars[k] = v;
        cb.onVars({ ...vars });
        cb.onNode(nodeId, result);
        outcome = result.ok ? "success" : "fail";
      }
    } else if (node.kind === "delay") {
      cb.onNode(nodeId, "running");
      await new Promise((r) => setTimeout(r, node.delayMs ?? 1000));
      cb.onNode(nodeId, { ok: true, problems: [], extracted: [] });
    }

    for (const edge of flow.edges.filter((e) => e.from === nodeId)) {
      const pass =
        edge.cond === "always" ||
        (edge.cond === "success" && outcome === "success") ||
        (edge.cond === "fail" && outcome === "fail");
      if (pass) queue.push(edge.to);
      else if (!visited.has(edge.to)) {
        // marca destinos não alcançados como pulados (visual)
        const reachableOther = flow.edges.some(
          (e) => e.to === edge.to && e.id !== edge.id && !visited.has(e.from),
        );
        if (!reachableOther)
          cb.onNode(edge.to, { ok: true, problems: [], extracted: [], skipped: true });
      }
    }
  }
}
