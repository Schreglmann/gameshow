import type { FactOrFakeQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';

interface Props {
  questions: FactOrFakeQuestion[];
  onChange: (questions: FactOrFakeQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): FactOrFakeQuestion => ({ statement: '', isFact: true, description: '' });
const isEmpty = (q: FactOrFakeQuestion) =>
  !q.statement.trim() && !q.description.trim();

export default function FactOrFakeForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const update = (i: number, patch: Partial<FactOrFakeQuestion>) => {
    let next: FactOrFakeQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i], ...patch };
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  return (
    <div>
      {displayQuestions.map((q, i) => {
        const isVirtual = i >= questions.length;
        return (
        <div
          key={i}
          className={`question-block ${!isVirtual && drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''} ${isVirtual ? 'question-block--ghost' : ''}`}
          data-question-index={i}
          onDragOver={isVirtual ? undefined : drag.onDragOver(i)}
          onDragEnd={isVirtual ? undefined : drag.onDragEnd}
        >
          <div className="question-block-top">
            <span className="drag-handle" draggable={!isVirtual} onDragStart={isVirtual ? undefined : drag.onDragStart(i)} style={isVirtual ? { visibility: 'hidden' } : undefined}>⠿</span>
            <span className="question-num">{isVirtual ? 'Neu' : i === 0 ? 'Beispiel' : `#${i}`}</span>
            <div style={{ flex: 1 }} />
            {!isVirtual && <>
            {/* Fakt/Fake toggle inline in header */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="be-icon-btn"
                style={{ background: (q.isFact ?? true) ? 'rgba(var(--success-rgb),0.25)' : 'transparent', color: (q.isFact ?? true) ? 'var(--success)' : 'rgba(var(--text-rgb),0.4)', borderColor: (q.isFact ?? true) ? 'rgba(var(--success-rgb),0.5)' : 'rgba(var(--glass-rgb),0.15)' }}
                onClick={() => update(i, { isFact: true, answer: 'FAKT' })}
              >FAKT</button>
              <button
                className="be-icon-btn"
                style={{ background: !(q.isFact ?? true) ? 'rgba(var(--error-deep-rgb),0.25)' : 'transparent', color: !(q.isFact ?? true) ? 'var(--error-lighter)' : 'rgba(var(--text-rgb),0.4)', borderColor: !(q.isFact ?? true) ? 'rgba(var(--error-deep-rgb),0.5)' : 'rgba(var(--glass-rgb),0.15)' }}
                onClick={() => update(i, { isFact: false, answer: 'FAKE' })}
              >FAKE</button>
            </div>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div>
              <label className="be-label">Aussage</label>
              <textarea className="be-textarea" value={q.statement} placeholder={isVirtual ? 'Neue Aussage – einfach hier tippen…' : 'Aussage eingeben...'} onChange={e => update(i, { statement: e.target.value })} />
            </div>
            {!isVirtual && (
              <div>
                <label className="be-label">Beschreibung (nach Auflösung)</label>
                <textarea className="be-textarea" value={q.description} placeholder="Erklärung / Hintergrundinfo..." onChange={e => update(i, { description: e.target.value })} />
              </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
