import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { Environment } from "../types";

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
    const ok = name.startsWith("$") ? DYNAMIC.has(name) : known.has(name);
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
function varAt(text: string, idx: number): VarHit | null {
  for (const m of text.matchAll(VAR_RE)) {
    if (idx >= m.index && idx < m.index + m[0].length) {
      const name = m[1];
      if (name.startsWith("$")) return null;
      return { name, start: m.index };
    }
  }
  return null;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** índice do caractere sob o x visual do input (fonte real, binary search). */
function charIndexAt(el: HTMLInputElement, clientX: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return -1;
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const x =
    clientX - el.getBoundingClientRect().left - parseFloat(cs.paddingLeft) + el.scrollLeft;
  if (x < 0) return -1;
  const text = el.value;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureCtx.measureText(text.slice(0, mid)).width <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo >= text.length ? -1 : lo;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  env: Environment | null;
  onChange: (value: string) => void;
  /** habilita editar a variável sob o mouse direto no ambiente da collection */
  onSaveVar?: (name: string, value: string) => void;
}

/** Input de linha única com {{variáveis}} destacadas (overlay atrás do texto). */
export function VarInput({ value, env, onChange, onSaveVar, className, ...rest }: Props) {
  const underRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pop, setPop] = useState<{ name: string; left: number } | null>(null);
  const [draft, setDraft] = useState("");

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
    if (measureCtx) measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const left = Math.max(
      0,
      (measureCtx?.measureText(el.value.slice(0, hit.start)).width ?? 0) -
        el.scrollLeft +
        parseFloat(cs.paddingLeft),
    );
    setDraft(env?.vars.find(([k]) => k === hit.name)?.[1] ?? "");
    setPop({ name: hit.name, left: Math.min(left, el.clientWidth - 40) });
  };

  const save = () => {
    if (pop && onSaveVar) onSaveVar(pop.name, draft);
    setPop(null);
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
        className={"var-real " + (className ?? "")}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
        }}
        onScroll={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onMouseMove={onMove}
        onMouseLeave={() => pop && scheduleClose()}
      />
      {pop && (
        <div
          className="var-pop"
          style={{ left: pop.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="var-pop-name">
            {"{{" + pop.name + "}}"}
            <span className="var-pop-env">
              {(pop.name === "@base" ? "base da collection · " : "") +
                (env?.name ? "ambiente " + env.name : "sem ambiente")}
            </span>
          </div>
          <div className="var-pop-row">
            <input
              className="inp"
              value={draft}
              placeholder="valor da variável"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setPop(null);
              }}
            />
            <button className="btn-primary var-pop-save" onClick={save}>
              salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
