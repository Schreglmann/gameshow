import type { GuessingGameQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';

interface Props {
  questions: GuessingGameQuestion[];
  onChange: (questions: GuessingGameQuestion[]) => void;
}

const empty = (): GuessingGameQuestion => ({ question: '', answer: 0 });

export default function GuessingGameForm({ questions, onChange }: Props) {
  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<GuessingGameQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };

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
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen">🗑</button>
          </div>
          <div className="question-fields">
            <div>
              <label className="be-label">Frage</label>
              <input className="be-input" value={q.question} placeholder="Was wird geschätzt?" onChange={e => update(i, { question: e.target.value })} />
            </div>
            <div>
              <label className="be-label">Antwort (Zahl)</label>
              <input className="be-input" type="number" value={q.answer} onChange={e => update(i, { answer: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="full-width">
              <AssetField
                label="Antwort-Bild (optional)"
                value={q.answerImage}
                category="images"
                onChange={v => update(i, { answerImage: v })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
