import type { RankingQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty as stripTrailingEmptyQuestions } from './ghostRow';

interface Props {
  questions: RankingQuestion[];
  onChange: (questions: RankingQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): RankingQuestion => ({ question: '', answers: [] });
const isEmptyQuestion = (q: RankingQuestion) =>
  !q.question.trim() && q.answers.length === 0 && !q.topic?.trim();

/** Add a single trailing empty slot for editing when the last real answer is filled —
 *  gives the user a "ready to type" row without a manual add-button. */
function displaySlots(answers: string[]): string[] {
  if (answers.length === 0 || answers[answers.length - 1].trim() !== '') {
    return [...answers, ''];
  }
  return answers;
}

/** Strip trailing empty answers so the persisted JSON never carries the editor-only
 *  trailing slot. Non-trailing empties are left alone — the author may want a gap. */
function stripTrailingEmptyAnswers(answers: string[]): string[] {
  const next = [...answers];
  while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
  return next;
}

export default function RankingForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const update = (i: number, patch: Partial<RankingQuestion>) => {
    let next: RankingQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i], ...patch };
    }
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => {
    const next = [...questions];
    next.splice(i + 1, 0, { ...questions[i], answers: [...questions[i].answers] });
    onChange(next);
  };

  const updateAnswer = (qi: number, ai: number, value: string) => {
    const base = qi >= questions.length ? empty() : questions[qi];
    const answers = [...base.answers];
    while (answers.length <= ai) answers.push('');
    answers[ai] = value;
    update(qi, { answers: stripTrailingEmptyAnswers(answers) });
  };

  const removeAnswer = (qi: number, ai: number) => {
    if (qi >= questions.length) return;
    const next = [...questions];
    const answers = next[qi].answers.filter((_, idx) => idx !== ai);
    next[qi] = { ...next[qi], answers: stripTrailingEmptyAnswers(answers) };
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };

  const moveAnswer = (qi: number, ai: number, dir: -1 | 1) => {
    if (qi >= questions.length) return;
    const next = [...questions];
    const answers = [...next[qi].answers];
    const target = ai + dir;
    if (target < 0 || target >= answers.length) return;
    [answers[ai], answers[target]] = [answers[target], answers[ai]];
    next[qi] = { ...next[qi], answers: stripTrailingEmptyAnswers(answers) };
    onChange(next);
  };

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
          <div className="question-block-row">
            <span className="drag-handle" draggable={!isVirtual} onDragStart={isVirtual ? undefined : drag.onDragStart(i)} style={isVirtual ? { visibility: 'hidden' } : undefined}>⠿</span>
            <span className="question-num">{isVirtual ? 'Neu' : i === 0 ? 'Beispiel' : `#${i}`}</span>
            <div style={{ flex: 1 }} />
            {!isVirtual && <>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </>}
          </div>
          <div className="question-fields">
            <div className="full-width">
              <label className="be-label">Frage</label>
              <input className="be-input" value={q.question} placeholder={isVirtual ? 'Neue Frage – einfach hier tippen…' : 'z.B. Top 5 umsatzstärkste Filme 2023 – in absteigender Reihenfolge'} onChange={e => update(i, { question: e.target.value })} />
            </div>
            {!isVirtual && (
              <div className="full-width">
                <label className="be-label">Thema / Untertitel (optional)</label>
                <input className="be-input" value={q.topic ?? ''} placeholder="Optionaler Hinweis unter der Frage" onChange={e => update(i, { topic: e.target.value || undefined })} />
              </div>
            )}
            {!isVirtual && (
            <div className="full-width">
              <label className="be-label">Antworten in korrekter Reihenfolge</label>
              {displaySlots(q.answers).map((answer, ai) => {
                const isVirtual = ai >= q.answers.length;
                const lastRealIdx = q.answers.length - 1;
                return (
                  <div key={ai} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ minWidth: 28, textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{ai + 1}.</span>
                    <input
                      className="be-input"
                      style={{ flex: 1, margin: 0 }}
                      value={answer}
                      placeholder={isVirtual ? 'Weitere Antwort hinzufügen…' : `Antwort ${ai + 1}`}
                      onChange={e => updateAnswer(i, ai, e.target.value)}
                    />
                    {!isVirtual && (
                      <>
                        <button
                          className="be-delete-btn"
                          onClick={() => moveAnswer(i, ai, -1)}
                          disabled={ai === 0}
                          title="Nach oben"
                          style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: ai === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)' }}
                        >↑</button>
                        <button
                          className="be-delete-btn"
                          onClick={() => moveAnswer(i, ai, 1)}
                          disabled={ai === lastRealIdx}
                          title="Nach unten"
                          style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: ai === lastRealIdx ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)' }}
                        >↓</button>
                        <button
                          className="be-delete-btn"
                          onClick={() => removeAnswer(i, ai)}
                          title="Antwort entfernen"
                          style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}
                        >×</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
