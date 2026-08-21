import { useState } from 'react';
import type { GuessingGameQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import AudioTrimTimeline from '../AudioTrimTimeline';
import { toMediaSrc } from '@/utils/assetUrl';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: GuessingGameQuestion[];
  onChange: (questions: GuessingGameQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): GuessingGameQuestion => ({ question: '', answer: 0 });
const isEmpty = (q: GuessingGameQuestion) =>
  !q.question.trim() && q.answer === 0 && !q.answerImage && !q.questionAudio;

export default function GuessingGameForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  // Which questions have their trim panel open; already-trimmed ones start open.
  const [trimExpanded, setTrimExpanded] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    questions.forEach((q, i) => {
      if (q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined) initial.add(i);
    });
    return initial;
  });

  const toggleTrim = (i: number) =>
    setTrimExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const hasTrim = (q: GuessingGameQuestion) =>
    q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined;

  const update = (i: number, patch: Partial<GuessingGameQuestion>) => {
    let next: GuessingGameQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i]!, ...patch };
    }
    // Drop keys the patch cleared, so a removed trim doesn't linger as `undefined`.
    const target = next[Math.min(i, next.length - 1)]!;
    (Object.keys(target) as (keyof GuessingGameQuestion)[]).forEach(k => {
      if (target[k] === undefined) delete target[k];
    });
    onChange(stripTrailingEmpty(next, isEmpty));
  };
  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i]! }); onChange(next); };

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
            <div>
              <label className="be-label">Frage</label>
              <SpellField segKey={`q${i}.question`} className="be-input" value={q.question} placeholder={isVirtual ? 'Neue Frage – einfach hier tippen…' : 'Was wird geschätzt?'} onChange={e => update(i, { question: e.target.value })} />
            </div>
            <div>
              <label className="be-label">Antwort (Zahl)</label>
              <input className="be-input" type="number" value={q.answer} onChange={e => update(i, { answer: parseFloat(e.target.value) || 0 })} />
            </div>
            {!isVirtual && (
              <div className="full-width">
                <div className="audio-field-with-trim">
                  <AssetField
                    label="Frage-Audio (optional, spielt automatisch)"
                    value={q.questionAudio}
                    category="audio"
                    scope={`q-${i}-question`}
                    onChange={v => {
                      update(i, { questionAudio: v, questionAudioStart: undefined, questionAudioEnd: undefined, questionAudioLoop: undefined });
                      if (v === undefined) setTrimExpanded(prev => { const n = new Set(prev); n.delete(i); return n; });
                    }}
                  />
                  <button
                    className={`audio-trim-toggle-btn${trimExpanded.has(i) ? ' active' : ''}${hasTrim(q) ? ' has-trim' : ''}`}
                    onClick={() => toggleTrim(i)}
                    title={trimExpanded.has(i) ? 'Trim ausblenden' : 'Startpunkt / Ausschnitt wählen'}
                    style={q.questionAudio ? undefined : { display: 'none' }}
                  >
                    ✂ Trimmen
                  </button>
                  {q.questionAudio && trimExpanded.has(i) && (
                    <AudioTrimTimeline
                      src={toMediaSrc(q.questionAudio) ?? q.questionAudio}
                      scope={`q-${i}-question`}
                      start={q.questionAudioStart}
                      end={q.questionAudioEnd}
                      loop={q.questionAudioLoop}
                      onChange={(s, e) => update(i, { questionAudioStart: s, questionAudioEnd: e })}
                      onLoopChange={v => update(i, { questionAudioLoop: v || undefined })}
                    />
                  )}
                </div>
              </div>
            )}
            {!isVirtual && (
              <div className="full-width">
                <AssetField
                  label="Antwort-Bild (optional)"
                  value={q.answerImage}
                  category="images"
                  onChange={v => update(i, { answerImage: v })}
                />
              </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
