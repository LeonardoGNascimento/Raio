import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { Environment } from "../types";
import { isGlobalVar } from "../lib/interpolate";
import {
  VarSuggestList,
  applySuggestion,
  openVarAt,
  varSuggestions,
  type OpenVar,
  type Suggestion,
} from "./VarSuggest";

const VAR_RE = /\{\{\s*([$@]?[\w.-]+)\s*\}\}/g;
const DYNAMIC = new Set(["$uuid", "$timestamp", "$isodate", "$random"]);

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML com {{vars}} coloridas: âmbar quando resolvem, vermelho quando faltam. */
export function highlightVars(text: string, env: Environment | null): string {
  const known = new Set(env?.vars.map(([k]) => k) ?? []);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    out += escHtml(text.slice(last, m.index));
    const name = m[1];
    const ok = name.startsWith("$")
      ? DYNAMIC.has(name)
      : known.has(name) || isGlobalVar(name);
    out += `<span class="${ok ? "v-ok" : "v-miss"}">${escHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  out += escHtml(text.slice(last));
  return out;
}

interface VarHit {
  name: string;
  start: number;
}

/** {{var}} sob o índice de caractere, se houver (dinâmicas $ ficam de fora). */
export function varAt(text: string, idx: number): VarHit | null {
  for (const m of text.matchAll(VAR_RE)) {
    if (idx >= m.index && idx < m.index + m[0].length) {
      const name = m[1];
      if (name.startsWith("$") || isGlobalVar(name)) return null;
      return { name, start: m.index };
    }
  }
  return null;
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function setMeasureFont(cs: CSSStyleDeclaration) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (measureCtx) measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

export function measureText(s: string): number {
  return measureCtx?.measureText(s).width ?? 0;
}

/** índice do caractere sob o x (px, já com scroll/padding descontados); fonte via setMeasureFont. */
export function charIndexInText(text: string, x: number): number {
  if (x < 0 || !measureCtx) return -1;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureCtx.measureText(text.slice(0, mid)).width <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo >= text.length ? -1 : lo;
}

/** índice do caractere sob o x visual do input (fonte real, binary search). */
function charIndexAt(el: HTMLInputElement, clientX: number): number {
  const cs = getComputedStyle(el);
  setMeasureFont(cs);
  const x =
    clientX - el.getBoundingClientRect().left - parseFloat(cs.paddingLeft) + el.scrollLeft;
  return charIndexInText(el.value, x);
}

/** popover compartilhado de edição de variável (VarInput e CodeArea). */
export function VarPop(props: {
  name: string;
  env: Environment | null;
  style: React.CSSProperties;
  onSave: (name: string, value: string) => void;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [draft, setDraft] = useState(
    props.env?.vars.find(([k]) => k === props.name)?.[1] ?? "",
  );
  const save = () => {
    props.onSave(props.name, draft);
    props.onClose();
  };
  return (
    <div className="var-pop" style={props.style} onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}>
      <div className="var-pop-name">
        {"{{" + props.name + "}}"}
        <span className="var-pop-env">
          {(props.name === "@base" ? "base da collection · " : "") +
            (props.env?.name ? "ambiente " + props.env.name : "sem ambiente")}
        </span>
      </div>
      <div className="var-pop-row">
        <input
          className="inp"
          value={draft}
          placeholder="valor da variável"
          spellCheck={false}
          autoFocus={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") props.onClose();
          }}
        />
        <button className="btn-primary var-pop-save" onClick={save}>
          salvar
        </button>
      </div>
    </div>
  );
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  env: Environment | null;
  onChange: (value: string) => void;
  /** habilita editar a variável sob o mouse direto no ambiente da collection */
  onSaveVar?: (name: string, value: string) => void;
  /** sugestões extras no autocomplete (ex.: responses de nós do fluxo) */
  extraSuggestions?: Suggestion[];
}

/** Input de linha única com {{variáveis}} destacadas (overlay atrás do texto). */
export function VarInput({ value, env, onChange, onSaveVar, extraSuggestions, className, ...rest }: Props) {
  const underRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pop, setPop] = useState<{ name: string; left: number } | null>(null);
  const [sug, setSug] = useState<{ open: OpenVar; items: Suggestion[]; sel: number; left: number } | null>(null);

  const refreshSug = (el: HTMLInputElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const open = caret === (el.selectionEnd ?? caret) ? openVarAt(el.value, caret) : null;
    const items = open ? varSuggestions(open.prefix, env, extraSuggestions ?? []) : [];
    if (!open || items.length === 0) {
      setSug(null);
      return;
    }
    const cs = getComputedStyle(el);
    setMeasureFont(cs);
    const left = Math.max(
      0,
      measureText(el.value.slice(0, open.start)) - el.scrollLeft + parseFloat(cs.paddingLeft),
    );
    setSug((prev) => ({
      open,
      items,
      sel: prev && prev.open.start === open.start ? Math.min(prev.sel, items.length - 1) : 0,
      left: Math.min(left, el.clientWidth - 60),
    }));
  };

  const pickSug = (name: string) => {
    if (!sug) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const applied = applySuggestion(value, sug.open, caret, name);
    onChange(applied.text);
    setSug(null);
    requestAnimationFrame(() => {
      if (el) {
        el.setSelectionRange(applied.caret, applied.caret);
        sync(el);
      }
    });
  };

  const onKeyDownSug = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sug) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSug({ ...sug, sel: (sug.sel + d + sug.items.length) % sug.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        pickSug(sug.items[sug.sel].name);
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        setSug(null);
        return;
      }
    }
    rest.onKeyDown?.(e);
  };

  const sync = (el: HTMLInputElement) => {
    if (underRef.current) underRef.current.scrollLeft = el.scrollLeft;
  };

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPop(null), 250);
  };
  useEffect(() => cancelClose, []);

  const onMove = (e: React.MouseEvent<HTMLInputElement>) => {
    if (!onSaveVar) return;
    const el = e.currentTarget;
    const idx = charIndexAt(el, e.clientX);
    const hit = idx >= 0 ? varAt(el.value, idx) : null;
    if (!hit) {
      if (pop) scheduleClose();
      return;
    }
    cancelClose();
    if (pop?.name === hit.name) return;
    const cs = getComputedStyle(el);
    setMeasureFont(cs);
    const left = Math.max(
      0,
      measureText(el.value.slice(0, hit.start)) - el.scrollLeft + parseFloat(cs.paddingLeft),
    );
    setPop({ name: hit.name, left: Math.min(left, el.clientWidth - 40) });
  };

  return (
    <div className={"var-wrap " + (className ?? "")}>
      <div
        ref={underRef}
        className={"var-under " + (className ?? "")}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: highlightVars(value, env) }}
      />
      <input
        {...rest}
        ref={inputRef}
        className={"var-real " + (className ?? "")}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
          refreshSug(e.target);
        }}
        onScroll={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => {
          sync(e.currentTarget);
          refreshSug(e.currentTarget);
        }}
        onKeyDown={onKeyDownSug}
        onClick={(e) => {
          sync(e.currentTarget);
          refreshSug(e.currentTarget);
        }}
        onBlur={() => setSug(null)}
        onMouseMove={onMove}
        onMouseLeave={() => pop && scheduleClose()}
      />
      {sug && (
        <VarSuggestList
          items={sug.items}
          selected={sug.sel}
          style={{ left: sug.left }}
          onPick={pickSug}
          onHover={(i) => setSug({ ...sug, sel: i })}
        />
      )}
      {pop && onSaveVar && (
        <VarPop
          key={pop.name}
          name={pop.name}
          env={env}
          style={{ left: pop.left }}
          onSave={onSaveVar}
          onClose={() => setPop(null)}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}
