import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Gamemaster-zone confirmation dialog.
 *
 * Deliberately NOT the admin `ConfirmModal`: its `ConfirmProvider` is mounted
 * only in `src/entries/admin.tsx`, and its `.modal-overlay` / `.confirm-modal-*`
 * classes live in `src/backend.css`, which the gamemaster bundle does not load.
 * Behaviour is mirrored (alertdialog role, autofocused confirm, Enter confirms,
 * Escape cancels, backdrop click cancels) on `.gm-confirm-*` classes.
 *
 * `data-gm-no-nav` opts every element out of `GamemasterScreen`'s document-level
 * click-to-advance handler — without it, clicking the backdrop to dismiss would
 * also send `nav-forward` to the show. The keyboard side is suppressed by
 * `GamemasterScreen` while a dialog is open.
 *
 * See specs/gamemaster-run-of-show.md.
 */
export default function GmConfirmDialog({
  title,
  description,
  confirmLabel = 'Springen',
  cancelLabel = 'Abbrechen',
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
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    // Capture phase: GamemasterScreen listens on `document` for Space/Arrow keys.
    // It self-suppresses while this dialog is open, but capturing keeps Enter and
    // Escape from reaching anything else regardless.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onConfirm, onCancel]);

  // Rendered into `document.body`, NOT in place. The panel that opens this
  // dialog is a fixed, transformed, overflow-scrolling container, and on iOS
  // Safari such an ancestor becomes the containing block for a `position: fixed`
  // descendant — the overlay was then sized and clipped to the sidebar, so on an
  // iPad the menu greyed out and the dialog box never appeared. A portal takes
  // the overlay out of that subtree entirely. Same approach as Lightbox.tsx.
  return createPortal(
    <div className="gm-confirm-overlay" onClick={onCancel} data-gm-no-nav>
      <div
        className="gm-confirm-box"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gm-confirm-title"
        data-gm-no-nav
      >
        <h3 id="gm-confirm-title" className="gm-confirm-title">{title}</h3>
        {description && <div className="gm-confirm-description">{description}</div>}
        <div className="gm-confirm-actions">
          <button type="button" className="gm-btn" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={confirmBtnRef} className="gm-btn gm-btn--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
