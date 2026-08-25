import { useState } from "react";
import { Modal } from "./Modal";
import { EXPORT_FMTS, genExport, type ExportFmt, type ExportInput } from "../lib/exporters";

interface Props {
  input: ExportInput;
  onClose: () => void;
}

export function ExportModal({ input, onClose }: Props) {
  const [fmt, setFmt] = useState<ExportFmt>("curl");
  const [copied, setCopied] = useState(false);

  const code = genExport(fmt, input);
  const file = EXPORT_FMTS.find((f) => f.id === fmt)?.file ?? "request.txt";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <Modal title="Exportar request" width={660} onClose={onClose}>
      <div className="fmt-row">
        {EXPORT_FMTS.map((f) => (
          <button
            key={f.id}
            className={"fmt-btn" + (fmt === f.id ? " active" : "")}
            onClick={() => setFmt(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="code-panel">
        <div className="code-panel-head">
          <span>{file}</span>
          <span style={{ flex: 1 }} />
          <button className="copy-btn" onClick={copy}>{copied ? "copiado ✓" : "copiar"}</button>
        </div>
        <pre className="export-pre">{code}</pre>
      </div>
    </Modal>
  );
}
