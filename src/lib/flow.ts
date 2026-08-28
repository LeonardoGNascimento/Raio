import { api } from "../api";
import { buildSendSpec, resolveBase, withBase } from "./spec";
import { contractForHistory, evaluateContract } from "./contract";
import { runChecks } from "./checks";
import { getByPath } from "./jsonpath";
import { interpolate } from "./interpolate";
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
  kind: "start" | "request" | "delay" | "log" | "cond" | "setvar";
  x: number;
  y: number;
  /** request node: id da request na collection */
  requestId?: string;
  /** delay node: espera em ms */
  delayMs?: number;
  /** log node: mensagem impressa no painel ({{vars}} interpoladas) */
  message?: string;
  /** cond node (legado): expressão tipo "{{total}} > 10" */
  expr?: string;
  /** cond node estruturado: valor, operador, comparação */
  condLeft?: string;
  condOp?: string;
  condRight?: string;
  /** setvar node */
  varName?: string;
  varValue?: string;
}

export const COND_OPS: [string, string][] = [
  ["==", "é igual a"],
  ["!=", "é diferente de"],
  [">", "é maior que"],
  ["<", "é menor que"],
  [">=", "é maior ou igual a"],
  ["<=", "é menor ou igual a"],
  ["contains", "contém"],
  ["exists", "existe (tem valor)"],
];

export function condOpLabel(op: string): string {
  return COND_OPS.find(([o]) => o === op)?.[1] ?? op;
}

/** nós com duas saídas (sucesso/falha) */
export const DUAL_PORT_KINDS = new Set(["request", "cond"]);

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  cond: EdgeCond;
}

/** resultado salvo de um nó (steps estilo n8n): permite rodar dali em diante */
export interface SavedOutput {
  at: string; // ISO
  ok: boolean;
  status?: number;
  totalMs?: number;
  /** vars acumuladas ANTES do nó rodar — semente para "rodar daqui" */
  varsBefore: Record<string, string>;
  /** vars acumuladas DEPOIS (inclui extraídas por ele) */
  varsAfter: Record<string, string>;
}

export interface Flow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** últimas execuções salvas por nó */
  saved?: Record<string, SavedOutput>;
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

export interface FlowLogEntry {
  at: string; // HH:MM:SS
  kind: "info" | "ok" | "err" | "print";
  text: string;
}

interface RunCallbacks {
  onNode: (nodeId: string, state: NodeResult | "running") => void;
  onVars: (vars: Record<string, string>) => void;
  onLog: (entry: FlowLogEntry) => void;
}

const now = () => new Date().toTimeString().slice(0, 8);

const COND_RE = /^(.+?)\s*(==|!=|>=|<=|>|<|contains|exists)\s*(.*)$/;

/** compara valores já interpolados */
export function evalCondParts(left: string, op: string, right: string): boolean {
  const l = left.trim();
  const r = right.trim();
  if (op === "exists") return l.length > 0 && !l.includes("{{");
  if (op === "contains") return l.includes(r);
  const ln = Number(l);
  const rn = Number(r);
  const numeric = l !== "" && r !== "" && !Number.isNaN(ln) && !Number.isNaN(rn);
  switch (op) {
    case "==": return numeric ? ln === rn : l === r;
    case "!=": return numeric ? ln !== rn : l !== r;
    case ">": return numeric && ln > rn;
    case "<": return numeric && ln < rn;
    case ">=": return numeric && ln >= rn;
    case "<=": return numeric && ln <= rn;
    default: return false;
  }
}

