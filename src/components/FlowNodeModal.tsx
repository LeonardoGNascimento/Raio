import { useState } from "react";
import { Modal } from "./Modal";
import { VarInput } from "./VarInput";
import { CodeArea } from "./CodeArea";
import { highlightJson } from "../lib/format";
import { handleCodeEditorKeys } from "../lib/codeEditor";
import { COND_OPS, type FlowNode, type NodeOverrides } from "../lib/flow";
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
  request: "Envio neste fluxo",
};

export function FlowNodeModal({ node, env, nodeSuggestions, onSave, onClose }: Props) {
  const [left, setLeft] = useState(node.condLeft ?? "");
  const [op, setOp] = useState(node.condOp ?? "==");
  const [right, setRight] = useState(node.condRight ?? "");
  const [varName, setVarName] = useState(node.varName ?? "");
  const [varValue, setVarValue] = useState(node.varValue ?? "");
  const [message, setMessage] = useState(node.message ?? "");
  const [delayMs, setDelayMs] = useState(node.delayMs ?? 1000);
  const [ovBody, setOvBody] = useState(node.overrides?.body ?? "");
  const [ovHeaders, setOvHeaders] = useState<[string, string][]>(node.overrides?.headers ?? []);
  const [ovQuery, setOvQuery] = useState<[string, string][]>(node.overrides?.query ?? []);
  const [ovPath, setOvPath] = useState<[string, string][]>(node.overrides?.path_params ?? []);

  const save = () => {
    if (node.kind === "cond") onSave({ condLeft: left, condOp: op, condRight: right, expr: undefined });
    if (node.kind === "setvar") onSave({ varName, varValue });
    if (node.kind === "log") onSave({ message });
    if (node.kind === "delay") onSave({ delayMs });
    if (node.kind === "request") {
      const clean = (rows: [string, string][]) => rows.filter(([k]) => k.trim());
      const overrides: NodeOverrides = {
        body: ovBody.trim() ? ovBody : undefined,
        headers: clean(ovHeaders),
        query: clean(ovQuery),
        path_params: clean(ovPath),
      };
      onSave({ overrides });
    }
    onClose();
  };

  const kvRows = (
    rows: [string, string][],
    setRows: (r: [string, string][]) => void,
    keyPh: string,
    valPh: string,
  ) => (
    <>
      {rows.map(([k, v], i) => (
        <div key={i} className="hdr-row">
          <input
            className="inp key"
            style={{ flex: "0 0 150px" }}
            placeholder={keyPh}
            value={k}
            spellCheck={false}
            onChange={(e) => setRows(rows.map((r, idx) => (idx === i ? [e.target.value, v] : r)))}
          />
          <VarInput
            extraSuggestions={nodeSuggestions}
            className="inp val"
            placeholder={valPh}
            value={v}
            env={env}
            onChange={(nv) => setRows(rows.map((r, idx) => (idx === i ? [k, nv] : r)))}
          />
          <button className="btn-icon danger" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="link-btn" onClick={() => setRows([...rows, ["", ""]])}>
        + adicionar
      </button>
    </>
  );

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

      {node.kind === "request" && (
        <>
          <div className="modal-hint">
            Estes valores valem <b>só neste fluxo</b> — a request original não muda. Body
            preenchido substitui o da request; headers, query e path params são mesclados por
            cima (mesma chave substitui). Aceita <span className="mono">{"{{variáveis}}"}</span>{" "}
            e <span className="mono">{"{{ref.body.…}}"}</span> de nós anteriores.
          </div>
          <div className="field-label">body (vazio = usa o da request)</div>
          <div className="flow-ov-body">
            <CodeArea
              value={ovBody}
              placeholder='{ "chave": "{{criar.body.id}}" }'
              highlight={highlightJson}
              onChange={setOvBody}
              onKeyDown={(e) => handleCodeEditorKeys(e, setOvBody)}
              env={env}
              extraSuggestions={nodeSuggestions}
            />
          </div>
          <div className="field-label" style={{ marginTop: 14 }}>headers</div>
          {kvRows(ovHeaders, setOvHeaders, "X-Meu-Header", "valor")}
          <div className="field-label" style={{ marginTop: 14 }}>query params</div>
          {kvRows(ovQuery, setOvQuery, "param", "valor")}
          <div className="field-label" style={{ marginTop: 14 }}>path params</div>
          {kvRows(ovPath, setOvPath, "id", "valor")}
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
