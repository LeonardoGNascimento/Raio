import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "../api";
import { getGlobalVars, setGlobalVars } from "../lib/globals";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

/** Variáveis globais do workspace: valem em todas as collections e ambientes. */
export function GlobalsModal({ onClose, onSaved }: Props) {
  const [rows, setRows] = useState<[string, string][]>(() => {
    const cur = getGlobalVars();
    return cur.length > 0 ? cur : [["", ""]];
  });

  const save = async () => {
    const clean = rows.filter(([k]) => k.trim()) as [string, string][];
    try {
      await api.saveGlobals(clean);
      setGlobalVars(clean);
      onSaved();
      onClose();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <Modal title="Variáveis globais" width={560} onClose={onClose}>
      <div className="modal-hint">
        Valem para <b>todas as collections e ambientes</b> — use{" "}
        <span className="mono c-accent">{"{{nome}}"}</span> em qualquer request. Variável de
        ambiente com o mesmo nome vence a global. Um fluxo pode gravar aqui (ex.: token do
        login) pelo nó de variável com escopo global.
      </div>
      {rows.map(([k, v], i) => (
        <div key={i} className="hdr-row">
          <input
            className="inp key"
            style={{ flex: "0 0 160px" }}
            placeholder="token"
            value={k}
            spellCheck={false}
            onChange={(e) => setRows(rows.map((r, idx) => (idx === i ? [e.target.value, v] : r)))}
          />
          <input
            className="inp val"
            placeholder="valor"
            value={v}
            spellCheck={false}
            onChange={(e) => setRows(rows.map((r, idx) => (idx === i ? [k, e.target.value] : r)))}
          />
          <button className="btn-icon danger" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="link-btn" onClick={() => setRows([...rows, ["", ""]])}>
        + adicionar variável global
      </button>
      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={save}>Salvar</button>
      </div>
    </Modal>
  );
}
