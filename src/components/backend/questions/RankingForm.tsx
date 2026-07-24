import { useState, type ClipboardEvent } from 'react';
import type { RankingQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import AudioTrimTimeline from '../AudioTrimTimeline';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty as stripTrailingEmptyQuestions } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: RankingQuestion[];
  onChange: (questions: RankingQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): RankingQuestion => ({ question: '', answers: [] });
const isEmptyQuestion = (q: RankingQuestion) =>
  !q.question.trim() && q.answers.length === 0 && !q.topic?.trim() && !(q.items?.some(s => s.trim()));

/** Empty item arrays are dropped (stored as `undefined`) so the JSON never carries `items: []`. */
const normItems = (items: string[]): string[] | undefined => (items.length > 0 ? items : undefined);

/** Add a single trailing empty slot for editing when the last real answer is filled —
 *  gives the user a "ready to type" row without a manual add-button. */
function displaySlots(answers: string[]): string[] {
  if (answers.length === 0 || answers[answers.length - 1]!.trim() !== '') {
    return [...answers, ''];
  }
  return answers;
}

/** Strip trailing empty answers so the persisted JSON never carries the editor-only
 *  trailing slot. Non-trailing empties are left alone — the author may want a gap. */
function stripTrailingEmptyAnswers(answers: string[]): string[] {
  const next = [...answers];
  while (next.length > 0 && next[next.length - 1]!.trim() === '') next.pop();
  return next;
}

