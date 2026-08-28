import { useEffect, useState } from "react";
import type { Collection, Folder, RequestDef } from "../types";
import { METHOD_CLASS } from "../types";
import { Dropdown } from "./Dropdown";
import { Lockup } from "./Logo";

interface Props {
  collections: Collection[];
  workspacePath: string;
  activeRequestId: string | null;
  onSelect: (collection: string, folder: string | null, request: RequestDef) => void;
  onNewCollection: () => void;
  onDeleteCollection: (name: string) => void;
  onNewFolder: (collection: string, parent: string | null) => void;
  onDeleteFolder: (collection: string, folder: string, requestCount: number) => void;
  onNewRequest: (collection: string, folder: string | null) => void;
  onDeleteRequest: (collection: string, folder: string | null, request: RequestDef) => void;
  onDuplicateRequest: (collection: string, folder: string | null, request: RequestDef) => void;
  onRenameRequest: (
    collection: string,
    folder: string | null,
    request: RequestDef,
    newName: string,
  ) => void;
  onRenameFolder: (collection: string, folder: string, newName: string) => void;
  onRenameCollection: (name: string, newName: string) => void;
  onConfig: (collection: string, folder: string | null) => void;
  onOpenDashboard: (collection: string) => void;
  onOpenFlows: (collection: string) => void;
  onMoveRequest: (
    from: { collection: string; folder: string | null; name: string; id: string },
    to: { collection: string; folder: string | null },
  ) => void;
  /** ids de requests cuja última execução teve exception interna no trace */
  errorIds: Set<string>;
}

/** Nome com rename inline por duplo clique. */
function EditableName({
  value,
  className,
  suffix,
  onCommit,
  onClick,
}: {
  value: string;
  className: string;
  suffix?: string;
  onCommit: (newName: string) => void;
  onClick?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);

  const commit = () => {
    setEditing(false);
    const next = val.trim();
    if (next && next !== value) onCommit(next);
    else setVal(value);
  };

  if (!editing)
    return (
      <span
        className={className}
        title="duplo clique para renomear"
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}
        {suffix}
      </span>
    );
  return (
    <input
      className="inp rename-inp"
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setVal(value);
          setEditing(false);
        }
      }}
    />
  );
}

const DND_TYPE = "application/x-raio-request";

