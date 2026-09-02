import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { condOpLabel, DUAL_PORT_KINDS, hasOverrides, responseSuggestions, runFlow, newFlow, slugRef, type EdgeCond, type Flow, type FlowLogEntry, type FlowNode, type NodeResult } from "../lib/flow";
import type { Suggestion } from "./VarSuggest";
import { FlowNodeModal } from "./FlowNodeModal";
import { Modal } from "./Modal";
import { JsonTree } from "./JsonTree";
import { resolveBase, withBase } from "../lib/spec";
import { flattenRequests, METHOD_CLASS, type Collection } from "../types";
import { Dropdown } from "./Dropdown";

const NODE_W = 190;
const NODE_H = 56;

interface Props {
  collection: Collection;
  spec: Record<string, unknown> | null;
  envName: string;
  onOpenRequest: (folder: string | null, requestId: string) => void;
  /** abre já neste fluxo (vindo da sidebar) */
  initialFlowId?: string | null;
}

interface DragNode {
  id: string;
  dx: number;
  dy: number;
  /** houve arraste de verdade (clique parado abre a response) */
  moved: boolean;
}

interface Connecting {
  from: string;
  cond: EdgeCond;
  x: number;
  y: number;
}

const COND_LABEL: Record<EdgeCond, string> = {
  always: "sempre",
  success: "sucesso",
  fail: "falha",
};
const COND_NEXT: Record<EdgeCond, EdgeCond> = { success: "fail", fail: "always", always: "success" };
const COND_COLOR: Record<EdgeCond, string> = {
  always: "var(--dim)",
  success: "var(--ok)",
  fail: "var(--err)",
};

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 8} ${y2}`;
}

export function FlowView({ collection, spec, envName, onOpenRequest, initialFlowId }: Props) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragNode, setDragNode] = useState<DragNode | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, NodeResult | "running">>({});
  const [vars, setVars] = useState<Record<string, string>>({});
  const [log, setLog] = useState<FlowLogEntry[]>([]);
  const [cfgNode, setCfgNode] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
    edgeId?: string;
  } | null>(null);
  const [respNode, setRespNode] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const flow = flows.find((f) => f.id === flowId) ?? null;
  const nodeSuggestions = useMemo<Suggestion[]>(() => {
    if (!flow) return [];
    return responseSuggestions(flow, collection).map((h) => ({
      name: h.name,
      hint: h.hint,
      kind: "node" as const,
      container: h.container,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.saved, flow?.nodes, collection]);

  const modalEnv = useMemo(() => {
    const base = collection.environments.find((e) => e.name === envName) ?? null;
    return withBase(base, resolveBase(collection, envName));
  }, [collection, envName]);
  const requests = useMemo(() => flattenRequests(collection), [collection]);
  const reqById = useMemo(() => new Map(requests.map((r) => [r.req.id, r])), [requests]);

  useEffect(() => {
    api
      .loadFlows(collection.name)
      .then((raw) => {
        const list = Array.isArray(raw) ? (raw as Flow[]) : [];
        setFlows(list);
        setFlowId(
          (initialFlowId && list.some((f) => f.id === initialFlowId) ? initialFlowId : null) ??
            list[0]?.id ??
            null,
        );
      })
      .catch(() => setFlows([]));
    setResults({});
    setVars({});
    setDirty(false);
  }, [collection.name]);

  const patchFlow = (fn: (f: Flow) => Flow) => {
    if (!flow) return;
    setFlows((fs) => fs.map((f) => (f.id === flow.id ? fn(f) : f)));
    setDirty(true);
  };

  const save = async () => {
    try {
      await api.saveFlows(collection.name, flows);
      setDirty(false);
    } catch (e) {
      alert(String(e));
    }
  };

  const createFlow = (name: string) => {
    const f = newFlow(name.trim() || "fluxo");
    setFlows((fs) => [...fs, f]);
    setFlowId(f.id);
    setDirty(true);
    setNaming(null);
  };

  const addRequestNode = (requestId: string) => {
    const off = flow ? flow.nodes.length * 30 : 0;
    const reqName = reqById.get(requestId)?.req.name ?? "no";
    const base = slugRef(reqName);
    const used = new Set(flow?.nodes.map((n) => n.ref).filter(Boolean));
    let ref = base;
    for (let i = 2; used.has(ref); i++) ref = base + "-" + i;
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        {
          id: crypto.randomUUID(),
          kind: "request",
          requestId,
          ref,
          x: 300 + off - pan.x,
          y: 120 + off - pan.y,
        },
      ],
    }));
  };

  const addDelayNode = () => {
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        { id: crypto.randomUUID(), kind: "delay", delayMs: 1000, x: 320 - pan.x, y: 320 - pan.y },
      ],
    }));
  };

  const addCondNode = () => {
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        {
          id: crypto.randomUUID(),
          kind: "cond",
          condLeft: "{{id}}",
          condOp: "exists",
          condRight: "",
          x: 340 - pan.x / zoom,
          y: 240 - pan.y / zoom,
        },
      ],
    }));
  };

  const addVarNode = () => {
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        {
          id: crypto.randomUUID(),
          kind: "setvar",
          varName: "",
          varValue: "",
          x: 340 - pan.x / zoom,
          y: 300 - pan.y / zoom,
        },
      ],
    }));
  };

  const addLogNode = () => {
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        {
          id: crypto.randomUUID(),
          kind: "log",
          message: "",
          x: 360 - pan.x,
          y: 380 - pan.y,
        },
      ],
    }));
  };

  const removeNode = (id: string) => {
    patchFlow((f) => ({
      ...f,
      nodes: f.nodes.filter((n) => n.id !== id),
      edges: f.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelNode(null);
  };

  const removeEdge = (id: string) => {
    patchFlow((f) => ({ ...f, edges: f.edges.filter((e) => e.id !== id) }));
    setSelEdge(null);
  };

  const cycleEdge = (id: string) => {
    patchFlow((f) => ({
      ...f,
      edges: f.edges.map((e) => (e.id === id ? { ...e, cond: COND_NEXT[e.cond] } : e)),
    }));
  };

  // ---------- mouse ----------

  const canvasPos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    };
  };

  /** zoom com scroll, centrado no cursor */
  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.min(2, Math.max(0.35, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    // mantém o ponto sob o cursor fixo
    setPan({
      x: mx - ((mx - pan.x) / zoom) * next,
      y: my - ((my - pan.y) / zoom) * next,
    });
    setZoom(next);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragNode && flow) {
      if (!dragNode.moved) setDragNode({ ...dragNode, moved: true });
      const p = canvasPos(e);
      patchFlow((f) => ({
        ...f,
        nodes: f.nodes.map((n) =>
          n.id === dragNode.id ? { ...n, x: p.x - dragNode.dx, y: p.y - dragNode.dy } : n,
        ),
      }));
    } else if (panning) {
      setPan({ x: e.clientX - panning.x, y: e.clientY - panning.y });
    } else if (connecting) {
      const p = canvasPos(e);
      setConnecting({ ...connecting, x: p.x, y: p.y });
    }
  };

  const onMouseUp = () => {
    setDragNode(null);
    setPanning(null);
    setConnecting(null);
  };

  const openCtx = (e: React.MouseEvent, target: { nodeId?: string; edgeId?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current!.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, ...target });
    setSelNode(target.nodeId ?? null);
    setSelEdge(target.edgeId ?? null);
  };

  const finishConnect = (toId: string) => {
    if (!connecting || connecting.from === toId) return;
    const exists = flow?.edges.some(
      (e) => e.from === connecting.from && e.to === toId && e.cond === connecting.cond,
    );
    if (!exists)
      patchFlow((f) => ({
        ...f,
        edges: [
          ...f.edges,
          { id: crypto.randomUUID(), from: connecting.from, to: toId, cond: connecting.cond },
        ],
      }));
    setConnecting(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      setCtxMenu(null);
      if (selEdge) removeEdge(selEdge);
      else if (selNode && flow?.nodes.find((n) => n.id === selNode)?.kind !== "start")
        removeNode(selNode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selEdge, selNode, flow]);

  const runWith = async (opts: { startId?: string; seedVars?: Record<string, string> }) => {
    if (!flow || running) return;
    setRunning(true);
    setResults({});
    setVars({});
    setLog([]);
    setLogOpen(true);
    try {
      const saved = await runFlow(
        flow,
        collection,
        spec,
        envName,
        {
          onNode: (nodeId, state) => setResults((r) => ({ ...r, [nodeId]: state })),
          onVars: setVars,
          onLog: (entry) => setLog((l) => [...l, entry]),
        },
        opts,
      );
      // persiste os passos (steps) no fluxo, sem mexer no estado de dirty do desenho
      const updated = flows.map((f) =>
        f.id === flow.id ? { ...f, saved: { ...(f.saved ?? {}), ...saved } } : f,
      );
      setFlows(updated);
      api.saveFlows(collection.name, updated).catch(() => {});
    } finally {
      setRunning(false);
    }
  };

  const run = () => runWith({});

  const runFromNode = (nodeId: string) => {
    if (!flow) return;
    const step = flow.saved?.[nodeId];
    runWith({ startId: nodeId, seedVars: step?.varsBefore ?? {} });
  };

  // ---------- render ----------

  const nodeCenter = (n: FlowNode, side: "in" | "out", cond: EdgeCond = "always") => {
    let dy = 0;
    if (side === "out" && DUAL_PORT_KINDS.has(n.kind))
      dy = cond === "success" ? -12 : cond === "fail" ? 12 : 0;
    return { x: n.x + (side === "out" ? NODE_W : 0), y: n.y + NODE_H / 2 + dy };
  };

  const nodeCls = (n: FlowNode): string => {
    const r = results[n.id];
    if (r === "running") return " fl-running";
    if (typeof r === "object") {
      if (r.skipped) return " fl-skipped";
      return r.ok ? " fl-ok" : " fl-fail";
    }
    return "";
  };

  return (
    <div className="flow-view">
      <div className="flow-bar">
        <Dropdown
          button={() => (
            <button className="btn-ghost">
              ⛓ {flow ? flow.name : "sem fluxo"} <span className="caret">▾</span>
            </button>
          )}
        >
          {(close) => (
            <>
              {flows.map((f) => (
                <button
                  key={f.id}
                  className={"dd-item" + (f.id === flowId ? " active" : "")}
                  onClick={() => {
                    close();
                    setFlowId(f.id);
                    setResults({});
                    setVars({});
                  }}
                >
                  {f.name}
                </button>
              ))}
              <button className="dd-item" onClick={() => { close(); setNaming(""); }}>
                <span className="c-accent">＋</span> novo fluxo
              </button>
            </>
          )}
        </Dropdown>
        {naming !== null && (
          <input
            className="inp"
            autoFocus
            placeholder="nome do fluxo"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createFlow(naming);
              if (e.key === "Escape") setNaming(null);
            }}
            onBlur={() => setNaming(null)}
          />
        )}
        {flow && (
          <>
            <Dropdown
              button={() => <button className="btn-ghost">＋ request</button>}
            >
              {(close) => (
                <>
                  {requests.map(({ folder, req }) => (
                    <button
                      key={req.id}
                      className="dd-item"
                      onClick={() => {
                        close();
                        addRequestNode(req.id);
                      }}
                    >
                      <span className={METHOD_CLASS[req.method] ?? "c-dim"}>{req.method}</span>{" "}
                      {(folder ? folder + "/" : "") + req.name}
                    </button>
                  ))}
                  {requests.length === 0 && <div className="sb-empty">sem requests</div>}
                </>
              )}
            </Dropdown>
            <button className="btn-ghost" onClick={addDelayNode}>＋ delay</button>
            <button className="btn-ghost" onClick={addLogNode}>＋ log</button>
            <button className="btn-ghost" onClick={addCondNode}>＋ if</button>
            <button className="btn-ghost" onClick={addVarNode}>＋ var</button>
            <span className="flow-hint">
              arraste das portas ✓/✗ para conectar (várias saídas = paralelo) · scroll = zoom ·
              Delete apaga a seleção
            </span>
            <div style={{ flex: 1 }} />
            {selEdge && (
              <button className="btn-ghost" onClick={() => removeEdge(selEdge)}>
                excluir aresta
              </button>
            )}
            {selNode && flow.nodes.find((n) => n.id === selNode)?.kind !== "start" && (
              <>
                <button
                  className="btn-ghost"
                  title="roda deste nó em diante, usando as variáveis salvas do passo anterior"
                  onClick={() => runFromNode(selNode)}
                  disabled={running}
                >
                  ▶ rodar daqui
                </button>
                <button className="btn-ghost" onClick={() => removeNode(selNode)}>
                  excluir nó
                </button>
              </>
            )}
            {flow.saved && Object.keys(flow.saved).length > 0 && (
              <button
                className="btn-ghost"
                title="descarta os resultados salvos dos passos"
                onClick={() => {
                  patchFlow((f) => ({ ...f, saved: {} }));
                  setResults({});
                }}
              >
                limpar passos
              </button>
            )}
            <button className="btn-ghost" onClick={save} disabled={!dirty}>
              {dirty ? "salvar •" : "salvo"}
            </button>
            <button className="btn-primary" onClick={run} disabled={running}>
              {running ? "rodando…" : "▶ rodar (" + (envName || "sem ambiente") + ")"}
            </button>
          </>
        )}
      </div>

      {!flow && (
        <div className="flow-empty">
          <p>
            Fluxos encadeiam requests desta collection num canvas: crie um item, leia, atualize,
            delete — cada nó extrai variáveis para os próximos e valida contrato, checks e SLA.
          </p>
          <button className="btn-primary" onClick={() => setNaming("")}>＋ criar fluxo</button>
        </div>
      )}

      {flow && (
        <div
          ref={canvasRef}
          className="flow-canvas"
          onWheel={onWheel}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onMouseDown={(e) => {
            setCtxMenu(null);
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") {
              setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
              setSelEdge(null);
              setSelNode(null);
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg className="flow-svg" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {flow.edges.map((e) => {
              const from = flow.nodes.find((n) => n.id === e.from);
              const to = flow.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              const a = nodeCenter(from, "out", e.cond);
              const b = nodeCenter(to, "in");
              const onEdgeClick = (ev: React.MouseEvent) => {
                ev.stopPropagation();
                if (selEdge === e.id) cycleEdge(e.id);
                else setSelEdge(e.id);
              };
              return (
                <g key={e.id}>
                  <path
                    d={edgePath(a.x, a.y, b.x, b.y)}
                    className="flow-edge-hit"
                    onClick={onEdgeClick}
                    onContextMenu={(ev) => openCtx(ev, { edgeId: e.id })}
                  />
                  <path
                    d={edgePath(a.x, a.y, b.x, b.y)}
                    className={"flow-edge" + (selEdge === e.id ? " sel" : "")}
                    style={{ stroke: COND_COLOR[e.cond] }}
                    onClick={onEdgeClick}
                  />
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 7}
                    className="flow-edge-label"
                    style={{ fill: COND_COLOR[e.cond] }}
                  >
                    {COND_LABEL[e.cond]}
                  </text>
                </g>
              );
            })}
            {connecting && (() => {
              const from = flow.nodes.find((n) => n.id === connecting.from);
              if (!from) return null;
              const a = nodeCenter(from, "out", connecting.cond);
              return (
                <path
                  d={edgePath(a.x, a.y, connecting.x, connecting.y)}
                  className="flow-edge temp"
                />
              );
            })()}
          </svg>

          {ctxMenu && (() => {
            const node = ctxMenu.nodeId ? flow.nodes.find((n) => n.id === ctxMenu.nodeId) : null;
            const edge = ctxMenu.edgeId ? flow.edges.find((e) => e.id === ctxMenu.edgeId) : null;
            const item = (label: React.ReactNode, fn: () => void, danger = false) => (
              <button
                className={"dd-item" + (danger ? " ctx-danger" : "")}
                onClick={() => {
                  setCtxMenu(null);
                  fn();
                }}
              >
                {label}
              </button>
            );
            return (
              <div
                className="flow-ctx dd-menu"
                style={{ left: ctxMenu.x, top: ctxMenu.y }}
                // sem isso o mousedown borbulha para o canvas, que fecha o menu antes do click
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {node && node.kind === "request" && (
                  <>
                    {item("✎ abrir request", () => {
                      const t = node.requestId ? reqById.get(node.requestId) : undefined;
                      if (t) onOpenRequest(t.folder, t.req.id);
                    })}
                    {(typeof results[node.id] === "object" || flow.saved?.[node.id]?.body !== undefined) &&
                      item("👁 ver response", () => setRespNode(node.id))}
                    {item("▶ rodar daqui", () => runFromNode(node.id))}
                    {item("⚙ envio neste fluxo", () => setCfgNode(node.id))}
                  </>
                )}
                {node && node.kind !== "request" && item("✎ editar", () => setCfgNode(node.id))}
                {node && item("🗑 excluir nó", () => removeNode(node.id), true)}
                {edge && (
                  <>
                    {(["success", "fail", "always"] as EdgeCond[]).map((c) =>
                      item(
                        <span style={{ color: COND_COLOR[c] }}>
                          {edge.cond === c ? "● " : "○ "}condição: {COND_LABEL[c]}
                        </span>,
                        () =>
                          patchFlow((f) => ({
                            ...f,
                            edges: f.edges.map((x) => (x.id === edge.id ? { ...x, cond: c } : x)),
                          })),
                      ),
                    )}
                    {item("🗑 excluir aresta", () => removeEdge(edge.id), true)}
                  </>
                )}
              </div>
            );
          })()}
          <div className="flow-nodes" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {flow.nodes.map((n) => {
              const target = n.requestId ? reqById.get(n.requestId) : undefined;
              const r = results[n.id];
              const res = typeof r === "object" ? r : undefined;
              return (
                <div
                  key={n.id}
                  className={
                    "flow-node " + n.kind + nodeCls(n) + (selNode === n.id ? " sel" : "")
                  }
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  onContextMenu={(e) => n.kind !== "start" && openCtx(e, { nodeId: n.id })}
                  onMouseDown={(e) => {
                    if (e.button === 2) return; // botão direito: só menu
                    e.stopPropagation();
                    setSelNode(n.id);
                    setSelEdge(null);
                    setCtxMenu(null);
                    const p = canvasPos(e);
                    setDragNode({ id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false });
                  }}
                  onMouseUp={() => {
                    if (connecting) {
                      finishConnect(n.id);
                      return;
                    }
                    // clique parado numa request com resultado: abre a response
                    if (
                      dragNode?.id === n.id &&
                      !dragNode.moved &&
                      n.kind === "request" &&
                      (typeof results[n.id] === "object" || flow.saved?.[n.id]?.body !== undefined)
                    )
                      setRespNode(n.id);
                  }}
                  onDoubleClick={() => {
                    if (n.kind === "request" && target)
                      onOpenRequest(target.folder, target.req.id);
                    else if (n.kind !== "start") setCfgNode(n.id);
                  }}
                  title={
                    res && !res.skipped && res.problems.length > 0
                      ? res.problems.join("\n")
                      : n.kind === "request"
                        ? "clique vê a response · duplo clique abre a request"
                        : undefined
                  }
                >
                  {n.kind === "start" && <span className="flow-start-label">▶ início</span>}
                  {n.kind === "request" && (
                    <>
                      <span className={"flow-method " + (target ? METHOD_CLASS[target.req.method] ?? "c-dim" : "c-err")}>
                        {target?.req.method ?? "?"}
                      </span>
                      <span className="flow-summary">
                        <span className="flow-name">
                          {target ? target.req.name : "request removida"}
                        </span>
                        <span
                          className="flow-sub"
                          title={"use {{" + (n.ref ?? (target ? slugRef(target.req.name) : "")) + ".body.…}} nos próximos nós"}
                        >
                          #{n.ref ?? (target ? slugRef(target.req.name) : "?")}
                          {hasOverrides(n.overrides) && (
                            <span className="c-accent" title="tem body/params próprios deste fluxo"> · ✎ fluxo</span>
                          )}
                        </span>
                      </span>
                    </>
                  )}
                  {(n.kind === "cond" || n.kind === "setvar" || n.kind === "log" || n.kind === "delay") && (
                    <span className="flow-summary">
                      <span className="flow-title">
                        {n.kind === "cond" && "⑂ Se"}
                        {n.kind === "setvar" && "✏ Definir variável"}
                        {n.kind === "log" && "📋 Log"}
                        {n.kind === "delay" && "⏱ Esperar"}
                      </span>
                      <span className="flow-sub">
                        {n.kind === "cond" &&
                          (n.condOp
                            ? `${n.condLeft || "…"} ${condOpLabel(n.condOp)}${n.condOp === "exists" ? "" : " " + (n.condRight || "…")}`
                            : n.expr || "clique 2x para configurar")}
                        {n.kind === "setvar" &&
                          (n.varName
                            ? `${n.varScope === "global" ? "🌐 " : ""}{{${n.varName}}} = ${n.varValue || "…"}`
                            : "clique 2x para configurar")}
                        {n.kind === "log" && (n.message || "clique 2x para configurar")}
                        {n.kind === "delay" &&
                          ((n.delayMs ?? 1000) >= 1000
                            ? (n.delayMs ?? 1000) / 1000 + " segundo(s)"
                            : (n.delayMs ?? 1000) + "ms")}
                      </span>
                    </span>
                  )}
                  {n.kind !== "start" && (
                    <button
                      className="flow-gear"
                      title={n.kind === "request" ? "envio neste fluxo (body/headers/params)" : "configurar"}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setCfgNode(n.id)}
                    >
                      ⚙
                    </button>
                  )}
                  {res && !res.skipped && (
                    <span className={"flow-badge " + (res.ok ? "c-ok" : "c-err")}>
                      {res.status ?? (res.ok ? "✓" : "✗")}
                      {res.totalMs !== undefined ? ` · ${res.totalMs}ms` : ""}
                    </span>
                  )}
                  {res?.skipped && <span className="flow-badge c-faint">pulado</span>}
                  {!r && flow.saved?.[n.id] && (
                    <span
                      className="flow-badge flow-saved"
                      title={
                        "passo salvo às " +
                        new Date(flow.saved[n.id].at).toLocaleTimeString() +
                        " — selecione o nó e use ▶ rodar daqui"
                      }
                    >
                      💾 {flow.saved[n.id].status ?? (flow.saved[n.id].ok ? "✓" : "✗")}
                    </span>
                  )}
                  {n.kind !== "start" && <span className="flow-port in" />}
                  {DUAL_PORT_KINDS.has(n.kind) ? (
                    <>
                      <span
                        className="flow-port out ok"
                        title="saída de sucesso"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const p = canvasPos(e);
                          setConnecting({ from: n.id, cond: "success", x: p.x, y: p.y });
                        }}
                      />
                      <span
                        className="flow-port out fail"
                        title="saída de erro"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const p = canvasPos(e);
                          setConnecting({ from: n.id, cond: "fail", x: p.x, y: p.y });
                        }}
                      />
                    </>
                  ) : (
                    <span
                      className="flow-port out"
                      title="saída"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const p = canvasPos(e);
                        setConnecting({ from: n.id, cond: n.kind === "start" ? "always" : "always", x: p.x, y: p.y });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {flow && log.length > 0 && (
        <div className="flow-log">
          <button className="flow-log-head" onClick={() => setLogOpen(!logOpen)}>
            {logOpen ? "▾" : "▸"} log da execução ({log.length})
          </button>
          {logOpen && (
            <div className="flow-log-body" ref={logRef}>
              {log.map((l, i) => (
                <div key={i} className={"flow-log-line " + l.kind}>
                  <span className="flow-log-at">{l.at}</span>
                  {l.kind === "print" && <span className="flow-log-tag">log</span>}
                  <span className="flow-log-text">{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {respNode && flow && (() => {
        const node = flow.nodes.find((n) => n.id === respNode);
        const target = node?.requestId ? reqById.get(node.requestId) : undefined;
        if (!node) return null;
        const fresh = results[node.id];
        const freshRes = typeof fresh === "object" ? fresh : undefined;
        const step = flow.saved?.[node.id];
        const body = freshRes?.body ?? step?.body;
        const status = freshRes?.status ?? step?.status;
        const ms = freshRes?.totalMs ?? step?.totalMs;
        const when = freshRes ? "desta execução" : step ? "do passo salvo às " + new Date(step.at).toLocaleTimeString() : "";
        let parsed: unknown;
        let isJson = false;
        if (body) {
          try {
            parsed = JSON.parse(body);
            isJson = true;
          } catch {
            /* não é JSON: mostra texto puro */
          }
        }
        return (
          <Modal
            title={(target ? target.req.method + " " + target.req.name : "response") + (status !== undefined ? " · " + status : "") + (ms !== undefined ? " · " + ms + "ms" : "")}
            width={720}
            onClose={() => setRespNode(null)}
          >
            <div className="modal-hint">response {when}</div>
            <div className="flow-resp-body">
              {body === undefined && <span className="c-faint">sem body salvo para este nó — rode o fluxo.</span>}
              {body !== undefined && isJson && <JsonTree value={parsed} />}
              {body !== undefined && !isJson && <pre className="flow-resp-raw">{body}</pre>}
            </div>
            <div className="modal-foot">
              {body !== undefined && (
                <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(body)}>
                  copiar body
                </button>
              )}
              <button className="btn-primary" onClick={() => setRespNode(null)}>Fechar</button>
            </div>
          </Modal>
        );
      })()}
      {cfgNode && flow && (() => {
        const node = flow.nodes.find((n) => n.id === cfgNode);
        if (!node) return null;
        return (
          <FlowNodeModal
            node={node}
            env={modalEnv}
            nodeSuggestions={nodeSuggestions}
            onClose={() => setCfgNode(null)}
            onSave={(patch) =>
              patchFlow((f) => ({
                ...f,
                nodes: f.nodes.map((x) => (x.id === node.id ? { ...x, ...patch } : x)),
              }))
            }
          />
        );
      })()}
      {flow && Object.keys(vars).length > 0 && (
        <div className="flow-vars">
          <span className="c-faint">variáveis extraídas:</span>
          {Object.entries(vars).map(([k, v]) => (
            <span key={k} className="flow-var" title={v}>
              {"{{" + k + "}}"} = {v.length > 24 ? v.slice(0, 24) + "…" : v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
