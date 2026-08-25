import { useState } from "react";
import { Modal } from "./Modal";

export interface ConfigTarget {
  collection: string;
  folder: string | null; // null = configurando a própria collection
}

interface Props {
  target: ConfigTarget;
  currentName: string;
  currentBase: string;
  currentBaseUrls?: [string, string][];
  /** nomes dos ambientes existentes, para sugestão */
  environments?: string[];
  /** modo criação: pasta ainda não existe */
  create?: boolean;
  onSave: (newName: string, baseUrl: string, baseUrls: [string, string][]) => void;
  onClose: () => void;
}

export function ConfigModal({
  target,
  currentName,
  currentBase,
  currentBaseUrls,
  environments = [],
  create,
  onSave,
  onClose,
}: Props) {
  const [name, setName] = useState(currentName);
  // migração: base antiga "qualquer ambiente" vira uma linha por ambiente existente
  const [baseUrls, setBaseUrls] = useState<[string, string][]>(() => {
    const existing = currentBaseUrls ?? [];
    if (existing.length > 0 || !currentBase) return existing;
    return environments.length > 0
      ? environments.map((e) => [e, currentBase] as [string, string])
      : [["", currentBase]];
  });
  const kind = target.folder !== null ? "pasta" : "collection";
  const title = create
    ? target.folder !== null
      ? "Nova pasta"
      : "Nova collection"
    : target.folder !== null
      ? "Configurar pasta"
      : "Configurar collection";

  const setRow = (i: number, env: string, url: string) =>
    setBaseUrls(baseUrls.map((r, idx) => (idx === i ? ([env, url] as [string, string]) : r)));

  const save = () =>
    onSave(name.trim() || currentName, "", baseUrls.filter(([e]) => e.trim()));

  const suggestions = environments.filter((e) => !baseUrls.some(([used]) => used === e));

  return (
    <Modal title={title} width={520} onClose={onClose}>
      <div className="modal-hint">
        Base URL desta {kind} por ambiente. Requests novas usam{" "}
        <span className="mono c-accent">{"{{@base}}"}</span>, resolvido pelo ambiente ativo na hora
        do envio. Ambiente que não existir é criado automaticamente ao salvar.
      </div>
      <div className="field-label">Nome</div>
      <input
        className="inp"
        style={{ width: "100%", marginBottom: 16, padding: "10px 12px", fontSize: 13 }}
        value={name}
        autoFocus={create}
        onFocus={(e) => create && e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <div className="field-label">bases por ambiente</div>
      {baseUrls.map(([envName, url], i) => (
        <div key={i} className="hdr-row">
          <input
            className="inp key"
            style={{ flex: "0 0 140px" }}
            placeholder="ambiente"
            list="cfg-envs"
            value={envName}
            onChange={(e) => setRow(i, e.target.value, url)}
            spellCheck={false}
          />
          <input
            className="inp val"
            placeholder="https://api-teste.exemplo.com"
            value={url}
            onChange={(e) => setRow(i, envName, e.target.value)}
            spellCheck={false}
          />
          <button
            className="btn-icon danger"
            onClick={() => setBaseUrls(baseUrls.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <datalist id="cfg-envs">
        {suggestions.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <button
        className="link-btn"
        onClick={() => setBaseUrls([...baseUrls, [suggestions[0] ?? "", ""]])}
      >
        + adicionar base por ambiente
      </button>

      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={save} disabled={create && !name.trim()}>
          {create ? `Criar ${kind}` : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
