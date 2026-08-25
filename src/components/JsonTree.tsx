import { useState } from "react";

interface NodeProps {
  value: unknown;
  path: string;
  keyLabel: string | null;
  isLast: boolean;
  depth: number;
  overrides: Set<string>;
  defaultCollapsed: boolean;
  onToggle: (path: string) => void;
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="j-null">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="j-str">{JSON.stringify(value)}</span>;
    case "number":
      return <span className="j-num">{String(value)}</span>;
    case "boolean":
      return <span className="j-bool">{String(value)}</span>;
    default:
      return <span className="j-null">{String(value)}</span>;
  }
}

function Node(props: NodeProps) {
  const { value, path, keyLabel, isLast, depth, overrides, defaultCollapsed, onToggle } = props;
  const comma = isLast ? "" : ",";
  const key =
    keyLabel !== null ? (
      <>
        <span className="j-key">{JSON.stringify(keyLabel)}</span>
        <span className="c-faint">: </span>
      </>
    ) : null;
  const indent = { paddingLeft: depth * 16 };

  const isArr = Array.isArray(value);
  const isObj = !isArr && typeof value === "object" && value !== null;
  if (!isArr && !isObj) {
    return (
      <div className="jt-line" style={indent}>
        <span className="jt-arrow-space" />
        {key}
        <Primitive value={value} />
        <span className="c-faint">{comma}</span>
      </div>
    );
  }

  const entries: [string | null, unknown][] = isArr
    ? (value as unknown[]).map((v) => [null, v] as [null, unknown])
    : Object.entries(value as Record<string, unknown>);
  const open = isArr ? "[" : "{";
  const close = isArr ? "]" : "}";
  const count = entries.length;

  if (count === 0) {
    return (
      <div className="jt-line" style={indent}>
        <span className="jt-arrow-space" />
        {key}
        <span className="c-faint">{open}{close}{comma}</span>
      </div>
    );
  }

  // colapso efetivo: default (quando "recolher tudo") invertido pelos toggles do usuário
  const base = defaultCollapsed && depth > 0;
  const collapsed = overrides.has(path) ? !base : base;
  const summary = isArr
    ? `${count} ${count === 1 ? "item" : "itens"}`
    : `${count} ${count === 1 ? "chave" : "chaves"}`;

  if (collapsed) {
    return (
      <div className="jt-line" style={indent}>
        <button className="jt-arrow" onClick={() => onToggle(path)} title="expandir">▸</button>
        {key}
        <span className="jt-summary" onClick={() => onToggle(path)} title="expandir">
          {open} … {summary} {close}
        </span>
        <span className="c-faint">{comma}</span>
      </div>
    );
  }

  return (
    <>
      <div className="jt-line" style={indent}>
        <button className="jt-arrow" onClick={() => onToggle(path)} title="recolher">▾</button>
        {key}
        <span className="c-faint">{open}</span>
      </div>
      {entries.map(([k, v], i) => (
        <Node
          key={k ?? i}
          value={v}
          path={path + (k !== null ? "." + k : "[" + i + "]")}
          keyLabel={k}
          isLast={i === entries.length - 1}
          depth={depth + 1}
          overrides={overrides}
          defaultCollapsed={defaultCollapsed}
          onToggle={onToggle}
        />
      ))}
      <div className="jt-line" style={indent}>
        <span className="jt-arrow-space" />
        <span className="c-faint">{close}{comma}</span>
      </div>
    </>
  );
}

/** Árvore JSON com fold por nó. defaultCollapsed=true começa tudo recolhido (menos a raiz). */
export function JsonTree({
  value,
  defaultCollapsed = false,
}: {
  value: unknown;
  defaultCollapsed?: boolean;
}) {
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="jt">
      <Node
        value={value}
        path="$"
        keyLabel={null}
        isLast
        depth={0}
        overrides={overrides}
        defaultCollapsed={defaultCollapsed}
        onToggle={toggle}
      />
    </div>
  );
}
