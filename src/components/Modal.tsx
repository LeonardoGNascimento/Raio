import type { ReactNode } from "react";

interface Props {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, width = 580, onClose, children }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="title">{title}</span>
          <button className="x" onClick={onClose} aria-label="fechar">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
