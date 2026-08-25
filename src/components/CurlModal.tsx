import { useState } from "react";
import { parseCurl } from "../lib/curl";
import type { RequestDef } from "../types";
import { Modal } from "./Modal";

interface Props {
  onImport: (req: RequestDef) => void;
  onClose: () => void;
}

export function CurlModal({ onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const doImport = () => {
    const req = parseCurl(text);
    if (!req) {
      setError("Não consegui interpretar. Precisa começar com curl e ter URL.");
      return;
    }
    onImport(req);
  };

  return (
    <Modal title="Importar curl" onClose={onClose}>
      <div className="modal-hint">
        Cole um comando <span className="mono" style={{ color: "var(--text)" }}>curl</span> (ex.
        copiado do DevTools) — o raio monta a request automaticamente.
      </div>
      <textarea
        className="big"
        placeholder={"curl 'https://api.acme.dev/users' -H 'authorization: Bearer …' --compressed"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        spellCheck={false}
        autoFocus
      />
      {error && <div className="err-box">{error}</div>}
      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={doImport} disabled={!text.trim()}>
          Importar request
        </button>
      </div>
    </Modal>
  );
}
