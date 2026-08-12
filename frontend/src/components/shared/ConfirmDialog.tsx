import { useState } from "react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker={danger ? "Point of no return" : "Confirmation"}
      title={title}
      width="sm"
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => void handleConfirm()}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[14px] font-light leading-relaxed text-stone">{message}</p>
    </Modal>
  );
}