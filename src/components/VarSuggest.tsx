import type { Environment } from "../types";
import { GLOBAL_VAR_NAMES } from "../lib/interpolate";
import { getGlobalVars } from "../lib/globals";

const DYNAMIC_NAMES = ["$uuid", "$timestamp", "$isodate", "$random"];

export interface OpenVar {
  /** índice do "{{" no texto */
  start: number;
  prefix: string;
}

/** {{prefixo incompleto imediatamente antes do caret, se houver.
 *  allowClosed: durante digitação, sugere mesmo com o }} já na frente (drill de paths). */
export function openVarAt(text: string, caret: number, allowClosed = false): OpenVar | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (!/^[\w.$@-]*$/.test(between)) return null; // fechou, quebrou linha ou não é nome
  if (!allowClosed && /^[\w.$@-]*\}\}/.test(text.slice(caret))) return null; // clique dentro de var fechada
  return { start: open, prefix: between };
}

export interface Suggestion {
  name: string;
  /** valor do ambiente (preview) ou rótulo do tipo */
  hint: string;
  kind: "env" | "global" | "dinamica" | "node";
  /** objeto/array: dá para continuar descendo com "." (caret fica dentro do {{}}) */
  container?: boolean;
}

export function varSuggestions(
  prefix: string,
  env: Environment | null,
  extra: Suggestion[] = [],
): Suggestion[] {
  const q = prefix.toLowerCase();
  const wsGlobals: Suggestion[] = getGlobalVars().map(([name, value]) => ({
    name,
    hint: "🌐 " + (value.length > 24 ? value.slice(0, 24) + "…" : value),
    kind: "env" as const,
  }));
  const all: Suggestion[] = [
    ...extra,
    ...wsGlobals,
    ...(env?.vars ?? []).map(
      ([name, value]): Suggestion => ({
        name,
        hint: value.length > 28 ? value.slice(0, 28) + "…" : value,
        kind: "env",
      }),
    ),
    ...GLOBAL_VAR_NAMES.map((name): Suggestion => ({ name, hint: "global", kind: "global" })),
    ...DYNAMIC_NAMES.map((name): Suggestion => ({ name, hint: "dinâmica", kind: "dinamica" })),
  ];
  const starts = all.filter((s) => s.name.toLowerCase().startsWith(q));
  const contains = all.filter(
    (s) => !s.name.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, 10);
}

/** texto com a sugestão aplicada + posição final do caret.
 *  container: caret fica antes do }}, para continuar o path com ".". */
export function applySuggestion(
  text: string,
  open: OpenVar,
  caret: number,
  name: string,
  container = false,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const close = after.startsWith("}}") ? "" : "}}";
  const inserted = "{{" + name + close;
  const inside = open.start + 2 + name.length;
  return {
    text: text.slice(0, open.start) + inserted + after,
    caret: container ? inside : inside + 2,
  };
}

interface ListProps {
  items: Suggestion[];
  selected: number;
  style: React.CSSProperties;
  onPick: (name: string, container?: boolean) => void;
  onHover: (index: number) => void;
}

export function VarSuggestList({ items, selected, style, onPick, onHover }: ListProps) {
  return (
    <div className="var-sug" style={style}>
      {items.map((s, i) => (
        <button
          key={s.name}
          className={"var-sug-item" + (i === selected ? " active" : "")}
          // mousedown para não roubar o foco do input antes do click
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(s.name, s.container);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="var-sug-name">{"{{" + s.name + "}}"}</span>
          <span className={"var-sug-hint " + s.kind}>{s.hint}</span>
        </button>
      ))}
    </div>
  );
}
