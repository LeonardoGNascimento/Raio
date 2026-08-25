import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { importAny, type ImportedCollection } from "../lib/importers";

interface Props {
  onImport: (coll: ImportedCollection, name: string) => void;
  onClose: () => void;
}

export function ImportModal({ onImport, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ kind: string; coll: ImportedCollection } | null>(null);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importAny(String(reader.result ?? ""));
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      setError(null);
      setPreview({ kind: result.kind, coll: result.coll });
      setName(result.coll.name);
    };
    reader.onerror = () => setError("não consegui ler o arquivo");
    reader.readAsText(file);
  };

  const total = preview
    ? preview.coll.requests.length + preview.coll.folders.reduce((a, f) => a + f.requests.length, 0)
    : 0;

  return (
    <Modal title="Importar collection" width={520} onClose={onClose}>
      <div className="modal-hint">
        Aceita <span className="mono" style={{ color: "var(--text)" }}>Postman collection v2.x</span>{" "}
        (JSON) e <span className="mono" style={{ color: "var(--text)" }}>OpenAPI 3.x</span> (JSON ou
        YAML — cada rota vira uma request e a spec já entra como contrato da collection). Usuários
        do Bruno: exportem no formato Postman.
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.yaml,.yml,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
      <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
        escolher arquivo…
      </button>

      {error && <div className="err-box">{error}</div>}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <div className="ok-banner" style={{ fontSize: 12.5, padding: "11px 14px" }}>
            {preview.kind === "postman" ? "Postman" : "OpenAPI"} reconhecido — {total}{" "}
            {total === 1 ? "request" : "requests"}
            {preview.coll.folders.length > 0 && ` em ${preview.coll.folders.length + 1} grupos`}
            {preview.coll.openapi && " · spec vira contrato da collection"}
          </div>
          <div className="field-label" style={{ marginTop: 14 }}>nome da collection</div>
          <input
            className="inp"
            style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="modal-foot">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={!name.trim() || total === 0}
              onClick={() => onImport(preview.coll, name.trim())}
            >
              Importar {total} requests
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
