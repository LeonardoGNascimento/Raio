import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { runFlow, newFlow, type EdgeCond, type Flow, type FlowNode, type NodeResult } from "../lib/flow";
import { flattenRequests, METHOD_CLASS, type Collection } from "../types";
import { Dropdown } from "./Dropdown";

const NODE_W = 190;
const NODE_H = 56;

interface Props {
  collection: Collection;
  spec: Record<string, unknown> | null;
  envName: string;
  onOpenRequest: (folder: string | null, requestId: string) => void;
}

interface DragNode {
  id: string;
  dx: number;
  dy: number;
}

interface Connecting {
  from: string;
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

export function FlowView({ collection, spec, envName, onOpenRequest }: Props) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragNode, setDragNode] = useState<DragNode | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, NodeResult | "running">>({});
  const [vars, setVars] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLDivElement>(null);

  const flow = flows.find((f) => f.id === flowId) ?? null;
  const requests = useMemo(() => flattenRequests(collection), [collection]);
  const reqById = useMemo(() => new Map(requests.map((r) => [r.req.id, r])), [requests]);

  useEffect(() => {
    api
      .loadFlows(collection.name)
      .then((raw) => {
        const list = Array.isArray(raw) ? (raw as Flow[]) : [];
        setFlows(list);
        setFlowId(list[0]?.id ?? null);
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
    patchFlow((f) => ({
      ...f,
      nodes: [
        ...f.nodes,
        {
          id: crypto.randomUUID(),
          kind: "request",
          requestId,
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
    return { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragNode && flow) {
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

  const finishConnect = (toId: string) => {
    if (!connecting || connecting.from === toId) return;
    const exists = flow?.edges.some((e) => e.from === connecting.from && e.to === toId);
    if (!exists)
      patchFlow((f) => ({
        ...f,
        edges: [
          ...f.edges,
          { id: crypto.randomUUID(), from: connecting.from, to: toId, cond: "success" },
        ],
      }));
    setConnecting(null);
  };

  const run = async () => {
    if (!flow || running) return;
    setRunning(true);
    setResults({});
    setVars({});
    try {
      await runFlow(flow, collection, spec, envName, {
        onNode: (nodeId, state) => setResults((r) => ({ ...r, [nodeId]: state })),
        onVars: setVars,
      });
    } finally {
      setRunning(false);
    }
  };

  // ---------- render ----------

  const nodeCenter = (n: FlowNode, side: "in" | "out") => ({
    x: n.x + (side === "out" ? NODE_W : 0),
    y: n.y + NODE_H / 2,
  });

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
            <span className="flow-hint">
              arraste do ponto ● para conectar · clique na aresta para mudar a condição
            </span>
            <div style={{ flex: 1 }} />
            {selEdge && (
              <button className="btn-ghost" onClick={() => removeEdge(selEdge)}>
                excluir aresta
              </button>
            )}
            {selNode && flow.nodes.find((n) => n.id === selNode)?.kind !== "start" && (
              <button className="btn-ghost" onClick={() => removeNode(selNode)}>
                excluir nó
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
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") {
              setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
              setSelEdge(null);
              setSelNode(null);
            }
          }}
        >
          <svg className="flow-svg" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {flow.edges.map((e) => {
              const from = flow.nodes.find((n) => n.id === e.from);
              const to = flow.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              const a = nodeCenter(from, "out");
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
              const a = nodeCenter(from, "out");
              return (
                <path
                  d={edgePath(a.x, a.y, connecting.x, connecting.y)}
                  className="flow-edge temp"
                />
              );
            })()}
          </svg>

          <div className="flow-nodes" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
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
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelNode(n.id);
                    setSelEdge(null);
                    const p = canvasPos(e);
                    setDragNode({ id: n.id, dx: p.x - n.x, dy: p.y - n.y });
                  }}
                  onMouseUp={() => connecting && finishConnect(n.id)}
                  onDoubleClick={() => {
                    if (n.kind === "request" && target)
                      onOpenRequest(target.folder, target.req.id);
                  }}
                  title={
                    res && !res.skipped && res.problems.length > 0
                      ? res.problems.join("\n")
                      : n.kind === "request"
                        ? "duplo clique abre a request"
                        : undefined
                  }
                >
                  {n.kind === "start" && <span className="flow-start-label">▶ início</span>}
                  {n.kind === "request" && (
                    <>
                      <span className={"flow-method " + (target ? METHOD_CLASS[target.req.method] ?? "c-dim" : "c-err")}>
                        {target?.req.method ?? "?"}
                      </span>
                      <span className="flow-name">
                        {target ? target.req.name : "request removida"}
                      </span>
                    </>
                  )}
                  {n.kind === "delay" && (
                    <span className="flow-name">
                      ⏱{" "}
                      <input
                        className="flow-delay-inp"
                        type="number"
                        value={n.delayMs ?? 1000}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          patchFlow((f) => ({
                            ...f,
                            nodes: f.nodes.map((x) =>
                              x.id === n.id ? { ...x, delayMs: Number(e.target.value) || 0 } : x,
                            ),
                          }))
                        }
                      />{" "}
                      ms
                    </span>
                  )}
                  {res && !res.skipped && (
                    <span className={"flow-badge " + (res.ok ? "c-ok" : "c-err")}>
                      {res.status ?? (res.ok ? "✓" : "✗")}
                      {res.totalMs !== undefined ? ` · ${res.totalMs}ms` : ""}
                    </span>
                  )}
                  {res?.skipped && <span className="flow-badge c-faint">pulado</span>}
                  {n.kind !== "start" && <span className="flow-port in" />}
                  <span
                    className="flow-port out"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const p = canvasPos(e);
                      setConnecting({ from: n.id, x: p.x, y: p.y });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

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
