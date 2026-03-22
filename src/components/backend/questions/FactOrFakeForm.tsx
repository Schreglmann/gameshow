import type { FactOrFakeQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';

interface Props {
  questions: FactOrFakeQuestion[];
  onChange: (questions: FactOrFakeQuestion[]) => void;
}

const empty = (): FactOrFakeQuestion => ({ statement: '', isFact: true, description: '' });

export default function FactOrFakeForm({ questions, onChange }: Props) {
  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<FactOrFakeQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''}`}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-top">
            <span className="drag-handle">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div style={{ flex: 1 }} />
            {/* Fakt/Fake toggle inline in header */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="be-icon-btn"
                style={{ background: (q.isFact ?? true) ? 'rgba(34,197,94,0.25)' : 'transparent', color: (q.isFact ?? true) ? '#86efac' : 'rgba(255,255,255,0.4)', borderColor: (q.isFact ?? true) ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)' }}
                onClick={() => update(i, { isFact: true, answer: 'FAKT' })}
              >FAKT</button>
              <button
                className="be-icon-btn"
                style={{ background: !(q.isFact ?? true) ? 'rgba(239,68,68,0.25)' : 'transparent', color: !(q.isFact ?? true) ? '#fca5a5' : 'rgba(255,255,255,0.4)', borderColor: !(q.isFact ?? true) ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.15)' }}
                onClick={() => update(i, { isFact: false, answer: 'FAKE' })}
              >FAKE</button>
            </div>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>⧉</button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}>🗑</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div>
              <label className="be-label">Aussage</label>
              <textarea className="be-textarea" value={q.statement} placeholder="Aussage eingeben..." onChange={e => update(i, { statement: e.target.value })} />
            </div>
            <div>
              <label className="be-label">Beschreibung (nach Auflösung)</label>
              <textarea className="be-textarea" value={q.description} placeholder="Erklärung / Hintergrundinfo..." onChange={e => update(i, { description: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Aussage hinzufügen
      </button>
    </div>
  );
}
