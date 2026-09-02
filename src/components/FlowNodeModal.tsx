import { useState } from "react";
import { Modal } from "./Modal";
import { VarInput } from "./VarInput";
import { COND_OPS, type FlowNode } from "../lib/flow";
import type { Environment } from "../types";
import type { Suggestion } from "./VarSuggest";

interface Props {
  node: FlowNode;
  env: Environment | null;
  /** sugestões {{ref.*}} das responses dos nós do fluxo */
  nodeSuggestions?: Suggestion[];
  onSave: (patch: Partial<FlowNode>) => void;
  onClose: () => void;
}

const TITLES: Record<string, string> = {
  cond: "Configurar decisão",
  setvar: "Configurar variável",
  log: "Configurar log",
  delay: "Configurar espera",
};

export function FlowNodeModal({ node, env, nodeSuggestions, onSave, onClose }: Props) {
  const [left, setLeft] = useState(node.condLeft ?? "");
  const [op, setOp] = useState(node.condOp ?? "==");
  const [right, setRight] = useState(node.condRight ?? "");
  const [varName, setVarName] = useState(node.varName ?? "");
  const [varValue, setVarValue] = useState(node.varValue ?? "");
  const [message, setMessage] = useState(node.message ?? "");
  const [delayMs, setDelayMs] = useState(node.delayMs ?? 1000);

  const save = () => {
    if (node.kind === "cond") onSave({ condLeft: left, condOp: op, condRight: right, expr: undefined });
    if (node.kind === "setvar") onSave({ varName, varValue });
    if (node.kind === "log") onSave({ message });
    if (node.kind === "delay") onSave({ delayMs });
    onClose();
  };

  const inputStyle = { width: "100%", padding: "10px 12px", fontSize: 13 };

  return (
    <Modal title={TITLES[node.kind] ?? "Configurar"} width={520} onClose={onClose}>
      {node.kind === "cond" && (
        <>
          <div className="modal-hint">
            Este passo decide o caminho do fluxo: se a condição for <b>verdadeira</b>, segue pela
            saída <span className="c-ok">verde</span>; se for <b>falsa</b>, pela{" "}
            <span className="c-err">vermelha</span>. Digite <span className="mono">{"{{"}</span>{" "}
            para escolher uma variável.
          </div>
          <div className="field-label">valor a testar</div>
          <VarInput
            extraSuggestions={nodeSuggestions}
            className="inp"
            style={inputStyle}
            placeholder="{{id}}"
            value={left}
            env={env}
            onChange={setLeft}
          />
          <div className="field-label" style={{ marginTop: 14 }}>condição</div>
          <select className="inp" style={inputStyle} value={op} onChange={(e) => setOp(e.target.value)}>
            {COND_OPS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {op !== "exists" && (
            <>
              <div className="field-label" style={{ marginTop: 14 }}>comparar com</div>
              <VarInput
            extraSuggestions={nodeSuggestions}
                className="inp"
                style={inputStyle}
                placeholder="10"
                value={right}
                env={env}
                onChange={setRight}
              />
            </>
          )}
        </>
      )}

      {node.kind === "setvar" && (
        <>
          <div className="modal-hint">
            Cria (ou altera) uma variável para os próximos passos usarem como{" "}
            <span className="mono c-accent">{"{{nome}}"}</span>. O valor aceita outras variáveis e
            geradores como <span className="mono">{"{{global.uuid}}"}</span>.
          </div>
          <div className="field-label">nome da variável</div>
          <input
            className="inp"
            style={inputStyle}
            placeholder="meuId"
            value={varName}
            spellCheck={false}
            onChange={(e) => setVarName(e.target.value)}
          />
          <div className="field-label" style={{ marginTop: 14 }}>valor</div>
          <VarInput
            extraSuggestions={nodeSuggestions}
            className="inp"
            style={inputStyle}
            placeholder="{{global.uuid}}"
            value={varValue}
            env={env}
            onChange={setVarValue}
          />
        </>
      )}

      {node.kind === "log" && (
        <>
          <div className="modal-hint">
            Escreve uma mensagem no log da execução, embaixo do canvas. Digite{" "}
            <span className="mono">{"{{"}</span> para inserir variáveis do fluxo.
          </div>
          <div className="field-label">mensagem</div>
          <VarInput
            extraSuggestions={nodeSuggestions}
            className="inp"
            style={inputStyle}
            placeholder="pedido criado com id {{id}}"
            value={message}
            env={env}
            onChange={setMessage}
          />
        </>
      )}

      {node.kind === "delay" && (
        <>
          <div className="modal-hint">Pausa o fluxo por um tempo antes de seguir para o próximo passo.</div>
          <div className="field-label">esperar (milissegundos)</div>
          <input
            className="inp"
            style={inputStyle}
            type="number"
            min={0}
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {[500, 1000, 3000, 5000].map((ms) => (
              <button key={ms} className="btn-ghost" onClick={() => setDelayMs(ms)}>
                {ms >= 1000 ? ms / 1000 + "s" : ms + "ms"}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={save}>Salvar</button>
      </div>
    </Modal>
  );
}
