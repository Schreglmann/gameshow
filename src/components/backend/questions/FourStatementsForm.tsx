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
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i], trueStatements: [...questions[i].trueStatements] }); onChange(next); };

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-top">
            <span className="drag-handle">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div style={{ flex: 1 }} />
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
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