/** avalia expressão legada já interpolada: "a == b", "x > 10", "v exists" */
export function evalCond(resolved: string): boolean {
  const m = resolved.trim().match(COND_RE);
  if (!m) return resolved.trim().length > 0; // sem operador: truthy = não vazio
  const [, left, op, right] = m;
  return evalCondParts(left, op, right);
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
export interface RunOptions {
  /** roda a partir deste nó (semente = vars salvas do passo anterior) */
  startId?: string;
  seedVars?: Record<string, string>;
}

export async function runFlow(
  flow: Flow,
  coll: Collection,
  spec: Record<string, unknown> | null,
  envName: string,
  cb: RunCallbacks,
  opts: RunOptions = {},
): Promise<Record<string, SavedOutput>> {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const reqIndex = new Map(
    flattenRequests(coll).map(({ folder, req }) => [req.id, { folder, req }]),
  );
  const vars: Record<string, string> = { ...(opts.seedVars ?? {}) };
  const visited = new Set<string>();
  const saved: Record<string, SavedOutput> = {};
  const meta: Record<string, { status?: number; totalMs?: number }> = {};

  const start = opts.startId
    ? flow.nodes.find((n) => n.id === opts.startId)
    : flow.nodes.find((n) => n.kind === "start");
  if (!start) return saved;
  if (opts.startId) {
    const seedCount = Object.keys(vars).length;
    cb.onLog({
      at: now(),
      kind: "info",
      text: `▶ rodando a partir deste nó · ${seedCount > 0 ? seedCount + " variável(is) do passo salvo" : "sem dados salvos do passo anterior"} · ambiente ${envName || "(nenhum)"}`,
    });
    if (seedCount > 0) cb.onVars({ ...vars });
  } else {
    cb.onLog({ at: now(), kind: "info", text: `fluxo "${flow.name}" · ambiente ${envName || "(nenhum)"}` });
  }

  /** ambiente + vars acumuladas, para interpolar mensagens/condições */
  const envNow = () => {
    const baseEnv = coll.environments.find((e) => e.name === envName) ?? null;
    const overlay: Environment = {
      name: baseEnv?.name ?? "(fluxo)",
      vars: [...(baseEnv?.vars ?? []), ...Object.entries(vars)] as [string, string][],
    };
    return withBase(overlay, resolveBase(coll, envName)) ?? overlay;
  };

  /** executa um nó e devolve o resultado da ramificação */
  const execNode = async (node: FlowNode): Promise<"success" | "fail"> => {
    if (node.kind === "request") {
      const target = node.requestId ? reqIndex.get(node.requestId) : undefined;
      if (!target) {
        cb.onNode(node.id, { ok: false, problems: ["request não existe mais"], extracted: [] });
        cb.onLog({ at: now(), kind: "err", text: "nó aponta para request que não existe mais" });
        return "fail";
      }
      cb.onNode(node.id, "running");
      cb.onLog({ at: now(), kind: "info", text: `→ ${target.req.method} ${target.req.name}` });
      const result = await runFlowRequest(coll, target.folder, target.req, spec, envName, vars);
      for (const [k, v] of result.extracted) vars[k] = v;
      cb.onVars({ ...vars });
      cb.onNode(node.id, result);
      meta[node.id] = { status: result.status, totalMs: result.totalMs };
      const head = `${target.req.method} ${target.req.name} · ${result.status ?? "?"} · ${result.totalMs ?? "?"}ms`;
      if (result.ok) cb.onLog({ at: now(), kind: "ok", text: `✓ ${head}` });
      else cb.onLog({ at: now(), kind: "err", text: `✗ ${head} — ${result.problems.join(" · ")}` });
      for (const [k, v] of result.extracted)
        cb.onLog({ at: now(), kind: "info", text: `  {{${k}}} = ${v.length > 60 ? v.slice(0, 60) + "…" : v}` });
      return result.ok ? "success" : "fail";
    }
    if (node.kind === "delay") {
      cb.onNode(node.id, "running");
      cb.onLog({ at: now(), kind: "info", text: `⏱ aguardando ${node.delayMs ?? 1000}ms` });
      await new Promise((r) => setTimeout(r, node.delayMs ?? 1000));
      cb.onNode(node.id, { ok: true, problems: [], extracted: [] });
      return "success";
    }
    if (node.kind === "log") {
      const msg = interpolate(node.message ?? "", envNow());
      cb.onLog({ at: now(), kind: "print", text: msg || "(log vazio)" });
      cb.onNode(node.id, { ok: true, problems: [], extracted: [] });
      return "success";
    }
    if (node.kind === "cond") {
      const env = envNow();
      let pass: boolean;
      let shown: string;
      if (node.condOp) {
        const l = interpolate(node.condLeft ?? "", env);
        const r = interpolate(node.condRight ?? "", env);
        pass = evalCondParts(l, node.condOp, r);
        shown = `${l} ${condOpLabel(node.condOp)}${node.condOp === "exists" ? "" : " " + r}`;
      } else {
        const resolved = interpolate(node.expr ?? "", env);
        pass = evalCond(resolved);
        shown = resolved;
      }
      cb.onLog({
        at: now(),
        kind: pass ? "ok" : "err",
        text: `? ${shown} → ${pass ? "verdadeiro" : "falso"}`,
      });
      cb.onNode(node.id, { ok: pass, problems: pass ? [] : ["condição falsa"], extracted: [] });
      return pass ? "success" : "fail";
    }
    if (node.kind === "setvar") {
      const name = (node.varName ?? "").trim();
      if (name) {
        vars[name] = interpolate(node.varValue ?? "", envNow());
        cb.onVars({ ...vars });
        cb.onLog({ at: now(), kind: "info", text: `✏ {{${name}}} = ${vars[name]}` });
      }
      cb.onNode(node.id, { ok: true, problems: [], extracted: [] });
      return "success";
    }
    return "success"; // start
  };

  // execução em ondas: ramificações da mesma onda rodam em paralelo
  let wave: string[] = [start.id];
  while (wave.length > 0) {
    const batch = [...new Set(wave)].filter((id) => !visited.has(id) && byId.has(id));
    batch.forEach((id) => visited.add(id));
    if (batch.length === 0) break;
    if (batch.length > 1)
      cb.onLog({ at: now(), kind: "info", text: `⇉ ${batch.length} ramos em paralelo` });

    const outcomes = await Promise.all(
      batch.map(async (id) => {
        const varsBefore = { ...vars };
        const startedAt = new Date().toISOString();
        const outcome = await execNode(byId.get(id)!);
        return { id, outcome, varsBefore, startedAt };
      }),
    );
    for (const { id, outcome, varsBefore, startedAt } of outcomes) {
      if (byId.get(id)!.kind === "start") continue;
      saved[id] = {
        at: startedAt,
        ok: outcome === "success",
        status: meta[id]?.status,
        totalMs: meta[id]?.totalMs,
        varsBefore,
        varsAfter: { ...vars },
      };
    }

    const next: string[] = [];
    for (const { id, outcome } of outcomes) {
      for (const edge of flow.edges.filter((e) => e.from === id)) {
        const pass =
          edge.cond === "always" ||
          (edge.cond === "success" && outcome === "success") ||
          (edge.cond === "fail" && outcome === "fail");
        if (pass) next.push(edge.to);
        else if (!visited.has(edge.to)) {
          const reachableOther = flow.edges.some(
            (e) => e.to === edge.to && e.id !== edge.id && !visited.has(e.from),
          );
          if (!reachableOther)
            cb.onNode(edge.to, { ok: true, problems: [], extracted: [], skipped: true });
        }
      }
    }
    wave = next;
  }
  cb.onLog({ at: now(), kind: "info", text: "fim do fluxo" });
  return saved;
}
