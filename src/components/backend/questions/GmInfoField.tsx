import SpellField from '../SpellField';

/** Gamemaster-only note per question (never shown on the show). See specs/gamemaster-info.md. */
export default function GmInfoField({ segKey, value, onChange, readOnly }: {
  segKey: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="full-width">
      <label className="be-label">Info für Gamemaster (nur GM-Ansicht)</label>
      <SpellField
        as="textarea"
        segKey={segKey}
        className="be-textarea"
        rows={2}
        // game.css pins every <textarea> to 200px; let `rows` size it instead
        style={{ height: 'auto' }}
        value={value ?? ''}
        placeholder="Nur für den Gamemaster sichtbar, z. B. Hintergrundwissen, Aussprache, was noch als richtig gilt…"
        readOnly={readOnly}
        onChange={e => onChange(e.target.value || undefined)}
      />
    </div>
  );
}
