import { useState, useEffect } from 'react';
import type { WerKenntMehrQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty as stripTrailingEmptyQuestions } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

/**
 * Free-text editor for the example list. Edits a raw multi-line draft so the
 * user can type anything (spaces, blank lines, press Enter to add a row); the
 * draft is only normalized into the `string[]` (one entry per non-empty line)
 * on blur. Normalizing on every keystroke — as the old inline textarea did —
 * stripped the trailing newline instantly, making it impossible to start a
 * second line. Mirrors the `_players` field pattern in InstanceEditor.
 */
function AnswerListEditor({ value, onChange }: { value: string[]; onChange: (list: string[]) => void }) {
  const stored = value.join('\n');
  const [draft, setDraft] = useState(stored);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(stored); }, [stored, editing]);
  const commit = () => {
    setEditing(false);
    const list = draft.split('\n').map(s => s.trim()).filter(Boolean);
    onChange(list);
  };
  return (
    <textarea
      className="be-textarea"
      rows={Math.max(4, draft.split('\n').length + 1)}
      value={draft}
      placeholder={'Eine Antwort pro Zeile:\nBerlin\nParis\nMadrid\n…'}
      onFocus={() => setEditing(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      style={{ resize: 'vertical', minHeight: 96, fontFamily: 'inherit' }}
    />
  );
}

interface Props {
  questions: WerKenntMehrQuestion[];
  onChange: (questions: WerKenntMehrQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): WerKenntMehrQuestion => ({ question: '' });
const isEmptyQuestion = (q: WerKenntMehrQuestion) =>
  !q.question.trim() &&
  !q.answer?.trim() &&
  !q.info?.trim() &&
  !q.questionImage &&
  (!q.answerList || q.answerList.length === 0) &&
  q.timer === undefined;

export default function WerKenntMehrForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const update = (i: number, patch: Partial<WerKenntMehrQuestion>) => {
    let next: WerKenntMehrQuestion[];
    if (i >= questions.length) {
      const merged = { ...empty(), ...patch };
      (Object.keys(merged) as (keyof WerKenntMehrQuestion)[]).forEach(k => {
        if (merged[k] === undefined) delete merged[k];
      });
      next = [...questions, merged];
    } else {
      next = [...questions];
      next[i] = { ...next[i], ...patch };
      (Object.keys(next[i]) as (keyof WerKenntMehrQuestion)[]).forEach(k => {
        if (next[i][k] === undefined) delete next[i][k];
      });
    }
    onChange(stripTrailingEmptyQuestions(next, isEmptyQuestion));
  };

  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => {
    const next = [...questions];
    next.splice(i + 1, 0, { ...questions[i], answerList: questions[i].answerList ? [...questions[i].answerList!] : undefined });
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
              <label className="be-label">Frage / Aufgabe</label>
              <SpellField segKey={`q${i}.question`} className="be-input" value={q.question} placeholder={isVirtual ? 'Neue Frage – einfach hier tippen…' : 'z.B. Nennt so viele europäische Hauptstädte wie möglich'} onChange={e => update(i, { question: e.target.value })} />
            </div>
            {!isVirtual && (
              <>
                <div className="full-width" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <label className="be-label">Zusatzinfo (über der Frage, optional)</label>
                    <SpellField segKey={`q${i}.info`} className="be-input" value={q.info ?? ''} placeholder="Optionaler Hinweis" onChange={e => update(i, { info: e.target.value || undefined })} />
                  </div>
                  <div style={{ flex: '0 0 140px' }}>
                    <label className="be-label">Timer (Sekunden)</label>
                    <input
                      className="be-input"
                      type="number"
                      value={q.timer ?? ''}
                      placeholder="Kein Timer"
                      onChange={e => update(i, { timer: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    />
                  </div>
                </div>
                <div className="full-width">
                  <AssetField
                    label="Frage-Bild (optional)"
                    value={q.questionImage}
                    category="images"
                    onChange={v => update(i, { questionImage: v })}
                  />
                </div>
                <div className="full-width">
                  <label className="be-label">Einzelne Beispielantwort (optional)</label>
                  <SpellField segKey={`q${i}.answer`} className="be-input" value={q.answer ?? ''} placeholder="z.B. Berlin – für eine einzelne Beispielantwort" onChange={e => update(i, { answer: e.target.value || undefined })} />
                </div>
                <div className="full-width">
                  <label className="be-label">Beispielliste (eine Antwort pro Zeile)</label>
                  <AnswerListEditor
                    value={q.answerList ?? []}
                    onChange={list => update(i, { answerList: list.length > 0 ? list : undefined })}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
