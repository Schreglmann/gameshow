import { useState, useEffect } from 'react';
import { isValidHex } from '@/utils/hexColor';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  /** Renders the ✕ button. Omit for a single field that always has a value. */
  onRemove?: () => void;
  removeTitle?: string;
  /**
   * When true, an empty field is a legal value and is committed as `''` instead
   * of being rejected — the team-colour "use the theme's colour" escape hatch.
   * Default false, which is the colorguess colour-list behaviour.
   */
  allowEmpty?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * A `#rrggbb` field: a swatch that opens the native colour picker plus a text
 * input that validates on blur, reverting and reporting an error on anything
 * that is not six hex digits. Both halves share one draft, so the picker and the
 * typed value can never disagree.
 *
 * Used by the colorguess question colours and by the per-team colours in the
 * admin Konfiguration tab. See specs/team-colors.md.
 */
export default function ColorPickerField({
  value,
  onChange,
  onError,
  onRemove,
  removeTitle = 'Farbe entfernen',
  allowEmpty = false,
  placeholder = '#000000',
  'aria-label': ariaLabel,
}: Props) {
  const [draft, setDraft] = useState(value);

  // Sync when the external value changes (e.g. cleared from outside, or another
  // colour dragged into this slot).
  useEffect(() => { setDraft(value); }, [value]);

  const valid = isValidHex(draft);
  const empty = draft.trim() === '';
  const showsError = !valid && !(allowEmpty && empty);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <label style={{ cursor: 'pointer', flexShrink: 0 }} title="Farbe wählen">
        <div style={{ width: 36, height: 36, borderRadius: 4, background: valid ? draft : '#888888', border: '1px solid rgba(255,255,255,0.2)' }} />
        <input
          type="color"
          value={valid ? draft : '#888888'}
          aria-label={ariaLabel}
          onChange={e => { setDraft(e.target.value); onChange(e.target.value); }}
          style={{ display: 'none' }}
        />
      </label>
      <input
        className="be-input"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (isValidHex(draft)) {
            onChange(draft);
          } else if (allowEmpty && empty) {
            onChange('');
          } else {
            onError(`Ungültiger Hex-Code "${draft}" – bitte im Format #rrggbb eingeben.`);
            setDraft(value);
          }
        }}
        style={{ width: 90, borderColor: showsError ? 'rgba(var(--error-deep-rgb),0.8)' : undefined }}
      />
      {onRemove && (
        <button className="be-icon-btn" onClick={onRemove} title={removeTitle}>✕</button>
      )}
    </div>
  );
}