export default function RankingForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  // Answers are collapsed by default; the set holds the indices currently expanded.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleAnswers = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // Answer-audio trim timeline is collapsed by default; keyed by question index.
  const [trimExpanded, setTrimExpanded] = useState<Set<number>>(new Set());
  const toggleTrim = (i: number) => {
    setTrimExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // Item pool (the candidates shown to teams) is collapsed by default too.
  const [itemsExpanded, setItemsExpanded] = useState<Set<number>>(new Set());
  const toggleItems = (i: number) => {
    setItemsExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const update = (i: number, patch: Partial<RankingQuestion>) => {
    let next: RankingQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i]!, ...patch };
    }
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };
  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => {
    const next = [...questions];
    const src = questions[i]!;
    next.splice(i + 1, 0, { ...src, answers: [...src.answers], items: src.items ? [...src.items] : undefined });
    onChange(next);
  };

  const updateItem = (qi: number, ii: number, value: string) => {
    const base = qi >= questions.length ? empty() : questions[qi]!;
    const items = [...(base.items ?? [])];
    while (items.length <= ii) items.push('');
    items[ii] = value;
    update(qi, { items: normItems(stripTrailingEmptyAnswers(items)) });
  };

  const removeItem = (qi: number, ii: number) => {
    if (qi >= questions.length) return;
    const next = [...questions];
    const items = (next[qi]!.items ?? []).filter((_, idx) => idx !== ii);
    next[qi] = { ...next[qi]!, items: normItems(stripTrailingEmptyAnswers(items)) };
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };

  // Paste a newline-separated list into an item row → one item per line.
  const pasteItems = (qi: number, ii: number, e: ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData.getData('text').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length <= 1) return; // single line → let the browser paste normally
    e.preventDefault();
    const base = qi >= questions.length ? empty() : questions[qi]!;
    const items = [...(base.items ?? [])];
    items.splice(ii, 1, ...lines);
    update(qi, { items: normItems(stripTrailingEmptyAnswers(items)) });
  };

  const updateAnswer = (qi: number, ai: number, value: string) => {
    const base = qi >= questions.length ? empty() : questions[qi]!;
    const answers = [...base.answers];
    while (answers.length <= ai) answers.push('');
    answers[ai] = value;
    update(qi, { answers: stripTrailingEmptyAnswers(answers) });
  };

  const removeAnswer = (qi: number, ai: number) => {
    if (qi >= questions.length) return;
    const next = [...questions];
    const answers = next[qi]!.answers.filter((_, idx) => idx !== ai);
    next[qi] = { ...next[qi]!, answers: stripTrailingEmptyAnswers(answers) };
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };

  const moveAnswer = (qi: number, ai: number, dir: -1 | 1) => {
    if (qi >= questions.length) return;
    const next = [...questions];
    const answers = [...next[qi]!.answers];
    const target = ai + dir;
    if (target < 0 || target >= answers.length) return;
    [answers[ai], answers[target]] = [answers[target]!, answers[ai]!];
    next[qi] = { ...next[qi]!, answers: stripTrailingEmptyAnswers(answers) };
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
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(var(--glass-rgb), 0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </>}
          </div>
          <div className="question-fields">
            <div className="full-width">
              <label className="be-label">Frage</label>
              <SpellField segKey={`q${i}.question`} className="be-input" value={q.question} placeholder={isVirtual ? 'Neue Frage – einfach hier tippen…' : 'z.B. Top 5 umsatzstärkste Filme 2023 – in absteigender Reihenfolge'} onChange={e => update(i, { question: e.target.value })} />
            </div>
            {!isVirtual && (
              <div className="full-width">
                <label className="be-label">Thema / Untertitel (optional)</label>
                <SpellField segKey={`q${i}.topic`} className="be-input" value={q.topic ?? ''} placeholder="Optionaler Hinweis unter der Frage" onChange={e => update(i, { topic: e.target.value || undefined })} />
              </div>
            )}
            {!isVirtual && (() => {
              const isOpen = itemsExpanded.has(i);
              const realItems = (q.items ?? []).filter(a => a.trim());
              const preview = realItems.length ? realItems.join(' · ') : 'Keine – nur die Frage wird angezeigt';
              return (
            <div className="full-width">
              <div
                onClick={() => toggleItems(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}
                title={isOpen ? 'Zuklappen' : 'Aufklappen'}
              >
                <span className={`gs-collapse-chevron${isOpen ? ' open' : ''}`}>▶</span>
                <label className="be-label" style={{ margin: 0, cursor: 'pointer', flexShrink: 0 }}>Zu sortierende Elemente ({realItems.length})</label>
                {!isOpen && (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--admin-sz-13, 13px)', color: realItems.length ? 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' : 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</span>
                )}
              </div>
              {isOpen && (
                <>
                  <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', margin: '2px 0 8px 24px' }}>
                    Die Kandidaten, die den Teams zum Sortieren angezeigt werden (ohne Lösung, in zufälliger Reihenfolge). Mehrere Zeilen lassen sich auf einmal einfügen.
                  </div>
                  {displaySlots(q.items ?? []).map((item, ii) => {
                    const isVirtualItem = ii >= (q.items ?? []).length;
                    return (
                      <div key={ii} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ minWidth: 28, textAlign: 'right', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))' }}>•</span>
                        <SpellField
                          segKey={`q${i}.items.${ii}`}
                          className="be-input"
                          style={{ flex: 1, margin: 0 }}
                          value={item}
                          placeholder={isVirtualItem ? 'Element hinzufügen… (mehrere Zeilen einfügbar)' : `Element ${ii + 1}`}
                          onChange={e => updateItem(i, ii, e.target.value)}
                          onPaste={e => pasteItems(i, ii, e)}
                        />
                        {!isVirtualItem && (
                          <button
                            className="be-delete-btn"
                            onClick={() => removeItem(i, ii)}
                            title="Element entfernen"
                            style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
              );
            })()}
            {!isVirtual && (() => {
              const isOpen = expanded.has(i);
              const realAnswers = q.answers.filter(a => a.trim());
              const preview = realAnswers.length
                ? realAnswers.map((a, ai) => `${ai + 1}. ${a}`).join(' · ')
                : 'Noch keine Antworten';
              return (
            <div className="full-width">
              <div
                onClick={() => toggleAnswers(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}
                title={isOpen ? 'Zuklappen' : 'Aufklappen'}
              >
                <span className={`gs-collapse-chevron${isOpen ? ' open' : ''}`}>▶</span>
                <label className="be-label" style={{ margin: 0, cursor: 'pointer', flexShrink: 0 }}>Antworten in korrekter Reihenfolge ({realAnswers.length})</label>
                {!isOpen && (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--admin-sz-13, 13px)', color: realAnswers.length ? 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' : 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</span>
                )}
              </div>
              {isOpen && displaySlots(q.answers).map((answer, ai) => {
                const isVirtual = ai >= q.answers.length;
                const lastRealIdx = q.answers.length - 1;
                return (
                  <div key={ai} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ minWidth: 28, textAlign: 'right', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', fontVariantNumeric: 'tabular-nums' }}>{ai + 1}.</span>
                    <SpellField
                      segKey={`q${i}.answers.${ai}`}
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
                          style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: ai === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)' }}
                        >↑</button>
                        <button
                          className="be-delete-btn"
                          onClick={() => moveAnswer(i, ai, 1)}
                          disabled={ai === lastRealIdx}
                          title="Nach unten"
                          style={{ width: 26, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: ai === lastRealIdx ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)' }}
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
              );
            })()}
            {!isVirtual && (
              <div className="full-width">
                <div className="audio-field-with-trim">
                  <AssetField
                    label="Antwort-Audio (optional)"
                    value={q.answerAudio || undefined}
                    category="audio"
                    scope={`q-${i}-answer`}
                    onChange={v => {
                      update(i, { answerAudio: v || undefined, answerAudioStart: undefined, answerAudioEnd: undefined, answerAudioLoop: undefined });
                      if (!v) setTrimExpanded(prev => { const n = new Set(prev); n.delete(i); return n; });
                    }}
                  />
                  <button
                    className={`audio-trim-toggle-btn${trimExpanded.has(i) ? ' active' : ''}${(q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) ? ' has-trim' : ''}`}
                    onClick={() => toggleTrim(i)}
                    title={trimExpanded.has(i) ? 'Trim ausblenden' : 'Trimmen'}
                    style={q.answerAudio ? undefined : { display: 'none' }}
                  >
                    ✂ Trimmen
                  </button>
                  {q.answerAudio && trimExpanded.has(i) && (
                    <AudioTrimTimeline
                      src={q.answerAudio}
                      scope={`q-${i}-answer`}
                      start={q.answerAudioStart}
                      end={q.answerAudioEnd}
                      loop={q.answerAudioLoop}
                      onChange={(s, e) => update(i, { answerAudioStart: s, answerAudioEnd: e })}
                      onLoopChange={v => update(i, { answerAudioLoop: v || undefined })}
                    />
                  )}
                </div>
                {q.answerAudio && (
                  <label className="be-toggle" style={{ margin: '8px 0 0' }}>
                    <input
                      type="checkbox"
                      checked={q.answerAudioTrigger === 'all'}
                      onChange={e => update(i, { answerAudioTrigger: e.target.checked ? 'all' : undefined })}
                    />
                    <span className="be-toggle-track" />
                    <span className="be-toggle-label">Erst abspielen, wenn alle Antworten aufgedeckt sind</span>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
