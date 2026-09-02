import type { Environment } from "../types";
import { GLOBAL_VAR_NAMES } from "../lib/interpolate";

const DYNAMIC_NAMES = ["$uuid", "$timestamp", "$isodate", "$random"];

export interface OpenVar {
  /** índice do "{{" no texto */
  start: number;
  prefix: string;
}

/** {{prefixo incompleto imediatamente antes do caret, se houver. */
export function openVarAt(text: string, caret: number): OpenVar | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (!/^[\w.$@-]*$/.test(between)) return null; // fechou, quebrou linha ou não é nome
  if (/^[\w.$@-]*\}\}/.test(text.slice(caret))) return null; // caret dentro de var já fechada
  return { start: open, prefix: between };
}

export interface Suggestion {
  name: string;
  /** valor do ambiente (preview) ou rótulo do tipo */
  hint: string;
  kind: "env" | "global" | "dinamica" | "node";
}

export function varSuggestions(
  prefix: string,
  env: Environment | null,
  extra: Suggestion[] = [],
): Suggestion[] {
  const q = prefix.toLowerCase();
  const all: Suggestion[] = [
    ...extra,
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

/** texto com a sugestão aplicada + posição final do caret */
export function applySuggestion(
  text: string,
  open: OpenVar,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const close = after.startsWith("}}") ? "" : "}}";
  const inserted = "{{" + name + close;
  return {
    text: text.slice(0, open.start) + inserted + after,
    caret: open.start + inserted.length + (close ? 0 : 2),
  };
}

interface ListProps {
  items: Suggestion[];
  selected: number;
  style: React.CSSProperties;
  onPick: (name: string) => void;
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
            onPick(s.name);
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
