import { useState } from "react";
import type { Environment } from "../types";
import { envDotClass } from "../types";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  collection: string;
  environments: Environment[];
  onSave: (envs: Environment[]) => void;
  onClose: () => void;
}

export function EnvModal({ collection, environments, onSave, onClose }: Props) {
  const [envs, setEnvs] = useState<Environment[]>(() => structuredClone(environments));
  const [selected, setSelected] = useState(0);
  const [askDelete, setAskDelete] = useState(false);
  const cur = envs[selected];

  const setCur = (patch: Partial<Environment>) =>
    setEnvs(envs.map((e, i) => (i === selected ? { ...e, ...patch } : e)));

  const setVar = (i: number, k: string, v: string) =>
    setCur({ vars: cur.vars.map((entry, idx) => (idx === i ? [k, v] : entry)) });

  return (
    <Modal title={`Ambientes · ${collection}`} width={640} onClose={onClose}>
      <div className="env-layout">
        <div className="env-list-col">
          {envs.map((e, i) => (
            <div
              key={i}
              className={"env-item" + (i === selected ? " active" : "")}
              onClick={() => setSelected(i)}
            >
              <span className={"dot " + envDotClass(e.name)} style={{ background: "currentColor" }} />
              {e.name || "(sem nome)"}
            </div>
          ))}
          <button
            className="env-add"
            onClick={() => {
              setEnvs([...envs, { name: `env-${envs.length + 1}`, vars: [] }]);
              setSelected(envs.length);
            }}
          >
            + ambiente
          </button>
        </div>
        <div className="env-detail">
          {cur ? (
            <>
              <div className="env-var-row">
                <input
                  className="inp"
                  style={{ flex: 1 }}
                  value={cur.name}
                  onChange={(e) => setCur({ name: e.target.value })}
                  placeholder="nome do ambiente"
                />
                <button
                  className="btn-danger-ghost"
                  onClick={() => setAskDelete(true)}
                >
                  excluir
                </button>
              </div>
              <div className="env-vars-head">
                <span style={{ flex: "0 0 38%" }}>variável</span>
                <span>valor</span>
              </div>
              {cur.vars.map(([k, v], i) => (
                <div key={i} className="env-var-row">
                  <input className="inp key" placeholder="variável" value={k} onChange={(e) => setVar(i, e.target.value, v)} />
                  <input className="inp val" placeholder="valor" value={v} onChange={(e) => setVar(i, k, e.target.value)} />
                  <button
                    className="btn-icon danger"
                    onClick={() => setCur({ vars: cur.vars.filter((_, idx) => idx !== i) })}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="link-btn" onClick={() => setCur({ vars: [...cur.vars, ["", ""]] })}>
                + adicionar variável
              </button>
              <p className="modal-hint" style={{ marginTop: 12 }}>
                Use <span className="mono c-accent">{"{{variavel}}"}</span> na URL, headers ou body.
              </p>
            </>
          ) : (
            <p className="modal-hint">Crie um ambiente à esquerda.</p>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn-primary" onClick={() => onSave(envs.filter((e) => e.name.trim()))}>
          Salvar ambientes
        </button>
      </div>
      {askDelete && cur && (
        <ConfirmModal
          title="Excluir ambiente"
          message={
            <>
              Excluir o ambiente <span className="mono" style={{ color: "var(--text)" }}>{cur.name}</span> e
              suas variáveis? Vale ao salvar.
            </>
          }
          confirmLabel="Excluir ambiente"
          onConfirm={() => {
            const next = envs.filter((_, i) => i !== selected);
            setEnvs(next);
            setSelected(Math.max(0, selected - 1));
            setAskDelete(false);
          }}
          onClose={() => setAskDelete(false)}
        />
      )}
    </Modal>
  );
}
