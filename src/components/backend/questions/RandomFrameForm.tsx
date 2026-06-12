import type { RandomFrameQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: RandomFrameQuestion[];
  onChange: (questions: RandomFrameQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): RandomFrameQuestion => ({ video: '', answer: '' });
const isEmpty = (q: RandomFrameQuestion) => !q.answer.trim() && !q.video;

const filenameToAnswer = (path: string): string => {
  try {
    const base = decodeURIComponent(path.split('/').pop() ?? '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  } catch {
    return '';
  }
};

export default function RandomFrameForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const update = (i: number, patch: Partial<RandomFrameQuestion>) => {
    let next: RandomFrameQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i], ...patch };
      (Object.keys(next[i]) as (keyof RandomFrameQuestion)[]).forEach(k => {
        if (next[i][k] === undefined) delete next[i][k];
      });
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };

  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  const onVideoChange = (i: number, video: string) => {
    const base = i >= questions.length ? empty() : questions[i];
    const patch: Partial<RandomFrameQuestion> = { video };
    if (video && !base.answer?.trim()) {
      const name = filenameToAnswer(video);
      if (name) patch.answer = name;
    }
    update(i, patch);
  };

  const numField = (i: number, key: 'frameStart' | 'frameEnd', value: string) => {
    const parsed = value ? parseFloat(value) : undefined;
    update(i, { [key]: parsed != null && parsed >= 0 ? parsed : undefined });
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
            <span className="drag-handle" draggable={!isVirtual} onDragStart={isVirtual ? undefined : drag.onDragStart(i)} title="Ziehen zum Sortieren" style={isVirtual ? { visibility: 'hidden' } : undefined}>⠿</span>
            <span className="question-num">{isVirtual ? 'Neu' : i === 0 ? 'Beispiel' : `#${i}`}</span>
            <div className="question-block-inputs">
              <SpellField
                segKey={`q${i}.answer`}
                className="be-input"
                value={q.answer}
                placeholder={isVirtual ? 'Neue Frage – Antwort tippen oder Video wählen…' : 'Antwort (Film)...'}
                onChange={e => update(i, { answer: e.target.value })}
              />
            </div>
            {!isVirtual && <>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(var(--glass-rgb), 0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </>}
          </div>

          <div className="question-fields" style={{ marginTop: 8 }}>
            <div>
              <AssetField
                label="Video"
                value={q.video || undefined}
                category="videos"
                onChange={v => onVideoChange(i, v ?? '')}
              />
            </div>
            {!isVirtual && (
              <>
                <div>
                  <label className="be-label">Frage (optional)</label>
                  <SpellField
                    segKey={`q${i}.question`}
                    className="be-input"
                    value={q.question ?? ''}
                    placeholder="Aus welchem Film stammt dieses Bild?"
                    onChange={e => update(i, { question: e.target.value || undefined })}
                  />
                </div>
                <div>
                  <AssetField
                    label="Antwort-Bild (optional)"
                    value={q.answerImage || undefined}
                    category="images"
                    onChange={v => update(i, { answerImage: v || undefined })}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="be-label">Start (Sek.)</label>
                    <input
                      type="number"
                      min={0}
                      className="be-input"
                      value={q.frameStart ?? ''}
                      placeholder="Standard: 5 % der Länge"
                      onChange={e => numField(i, 'frameStart', e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="be-label">Ende (Sek.)</label>
                    <input
                      type="number"
                      min={1}
                      className="be-input"
                      value={q.frameEnd ?? ''}
                      placeholder="Standard: 92 % der Länge"
                      onChange={e => numField(i, 'frameEnd', e.target.value)}
                    />
                  </div>
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
