import type { ReactNode } from 'react';
import { useDragReorder } from './useDragReorder';

interface Props {
  rules: string[];
  onChange: (rules: string[]) => void;
  placeholder?: string;
  extra?: ReactNode;
}

export default function RulesEditor({ rules, onChange, placeholder = 'Neue Regel...', extra }: Props) {
  const drag = useDragReorder(rules, onChange);

  const update = (i: number, val: string) => {
    const next = [...rules];
    next[i] = val;
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Regel entfernen?')) onChange(rules.filter((_, idx) => idx !== i)); };

  return (
    <div>
      {rules.map((rule, i) => (
        <div
          key={i}
          className={`be-list-row ${drag.overIdx === i ? 'be-dragging' : ''}`}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <span className="drag-handle" style={{ fontSize: 14 }}>⠿</span>
          <input
            className="be-input"
            value={rule}
            placeholder={placeholder}
            onChange={e => update(i, e.target.value)}
          />
          <button className="be-delete-btn" onClick={() => remove(i)} title="Entfernen">🗑</button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <button className="be-icon-btn" onClick={() => onChange([...rules, ''])}>
          + Hinzufügen
        </button>
        {extra}
      </div>
    </div>
  );
}
