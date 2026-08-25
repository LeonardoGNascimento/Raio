import { useState } from "react";
import { Modal } from "./Modal";

interface Props {
  collection: string;
  folder: string | null;
  /** base URL herdada (collection + pasta) que prefixa a rota */
  baseUrl: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function NewRequestModal({ collection, folder, baseUrl, onCreate, onClose }: Props) {
  const [name, setName] = useState("");

  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed.startsWith("/") ? trimmed : "/" + trimmed);
  };

  return (
    <Modal title="Nova request" width={480} onClose={onClose}>
      <div className="modal-hint">
        Em <span className="mono" style={{ color: "var(--text)" }}>{collection}{folder ? ` / ${folder}` : ""}</span>.
        O nome vira a rota e o arquivo JSON da request.
      </div>
      <div className="field-label">Nome da rota</div>
      <input
        className="inp"
        style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
        placeholder="/users ou /orders/{id}"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && confirm()}
      />
      {baseUrl && (
        <div className="modal-hint" style={{ marginTop: 10, marginBottom: 0 }}>
          URL inicial:{" "}
          <span className="mono c-accent">
            {baseUrl}
            {name.trim() ? (name.trim().startsWith("/") ? name.trim() : "/" + name.trim()) : "/…"}
          </span>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={confirm} disabled={!name.trim()}>
          Criar request
        </button>
      </div>
    </Modal>
  );
}
