import { useState } from 'react';
import type { FourStatementsQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import AudioTrimTimeline from '../AudioTrimTimeline';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: FourStatementsQuestion[];
  onChange: (questions: FourStatementsQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const SLOT_COUNT = 4;

const empty = (): FourStatementsQuestion => ({ topic: '', statements: ['', '', '', ''] });
const isEmpty = (q: FourStatementsQuestion) =>
  !q.topic.trim() &&
  q.statements.every(s => !s.trim()) &&
  !q.answer?.trim() &&
  !q.answerImage &&
  !q.answerAudio;

/** Pad to SLOT_COUNT for editing. Preserves existing order so typed content stays in its slot. */
function padSlots(statements: string[]): string[] {
  const next = [...statements];
  while (next.length < SLOT_COUNT) next.push('');
  return next.slice(0, SLOT_COUNT);
}

export default function FourStatementsForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  // Track which questions have their answer-audio trim panel open; key = "${i}-answer".
  const [trimExpanded, setTrimExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    questions.forEach((q, i) => {
      if (q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) initial.add(`${i}-answer`);
    });
    return initial;
  });
  const toggleTrim = (key: string) =>
    setTrimExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const update = (i: number, patch: Partial<FourStatementsQuestion>) => {
    let next: FourStatementsQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i]!, ...patch };
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };
  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i]!, statements: [...questions[i]!.statements] }); onChange(next); };

  const updateStatement = (qi: number, si: number, value: string) => {
    const base = qi >= questions.length ? empty() : questions[qi]!;
    const padded = padSlots(base.statements);
    padded[si] = value;
    update(qi, { statements: padded });
  };

  return (
    <div>
      {displayQuestions.map((q, i) => {
        const isVirtual = i >= questions.length;
        const slots = padSlots(q.statements);
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
                <label className="be-label">Thema / Frage</label>
                <SpellField segKey={`q${i}.topic`} className="be-input" value={q.topic} placeholder={isVirtual ? 'Neue Frage – einfach hier tippen…' : 'Worüber geht es? (z.B. Gesucht ist ein Erfinder)'} onChange={e => update(i, { topic: e.target.value })} />
              </div>
              {slots.map((stmt, si) => (
                <div key={si}>
                  <label className="be-label">Hinweis {si + 1} {stmt.trim() ? '' : <span style={{ opacity: 0.5, fontWeight: 400 }}>(leer)</span>}</label>
                  <SpellField
                    segKey={`q${i}.statements.${si}`}
                    className="be-input"
                    value={stmt}
                    placeholder={`Hinweis ${si + 1}...`}
                    onChange={e => updateStatement(i, si, e.target.value)}
                  />
                </div>
              ))}
              {!isVirtual && <>
                <div>
                  <label className="be-label">Antwort-Text</label>
                  <SpellField segKey={`q${i}.answer`} className="be-input" value={q.answer ?? ''} placeholder="Lösung als Text..." onChange={e => update(i, { answer: e.target.value || undefined })} />
                </div>
                <div>
                  {(() => {
                    const audioCover = q.answerAudio
                      ? `/images/Audio-Covers/${q.answerAudio.split('/').pop()!.replace(/\.[^.]+$/, '')}.jpg`
                      : null;
                    const linked = audioCover !== null && q.answerImage === audioCover;
                    const isManual = q.answerImage !== undefined && !linked;
                    const extras = audioCover === null || isManual ? null : linked ? (
                      <span className="asset-field-linked" title="Bild ist mit dem Antwort-Audio verknüpft">🔗 Cover-verknüpft</span>
                    ) : (
                      <button
                        type="button"
                        className="be-icon-btn"
                        onClick={e => { e.stopPropagation(); update(i, { answerImage: audioCover }); }}
                        title="Das Cover des Antwort-Audios übernehmen"
                      >🔗 Cover</button>
                    );
                    return (
                      <AssetField
                        label="Antwort-Bild"
                        value={q.answerImage}
                        category="images"
                        onChange={v => update(i, { answerImage: v || undefined })}
                        extras={extras}
                      />
                    );
                  })()}
                </div>
                <div className="audio-field-with-trim">
                  <AssetField
                    label="Antwort-Audio"
                    value={q.answerAudio}
                    category="audio"
                    scope={`q-${i}-answer`}
                    onChange={v => {
                      update(i, { answerAudio: v || undefined, answerAudioStart: undefined, answerAudioEnd: undefined });
                      if (!v) setTrimExpanded(prev => { const n = new Set(prev); n.delete(`${i}-answer`); return n; });
                    }}
                  />
                  <button
                    className={`audio-trim-toggle-btn${trimExpanded.has(`${i}-answer`) ? ' active' : ''}${(q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) ? ' has-trim' : ''}`}
                    onClick={() => toggleTrim(`${i}-answer`)}
                    title={trimExpanded.has(`${i}-answer`) ? 'Trim ausblenden' : 'Trimmen'}
                    style={q.answerAudio ? undefined : { display: 'none' }}
                  >
                    ✂ Trimmen
                  </button>
                  {q.answerAudio && trimExpanded.has(`${i}-answer`) && (
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
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
