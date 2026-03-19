import type { FourStatementsQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';

interface Props {
  questions: FourStatementsQuestion[];
  onChange: (questions: FourStatementsQuestion[]) => void;
}

const empty = (): FourStatementsQuestion => ({ Frage: '', trueStatements: ['', '', ''], wrongStatement: '' });

export default function FourStatementsForm({ questions, onChange }: Props) {
  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<FourStatementsQuestion>) => {
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
            <div className="full-width">
              <label className="be-label">Frage / Thema</label>
              <input className="be-input" value={q.Frage} placeholder="Worüber geht es?" onChange={e => update(i, { Frage: e.target.value })} />
            </div>
            {[0, 1, 2].map(j => (
              <div key={j}>
                <label className="be-label" style={{ color: 'rgba(134,239,172,0.8)' }}>✓ Wahre Aussage {j + 1}</label>
                <input
                  className="be-input"
                  value={q.trueStatements[j] ?? ''}
                  placeholder={`Wahre Aussage ${j + 1}...`}
                  onChange={e => {
                    const ts = [...(q.trueStatements.length >= 3 ? q.trueStatements : ['', '', ''])];
                    ts[j] = e.target.value;
                    update(i, { trueStatements: ts });
                  }}
                />
              </div>
            ))}
            <div>
              <label className="be-label" style={{ color: 'rgba(252,165,165,0.8)' }}>✗ Falsche Aussage</label>
              <input className="be-input" value={q.wrongStatement} placeholder="Die falsche Aussage..." onChange={e => update(i, { wrongStatement: e.target.value })} />
            </div>
            <div>
              <label className="be-label">Auflösungstext (optional)</label>
              <input className="be-input" value={q.answer ?? ''} placeholder="Optionaler Erklärungstext..." onChange={e => update(i, { answer: e.target.value || undefined })} />
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
