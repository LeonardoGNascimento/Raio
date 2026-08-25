import { useState } from "react";
import { parseSpec } from "../lib/openapi";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  collection: string;
  hasSpec: boolean;
  onSave: (specJson: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function OpenApiModal({ collection, hasSpec, onSave, onDelete, onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const doSave = () => {
    const result = parseSpec(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSave(JSON.stringify(result.spec, null, 2));
  };

  return (
    <Modal title="Spec OpenAPI" onClose={onClose}>
      <div className="modal-hint" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        Spec da collection <span className="mono" style={{ color: "var(--text)" }}>{collection}</span>
        {hasSpec && <span className="chip-active">spec ativa nesta collection</span>}
      </div>
      {hasSpec && <div className="warn-box">⚠ colar uma nova spec substitui a atual desta collection.</div>}
      {!hasSpec && (
        <div className="modal-hint">
          Cole a spec OpenAPI 3.x (JSON ou YAML). Toda response passa a ser validada contra o schema
          da rota — violações aparecem inline.
        </div>
      )}
      <textarea
        className="big"
        placeholder={`openapi: 3.0.3\ninfo:\n  title: minha-api\n  version: 1.0.0\npaths:\n  /users:\n    get:\n      responses:\n        '200':\n          content:\n            application/json:\n              schema: …`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        spellCheck={false}
        autoFocus
      />
      {error && <div className="err-box">{error}</div>}
      <div className="modal-foot" style={{ justifyContent: "space-between" }}>
        {hasSpec ? (
          <button
            className="btn-danger-ghost"
            onClick={() => setAskDelete(true)}
          >
            Remover spec
          </button>
        ) : (
          <span />
        )}
        <div style={{ display: "flex", gap: 9 }}>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={doSave} disabled={!text.trim()}>
            Salvar spec
          </button>
        </div>
      </div>
      {askDelete && (
        <ConfirmModal
          title="Remover spec"
          message={
            <>
              Remover a spec OpenAPI de{" "}
              <span className="mono" style={{ color: "var(--text)" }}>{collection}</span>? As
              responses deixam de ser validadas contra ela.
            </>
          }
          confirmLabel="Remover spec"
          onConfirm={() => {
            setAskDelete(false);
            onDelete();
          }}
          onClose={() => setAskDelete(false)}
        />
      )}
    </Modal>
  );
}
