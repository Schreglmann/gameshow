import { useEffect, useRef } from 'react';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'default';
}

interface Props extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  description,
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  const confirmClass =
    confirmVariant === 'danger'
      ? 'be-icon-btn confirm-modal-confirm-danger'
      : 'be-icon-btn folder-prompt-confirm';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="confirm-modal-box"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h3 id="confirm-modal-title" className="confirm-modal-title">{title}</h3>
        {description && (
          <p className="confirm-modal-description">{description}</p>
        )}
        <div className="confirm-modal-actions">
          <button className="be-icon-btn" onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmBtnRef} className={confirmClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