function ReqRow({
  req,
  active,
  hasError,
  collection,
  folder,
  onClick,
  onDelete,
  onRename,
  onDuplicate,
}: {
  req: RequestDef;
  active: boolean;
  hasError: boolean;
  collection: string;
  folder: string | null;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
}) {
  return (
    <div
      className={"req-row" + (active ? " active" : "")}
      onClick={onClick}
      title={req.url}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          DND_TYPE,
          JSON.stringify({ collection, folder, name: req.name, id: req.id }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <span className="bar" />
      <span className={"req-method " + (METHOD_CLASS[req.method] ?? "c-dim")}>{req.method}</span>
      <EditableName value={req.name} className="req-path" onCommit={onRename} />
      {hasError && <span className="err-dot" title="erro interno na última execução" />}
      <button
        className="btn-icon del"
        title="duplicar request"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
      >
        ⧉
      </button>
      <button
        className="btn-icon danger del"
        title="excluir request"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function Sidebar(props: Props) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropKey, setDropKey] = useState<string | null>(null);

  const term = filter.trim().toLowerCase();
  const reqMatch = (req: RequestDef) =>
    !term || `${req.method} ${req.name} ${req.url}`.toLowerCase().includes(term);
  /** filtrando: colapso é ignorado para mostrar os resultados */
  const isCollapsed = (key: string) => !term && collapsed.has(key);

  /** handlers de drop para uma collection/pasta alvo */
  const dropProps = (collection: string, folder: string | null) => {
    const key = collection + (folder ? "/" + folder : "");
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DND_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropKey(key);
      },
      onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
      onDrop: (e: React.DragEvent) => {
        setDropKey(null);
        const raw = e.dataTransfer.getData(DND_TYPE);
        if (!raw) return;
        e.preventDefault();
        try {
          const from = JSON.parse(raw) as {
            collection: string;
            folder: string | null;
            name: string;
            id: string;
          };
          props.onMoveRequest(from, { collection, folder });
        } catch {
          /* payload alheio: ignora */
        }
      },
      className: dropKey === key ? " drop-over" : "",
    };
  };

  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });


  const renderFolder = (coll: Collection, fold: Folder, parentPath: string | null): React.ReactNode => {
    const fullPath = parentPath ? parentPath + "/" + fold.name : fold.name;
    const dp = dropProps(coll.name, fullPath);
    const foldKey = coll.name + "/" + fullPath;
    const nameHit = !!term && fold.name.toLowerCase().includes(term);
    const shownReqs = term && !nameHit ? fold.requests.filter(reqMatch) : fold.requests;
    const subHasHit = (f: Folder): boolean =>
      f.name.toLowerCase().includes(term) ||
      f.requests.some(reqMatch) ||
      f.folders.some(subHasHit);
    const visibleSubs = term && !nameHit ? fold.folders.filter(subHasHit) : fold.folders;
    if (term && !nameHit && shownReqs.length === 0 && visibleSubs.length === 0) return null;
    const foldCollapsed = isCollapsed(foldKey);
    return (
    <div key={fullPath} style={{ marginTop: 2 }}>
      <div
        className={"fold-row" + dp.className}
        onDragOver={dp.onDragOver}
        onDragLeave={dp.onDragLeave}
        onDrop={dp.onDrop}
      >
        <span className="coll-arrow" onClick={() => toggle(foldKey)}>
          {foldCollapsed ? "▸" : "▾"}
        </span>
        <EditableName
          value={fold.name}
          suffix="/"
          className="coll-name"
          onClick={() => toggle(foldKey)}
          onCommit={(n) => props.onRenameFolder(coll.name, fullPath, n)}
        />
        {fold.base_url && (
          <span className="fold-base" title={"base: " + fold.base_url}>
            {fold.base_url}
          </span>
        )}
        <span className="coll-actions">
          <button className="base-btn" title="base URL / config" onClick={() => props.onConfig(coll.name, fullPath)}>
            base
          </button>
          <Dropdown
            align="right"
            button={() => (
              <button className="btn-icon" title="adicionar">+</button>
            )}
          >
            {(close) => (
              <>
                <button
                  className="dd-item"
                  onClick={() => {
                    close();
                    props.onNewRequest(coll.name, fullPath);
                  }}
                >
                  <span className="c-accent">＋</span> nova request
                </button>
                <button
                  className="dd-item"
                  onClick={() => {
                    close();
                    props.onNewFolder(coll.name, fullPath);
                  }}
                >
                  <span className="c-dim">▸</span> nova subpasta
                </button>
              </>
            )}
          </Dropdown>
          <button
            className="btn-icon danger"
            title="excluir pasta"
            onClick={() => {
              const count = (function total(f: Folder): number {
                return f.requests.length + f.folders.reduce((a, sub) => a + total(sub), 0);
              })(fold);
              props.onDeleteFolder(coll.name, fullPath, count);
            }}
          >
            ×
          </button>
        </span>
      </div>
      <div style={{ paddingLeft: 14, display: foldCollapsed ? "none" : undefined }}>
        {visibleSubs.map((sub) => renderFolder(coll, sub, fullPath))}
        {shownReqs.map((req) => (
          <ReqRow
            key={req.id}
            req={req}
            hasError={props.errorIds.has(req.id)}
            active={req.id === props.activeRequestId}
            onClick={() => props.onSelect(coll.name, fullPath, req)}
            onDelete={() => props.onDeleteRequest(coll.name, fullPath, req)}
            onRename={(n) => props.onRenameRequest(coll.name, fullPath, req, n)}
            onDuplicate={() => props.onDuplicateRequest(coll.name, fullPath, req)}
            collection={coll.name}
            folder={fullPath}
          />
        ))}
      </div>
    </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <Lockup boltSize={22} fontSize={19} />
        <span className="sb-tag">contract client</span>
      </div>
      <div className="sb-new">
        <input
          className="inp"
          placeholder="filtrar rotas e collections…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
        />
        <button onClick={props.onNewCollection} title="criar collection">+</button>
      </div>

      <div className="sb-tree">
        {props.collections.length === 0 && (
          <p className="sb-empty">
            Nenhuma collection ainda. Cada request vira um arquivo JSON versionável em{" "}
            <span className="mono">{props.workspacePath}</span>.
          </p>
        )}
        {props.collections.map((coll) => {
          const dp = dropProps(coll.name, null);
          const collNameHit = !!term && coll.name.toLowerCase().includes(term);
          const rootShown = term ? coll.requests.filter(reqMatch) : coll.requests;
          const anyHit = (f: Folder): boolean =>
            f.name.toLowerCase().includes(term) ||
            f.requests.some(reqMatch) ||
            f.folders.some(anyHit);
          const folderHasHit = coll.folders.some(anyHit);
          if (term && rootShown.length === 0 && !collNameHit && !folderHasHit) return null;
          const rootList = rootShown.length > 0 ? rootShown : collNameHit ? coll.requests : [];
          return (
          <div key={coll.name} style={{ marginBottom: 6 }}>
            <div
              className={"coll-row" + dp.className}
              onDragOver={dp.onDragOver}
              onDragLeave={dp.onDragLeave}
              onDrop={dp.onDrop}
            >
              <span className="coll-arrow" onClick={() => toggle(coll.name)}>
                {isCollapsed(coll.name) ? "▸" : "▾"}
              </span>
              <EditableName
                value={coll.name}
                className="coll-name"
                onClick={() => props.onOpenDashboard(coll.name)}
                onCommit={(n) => props.onRenameCollection(coll.name, n)}
              />
              {coll.has_spec && (
                <span className="spec-badge" title="collection validada por spec OpenAPI">
                  spec openapi
                </span>
              )}
              <span className="coll-actions">
                <button className="base-btn" title="base URL / config" onClick={() => props.onConfig(coll.name, null)}>
                  base
                </button>
                <Dropdown
                  align="right"
                  button={() => (
                    <button className="btn-icon" title="adicionar">+</button>
                  )}
                >
                  {(close) => (
                    <>
                      <button
                        className="dd-item"
                        onClick={() => {
                          close();
                          props.onNewRequest(coll.name, null);
                        }}
                      >
                        <span className="c-accent">＋</span> nova request
                      </button>
                      <button
                        className="dd-item"
                        onClick={() => {
                          close();
                          props.onNewFolder(coll.name, null);
                        }}
                      >
                        <span className="c-dim">▸</span> nova pasta
                      </button>
                      <button
                        className="dd-item"
                        onClick={() => {
                          close();
                          props.onOpenFlows(coll.name);
                        }}
                      >
                        <span className="c-accent">⛓</span> fluxos
                      </button>
                    </>
                  )}
                </Dropdown>
                <button
                  className="btn-icon danger"
                  title="excluir collection"
                  onClick={() => props.onDeleteCollection(coll.name)}
                >
                  ×
                </button>
              </span>
            </div>
            {coll.base_url && <div className="base-line">{coll.base_url}</div>}
            {!isCollapsed(coll.name) && (
              <div style={{ paddingLeft: 8, marginTop: 1 }}>
                {coll.folders.map((fold) => renderFolder(coll, fold, null))}
                {rootList.map((req) => (
                  <ReqRow
                    key={req.id}
                    req={req}
                    hasError={props.errorIds.has(req.id)}
                    active={req.id === props.activeRequestId}
                    onClick={() => props.onSelect(coll.name, null, req)}
                    onDelete={() => props.onDeleteRequest(coll.name, null, req)}
                    onRename={(n) => props.onRenameRequest(coll.name, null, req, n)}
                    onDuplicate={() => props.onDuplicateRequest(coll.name, null, req)}
                    collection={coll.name}
                    folder={null}
                  />
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {term && props.collections.length > 0 && props.collections.every((coll) => {
        const hit =
          coll.name.toLowerCase().includes(term) ||
          coll.requests.some(reqMatch) ||
          coll.folders.some(function deep(f): boolean {
            return (
              f.name.toLowerCase().includes(term) ||
              f.requests.some(reqMatch) ||
              f.folders.some(deep)
            );
          });
        return !hit;
      }) && <p className="sb-empty">nada bate com "{filter.trim()}"</p>}

      <div className="sb-foot" title={props.workspacePath}>
        <span className="c-ok">●</span>
        <span className="ellip">{props.workspacePath.replace(/^\/home\/[^/]+/, "~")}</span>
      </div>
    </aside>
  );
}
