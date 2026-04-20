import type { FourStatementsQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';

interface Props {
  questions: FourStatementsQuestion[];
  onChange: (questions: FourStatementsQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const SLOT_COUNT = 4;

const empty = (): FourStatementsQuestion => ({ topic: '', statements: ['', '', '', ''] });

/** Pad to SLOT_COUNT for editing. Preserves existing order so typed content stays in its slot. */
function padSlots(statements: string[]): string[] {
  const next = [...statements];
  while (next.length < SLOT_COUNT) next.push('');
  return next.slice(0, SLOT_COUNT);
}

export default function FourStatementsForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<FourStatementsQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i], statements: [...questions[i].statements] }); onChange(next); };

  const updateStatement = (qi: number, si: number, value: string) => {
    const next = [...questions];
    const padded = padSlots(next[qi].statements);
    padded[si] = value;
    next[qi] = { ...next[qi], statements: padded };
    onChange(next);
  };

  return (
    <div>
      {questions.map((q, i) => {
        const slots = padSlots(q.statements);
        return (
          <div
            key={i}
            className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
            data-question-index={i}
            onDragOver={drag.onDragOver(i)}
            onDragEnd={drag.onDragEnd}
          >
            <div className="question-block-row">
              <span className="drag-handle" draggable onDragStart={drag.onDragStart(i)}>⠿</span>
              <span className="question-num">{i === 0 ? 'Beispiel' : `#${i}`}</span>
              <div style={{ flex: 1 }} />
              <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
              <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
              {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
              <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </div>
            <div className="question-fields">
              <div className="full-width">
                <label className="be-label">Thema / Frage</label>
                <input className="be-input" value={q.topic} placeholder="Worüber geht es? (z.B. Gesucht ist ein Erfinder)" onChange={e => update(i, { topic: e.target.value })} />
              </div>
              {slots.map((stmt, si) => (
                <div key={si}>
                  <label className="be-label">Hinweis {si + 1} {stmt.trim() ? '' : <span style={{ opacity: 0.5, fontWeight: 400 }}>(leer)</span>}</label>
                  <input
                    className="be-input"
                    value={stmt}
                    placeholder={`Hinweis ${si + 1}...`}
                    onChange={e => updateStatement(i, si, e.target.value)}
                  />
                </div>
              ))}
              <div>
                <label className="be-label">Antwort-Text</label>
                <input className="be-input" value={q.answer ?? ''} placeholder="Lösung als Text..." onChange={e => update(i, { answer: e.target.value || undefined })} />
              </div>
              <div>
                <AssetField
                  label="Antwort-Bild"
                  value={q.answerImage}
                  category="images"
                  onChange={v => update(i, { answerImage: v || undefined })}
                />
              </div>
            </div>
          </div>
        );
      })}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
