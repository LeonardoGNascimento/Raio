import { useRef, type KeyboardEvent } from "react";

interface Props {
  value: string;
  placeholder?: string;
  /** gera HTML seguro (escapado) com spans de cor a partir do texto */
  highlight: (text: string) => string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Textarea com camada de syntax highlight atrás (texto transparente + caret visível). */
export function CodeArea({ value, placeholder, highlight, onChange, onKeyDown }: Props) {
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = (ta: HTMLTextAreaElement) => {
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
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
        className="body-input code-area-input"
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          syncScroll(e.target);
        }}
        onKeyDown={onKeyDown}
        onScroll={(e) => syncScroll(e.currentTarget)}
      />
    </div>
  );
}
