import { useEffect, useState } from 'react';
import { normalizeWhitespace } from '@/utils/playerNames';

export interface PlayerNames {
  firstName: string;
  lastName: string;
  nickname: string;
}

interface Props {
  title: string;
  initial: PlayerNames;
  submitLabel: string;
  /** Save the names. Returns a German error to show, or null when it worked (the dialog then closes). */
  onSubmit: (names: PlayerNames) => string | null;
  onClose: () => void;
}

/**
 * The popup that creates a registry player: first name, surname and nickname
 * (Spitzname — what the show calls them; empty = first name). Editing happens
 * in the player lightbox (`PlayerLightbox`).
 * See specs/players.md.
 */
export default function PlayerEditDialog({ title, initial, submitLabel, onSubmit, onClose }: Props) {
  const [names, setNames] = useState<PlayerNames>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const field = (key: keyof PlayerNames) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setNames(prev => ({ ...prev, [key]: e.target.value }));
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = onSubmit(names);
    if (result) setError(result);
    else onClose();
  };

  const first = normalizeWhitespace(names.firstName);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="folder-prompt-box player-edit-dialog"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-edit-title"
        // The browser's contact autofill marks fields it reads as name fields; there is nothing to fill here.
        autoComplete="off"
      >
        <h3 id="player-edit-title" className="folder-prompt-title">{title}</h3>
        <label className="player-edit-field">
          <span className="be-label">Vorname</span>
          <input className="be-input" autoFocus autoComplete="off" value={names.firstName} onChange={field('firstName')} />
        </label>
        <label className="player-edit-field">
          <span className="be-label">Nachname</span>
          <input className="be-input" autoComplete="off" value={names.lastName} onChange={field('lastName')} />
        </label>
        <label className="player-edit-field">
          <span className="be-label">Spitzname</span>
          <input
            className="be-input"
            autoComplete="off"
            placeholder={first || 'Leer = Vorname'}
            value={names.nickname}
            onChange={field('nickname')}
          />
        </label>
        {error && <p className="be-field-hint be-field-error" role="alert">{error}</p>}
        <div className="folder-prompt-actions">
          <button type="button" className="be-icon-btn" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="be-icon-btn folder-prompt-confirm">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
