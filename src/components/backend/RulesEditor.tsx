import { useRef, useLayoutEffect } from 'react';
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
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cursorRef = useRef<{ index: number; pos: number } | null>(null);

  useLayoutEffect(() => {
    if (cursorRef.current) {
      const { index, pos } = cursorRef.current;
      inputRefs.current[index]?.setSelectionRange(pos, pos);
      cursorRef.current = null;
    }
  });

  const update = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const next = [...rules];
    next[i] = e.target.value;
    cursorRef.current = { index: i, pos: e.target.selectionStart ?? e.target.value.length };
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Regel entfernen?')) onChange(rules.filter((_, idx) => idx !== i)); };

  return (
    <div>
      {rules.map((rule, i) => (
        <div
          key={i}
          className={`be-list-row ${drag.overIdx === i ? 'be-dragging' : ''}`}
          onDragOver={drag.onDragOver(i)}
        >
          <span
            className="drag-handle"
            style={{ fontSize: 'var(--admin-sz-14, 14px)' }}
            draggable
            onDragStart={drag.onDragStart(i)}
            onDragEnd={drag.onDragEnd}
          >⠿</span>
          <input
            ref={el => { inputRefs.current[i] = el; }}
            className="be-input"
            value={rule}
            placeholder={placeholder}
            onChange={e => update(i, e)}
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
