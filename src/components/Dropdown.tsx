import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  button: (open: boolean) => ReactNode;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}

/** Dropdown com fechamento por clique fora / Esc. */
export function Dropdown({ button, align = "left", children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dd" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{button(open)}</span>
      {open && (
        <div className={"dd-menu" + (align === "right" ? " right" : "")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
