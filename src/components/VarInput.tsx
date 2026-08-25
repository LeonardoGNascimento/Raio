import { useRef, type InputHTMLAttributes } from "react";
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

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  env: Environment | null;
  onChange: (value: string) => void;
}

/** Input de linha única com {{variáveis}} destacadas (overlay atrás do texto). */
export function VarInput({ value, env, onChange, className, ...rest }: Props) {
  const underRef = useRef<HTMLDivElement>(null);

  const sync = (el: HTMLInputElement) => {
    if (underRef.current) underRef.current.scrollLeft = el.scrollLeft;
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
      />
    </div>
  );
}
