/** Comportamentos de editor de código para <textarea> controlado (body JSON, schemas). */

const PAIRS: Record<string, string> = { "{": "}", "[": "]", "(": ")", '"': '"', "'": "'" };
const CLOSERS = new Set(Object.values(PAIRS));
const INDENT = "  ";

interface TextAreaLike {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  currentTarget: TextAreaLike;
  preventDefault(): void;
}

const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);

/**
 * Trata Tab/Enter/pares no textarea. Chama onChange com o novo valor e
 * reposiciona o cursor após o re-render. Retorna true se consumiu a tecla.
 */
export function handleCodeEditorKeys(
  e: KeyEventLike,
  onChange: (value: string) => void,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const ta = e.currentTarget;
  const { value } = ta;
  const s = ta.selectionStart;
  const end = ta.selectionEnd;

  const apply = (next: string, selStart: number, selEnd = selStart): true => {
    e.preventDefault();
    onChange(next);
    raf(() => {
      ta.selectionStart = selStart;
      ta.selectionEnd = selEnd;
    });
    return true;
  };

  if (e.key === "Tab") {
    const multiline = s !== end && value.slice(s, end).includes("\n");
    if (multiline) {
      const blockStart = value.lastIndexOf("\n", s - 1) + 1;
      const lines = value.slice(blockStart, end).split("\n");
      if (e.shiftKey) {
        const newLines = lines.map((l) =>
          l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^ /, ""),
        );
        const firstRemoved = lines[0].length - newLines[0].length;
        const totalRemoved =
          lines.reduce((a, l) => a + l.length, 0) - newLines.reduce((a, l) => a + l.length, 0);
        const next = value.slice(0, blockStart) + newLines.join("\n") + value.slice(end);
        return apply(next, Math.max(blockStart, s - firstRemoved), end - totalRemoved);
      }
      const next =
        value.slice(0, blockStart) + lines.map((l) => INDENT + l).join("\n") + value.slice(end);
      return apply(next, s + INDENT.length, end + lines.length * INDENT.length);
    }
    if (e.shiftKey) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const m = /^ {1,2}/.exec(value.slice(lineStart));
      if (!m) {
        e.preventDefault();
        return true;
      }
      const n = m[0].length;
      return apply(
        value.slice(0, lineStart) + value.slice(lineStart + n),
        Math.max(lineStart, s - n),
      );
    }
    return apply(value.slice(0, s) + INDENT + value.slice(end), s + INDENT.length);
  }

  if (e.key === "Enter") {
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const indent = (/^[ \t]*/.exec(value.slice(lineStart)) ?? [""])[0];
    const prev = value[s - 1] ?? "";
    const nextCh = value[end] ?? "";
    const opensBlock = prev === "{" || prev === "[" || prev === "(";
    if (opensBlock && PAIRS[prev] === nextCh) {
      // cursor entre o par: abre bloco com fechador na linha de baixo
      const insert = "\n" + indent + INDENT + "\n" + indent;
      return apply(value.slice(0, s) + insert + value.slice(end), s + 1 + indent.length + INDENT.length);
    }
    const extra = opensBlock ? INDENT : "";
    if (indent || extra) {
      const insert = "\n" + indent + extra;
      return apply(value.slice(0, s) + insert + value.slice(end), s + insert.length);
    }
    return false;
  }

  if (e.key === "Backspace" && s === end && s > 0) {
    const prev = value[s - 1];
    if (prev && PAIRS[prev] === value[s]) {
      return apply(value.slice(0, s - 1) + value.slice(s + 1), s - 1);
    }
    return false;
  }

  // type-over: digitar fechador quando ele já é o próximo caractere só pula
  if (CLOSERS.has(e.key) && s === end && value[s] === e.key) {
    return apply(value, s + 1);
  }

  const closer = PAIRS[e.key];
  if (closer) {
    if (s !== end) {
      // seleção → embrulha no par
      const sel = value.slice(s, end);
      return apply(value.slice(0, s) + e.key + sel + closer + value.slice(end), s + 1, end + 1);
    }
    if (e.key === '"' || e.key === "'") {
      // não auto-fecha aspas coladas em palavra (ex.: don't, sufixo de string)
      const prevCh = value[s - 1] ?? "";
      if (/[\w"'\\]/.test(prevCh)) return false;
    }
    return apply(value.slice(0, s) + e.key + closer + value.slice(end), s + 1);
  }

  return false;
}
