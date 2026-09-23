export type SaveStatusVariant = 'saving' | 'saved' | 'retrying' | 'offline' | 'error';

const TONE: Record<SaveStatusVariant, 'success' | 'error' | 'warning'> = {
  saving: 'success',
  saved: 'success',
  offline: 'warning',
  retrying: 'warning',
  error: 'error',
};

interface Props {
  variant: SaveStatusVariant;
  text: string;
  action?: { label: string; onClick: () => void };
}

/**
 * The save status rendered as an ordinary admin toast, so it shares the
 * bottom-right box every other admin message uses. Kept separate from
 * SaveStatusIndicator so the Theme Showcase renders the real markup for every
 * variant and cannot drift.
 */
export default function SaveStatusToast({ variant, text, action }: Props) {
  return (
    <div className={`be-toast be-toast-${TONE[variant]}`} role="status" aria-live="polite">
      <span className="be-toast-text">{text}</span>
      {action && (
        <button type="button" className="be-toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
