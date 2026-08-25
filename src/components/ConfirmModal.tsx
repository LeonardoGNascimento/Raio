import { Modal } from "./Modal";

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = "Excluir", onConfirm, onClose }: Props) {
  return (
    <Modal title={title} width={440} onClose={onClose}>
      <div className="modal-hint" style={{ marginBottom: 0 }}>{message}</div>
      <div className="modal-foot">
        <button className="btn-ghost" onClick={onClose} autoFocus>
          Cancelar
        </button>
        <button className="btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
