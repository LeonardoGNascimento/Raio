import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Environment } from "../types";
import { VarPop, charIndexInText, measureText, setMeasureFont, varAt } from "./VarInput";
import {
  VarSuggestList,
  applySuggestion,
  openVarAt,
  varSuggestions,
  type OpenVar,
  type Suggestion,
} from "./VarSuggest";

interface Props {
  value: string;
  placeholder?: string;
  /** gera HTML seguro (escapado) com spans de cor a partir do texto */
  highlight: (text: string) => string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** habilita editar {{var}} sob o mouse direto no ambiente da collection */
  env?: Environment | null;
  onSaveVar?: (name: string, value: string) => void;
}

/** Textarea com camada de syntax highlight atrás (texto transparente + caret visível). */
export function CodeArea({ value, placeholder, highlight, onChange, onKeyDown, env, onSaveVar }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pop, setPop] = useState<{ name: string; left: number; top: number } | null>(null);
  const [sug, setSug] = useState<{ open: OpenVar; items: Suggestion[]; sel: number; left: number; top: number } | null>(null);

  const refreshSug = (ta: HTMLTextAreaElement) => {
    if (env === undefined) return; // sem env: campo não usa variáveis
    const caret = ta.selectionStart ?? ta.value.length;
    const open = caret === (ta.selectionEnd ?? caret) ? openVarAt(ta.value, caret) : null;
    const items = open ? varSuggestions(open.prefix, env ?? null) : [];
    if (!open || items.length === 0) {
      setSug(null);
      return;
    }
    const cs = getComputedStyle(ta);
    setMeasureFont(cs);
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const padTop = parseFloat(cs.paddingTop);
    const padLeft = parseFloat(cs.paddingLeft);
    const before = ta.value.slice(0, open.start);
    const lineIdx = (before.match(/\n/g) ?? []).length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const left = Math.max(
      0,
      Math.min(
        measureText(before.slice(lineStart)) - ta.scrollLeft + padLeft,
        ta.clientWidth - 260,
      ),
    );
    const top = (lineIdx + 1) * lineH + padTop - ta.scrollTop;
    setSug((prev) => ({
      open,
      items,
      sel: prev && prev.open.start === open.start ? Math.min(prev.sel, items.length - 1) : 0,
      left,
      top,
    }));
  };

  const pickSug = (name: string) => {
    if (!sug) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const applied = applySuggestion(value, sug.open, caret, name);
    onChange(applied.text);
    setSug(null);
    requestAnimationFrame(() => {
      if (ta) {
        ta.setSelectionRange(applied.caret, applied.caret);
        syncScroll(ta);
      }
    });
  };

  const onKeyDownAll = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSug({ ...sug, sel: (sug.sel + d + sug.items.length) % sug.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSug(sug.items[sug.sel].name);
        return;
      }
      if (e.key === "Escape") {
        setSug(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const syncScroll = (ta: HTMLTextAreaElement) => {
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
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

  const onMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!onSaveVar) return;
    const ta = e.currentTarget;
    const cs = getComputedStyle(ta);
    const rect = ta.getBoundingClientRect();
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const padTop = parseFloat(cs.paddingTop);
    const padLeft = parseFloat(cs.paddingLeft);
    const li = Math.floor((e.clientY - rect.top + ta.scrollTop - padTop) / lineH);
    const lines = ta.value.split("\n");
    const line = li >= 0 ? lines[li] : undefined;
    if (line === undefined) {
      if (pop) scheduleClose();
      return;
    }
    setMeasureFont(cs);
    const idx = charIndexInText(line, e.clientX - rect.left + ta.scrollLeft - padLeft);
    const hit = idx >= 0 ? varAt(line, idx) : null;
    if (!hit) {
      if (pop) scheduleClose();
      return;
    }
    cancelClose();
    if (pop?.name === hit.name) return;
    setPop({
      name: hit.name,
      left: Math.max(0, Math.min(e.clientX - rect.left, ta.clientWidth - 280)),
      top: (li + 1) * lineH + padTop - ta.scrollTop,
    });
  };

  return (
    <div className="code-area">
      <pre
        ref={preRef}
        className="code-area-hl"
        aria-hidden="true"
        // sufixo \n garante que a última linha vazia ocupe altura igual à do textarea
        dangerouslySetInnerHTML={{ __html: highlight(value) + "\n" }}
      />
      <textarea
        ref={taRef}
        className="body-input code-area-input"
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          syncScroll(e.target);
          refreshSug(e.target);
        }}
        onKeyDown={onKeyDownAll}
        onKeyUp={(e) => refreshSug(e.currentTarget)}
        onClick={(e) => refreshSug(e.currentTarget)}
        onBlur={() => setSug(null)}
        onScroll={(e) => syncScroll(e.currentTarget)}
        onMouseMove={onMove}
        onMouseLeave={() => pop && scheduleClose()}
      />
      {sug && (
        <VarSuggestList
          items={sug.items}
          selected={sug.sel}
          style={{ left: sug.left, top: sug.top }}
          onPick={pickSug}
          onHover={(i) => setSug({ ...sug, sel: i })}
        />
      )}
      {pop && onSaveVar && (
        <VarPop
          key={pop.name}
          name={pop.name}
          env={env ?? null}
          style={{ left: pop.left, top: pop.top }}
          onSave={onSaveVar}
          onClose={() => setPop(null)}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}
