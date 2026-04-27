import { useState, useEffect, useRef } from 'react';

interface FolderNamePromptProps {
  title: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function FolderNamePrompt({ title, onConfirm, onCancel }: FolderNamePromptProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="folder-prompt-box" onClick={e => e.stopPropagation()}>
        <h3 className="folder-prompt-title">{title}</h3>
        <input
          ref={inputRef}
          className="be-input folder-prompt-input"
          placeholder="Name…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="folder-prompt-actions">
          <button className="be-icon-btn" onClick={onCancel}>Abbrechen</button>
          <button className="be-icon-btn folder-prompt-confirm" onClick={handleSubmit} disabled={!value.trim()}>
            Erstellen
          </button>
        </div>
      </div>
    </div>
  );
}
