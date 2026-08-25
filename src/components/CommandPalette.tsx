import { useEffect, useMemo, useRef, useState } from "react";
import type { Collection, RequestDef } from "../types";
import { METHOD_CLASS } from "../types";

interface Entry {
  collection: string;
  folder: string | null;
  req: RequestDef;
}

interface Props {
  collections: Collection[];
  onOpen: (collection: string, folder: string | null, req: RequestDef) => void;
  onClose: () => void;
}

export function CommandPalette({ collections, onOpen, onClose }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<Entry[]>(
    () =>
      collections.flatMap((c) => [
        ...c.requests.map((req) => ({ collection: c.name, folder: null, req })),
        ...c.folders.flatMap((f) =>
          f.requests.map((req) => ({ collection: c.name, folder: f.name as string | null, req })),
        ),
      ]),
    [collections],
  );

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return all.slice(0, 30);
    return all
      .filter((e) => {
        const hay = [
          e.req.method,
          e.req.name,
          e.req.url,
          e.collection,
          e.folder ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 30);
  }, [q, all]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current
      ?.querySelector(".palette-row.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const pick = (e: Entry) => {
    onOpen(e.collection, e.folder, e.req);
    onClose();
  };

  return (
    <div className="modal-backdrop" style={{ alignItems: "flex-start", paddingTop: "12vh" }} onClick={onClose}>
      <div className="modal palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="buscar request por nome, URL, método, collection…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[idx]) {
              pick(results[idx]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.map((e, i) => (
            <div
              key={e.req.id}
              className={"palette-row" + (i === idx ? " active" : "")}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(e)}
            >
              <span className={"req-method " + (METHOD_CLASS[e.req.method] ?? "c-dim")}>
                {e.req.method}
              </span>
              <span className="palette-name mono">{e.req.name}</span>
              <span className="palette-where mono">
                {e.collection}
                {e.folder ? " / " + e.folder : ""}
              </span>
            </div>
          ))}
          {results.length === 0 && (
            <div className="hint-block c-faint" style={{ padding: 14 }}>
              nada encontrado para "{q}"
            </div>
          )}
        </div>
        <div className="palette-foot mono">↑↓ navegar · Enter abrir · Esc fechar</div>
      </div>
    </div>
  );
}
