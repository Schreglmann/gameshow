import { useState } from 'react';
import type { FactOrFakeQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';

interface Props {
  questions: FactOrFakeQuestion[];
  onChange: (questions: FactOrFakeQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): FactOrFakeQuestion => ({ statement: '', isFact: true, description: '' });
const isEmpty = (q: FactOrFakeQuestion) =>
  !q.statement.trim() && !q.description.trim() && !q.questionImage && !q.answerImage;

const hasOptional = (q: FactOrFakeQuestion) =>
  Boolean(q.questionImage || q.answerImage);

export default function FactOrFakeForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const [expandedOptional, setExpandedOptional] = useState<Set<number>>(new Set());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);

  const update = (i: number, patch: Partial<FactOrFakeQuestion>) => {
    let next: FactOrFakeQuestion[];
    if (i >= questions.length) {
      const merged = { ...empty(), ...patch };
      (Object.keys(merged) as (keyof FactOrFakeQuestion)[]).forEach(k => {
        if (merged[k] === undefined) delete merged[k];
      });
      next = [...questions, merged];
    } else {
      next = [...questions];
      next[i] = { ...next[i], ...patch };
      (Object.keys(next[i]) as (keyof FactOrFakeQuestion)[]).forEach(k => {
        if (next[i][k] === undefined) delete next[i][k];
      });
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };
  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };
  const toggleOptional = (i: number) =>
    setExpandedOptional(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

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
            <div className="question-block-inputs">
              <SpellField
                segKey={`q${i}.statement`}
                className="be-input"
                value={q.statement}
                placeholder={isVirtual ? 'Neue Aussage – einfach hier tippen…' : 'Aussage...'}
                onChange={e => update(i, { statement: e.target.value })}
              />
              {!isVirtual && (
                <SpellField
                  segKey={`q${i}.description`}
                  className="be-input"
                  value={q.description}
                  placeholder="Beschreibung (nach Auflösung)..."
                  onChange={e => update(i, { description: e.target.value })}
                />
              )}
            </div>
            {/* Inline thumbnail badges (when not expanded) */}
            {!isVirtual && !expandedOptional.has(i) && hasOptional(q) && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                {q.questionImage && <img src={q.questionImage} alt="" style={{ height: 59, width: 59, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(0,0,0,0.3)', cursor: 'pointer' }} title={`Q-Bild: ${q.questionImage}`} onClick={e => { e.stopPropagation(); setPreviewDims(null); setPreviewImage(q.questionImage!); }} />}
                {q.answerImage && <img src={q.answerImage} alt="" style={{ height: 59, width: 59, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(0,0,0,0.3)', opacity: 0.6, cursor: 'pointer' }} title={`A-Bild: ${q.answerImage}`} onClick={e => { e.stopPropagation(); setPreviewDims(null); setPreviewImage(q.answerImage!); }} />}
              </div>
            )}
            {!isVirtual && <>
            {/* Options toggle (expand image fields) */}
            <button
              className="be-delete-btn"
              style={{
                width: 30, height: 30, borderRadius: 5, border: '1px solid',
                ...(expandedOptional.has(i)
                  ? { background: 'rgba(var(--admin-accent-deep-rgb),0.2)', color: 'var(--admin-accent-light)', borderColor: 'rgba(var(--admin-accent-deep-rgb), max(0.45, var(--text-fade-floor, 0)))' }
                  : hasOptional(q)
                    ? { background: 'rgba(234,179,8,0.15)', color: '#fde047', borderColor: 'rgba(234,179,8,0.45)' }
                    : { background: 'rgba(var(--glass-rgb), 0.06)', color: 'rgba(var(--text-rgb), max(0.45, var(--text-fade-floor, 0)))', borderColor: 'rgba(255,255,255,0.12)' }),
              }}
              onClick={() => toggleOptional(i)}
              title="Bilder"
            ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg></button>
            {/* Fakt/Fake toggle inline in header */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="be-icon-btn"
                style={{ background: (q.isFact ?? true) ? 'rgba(var(--success-rgb),0.25)' : 'transparent', color: (q.isFact ?? true) ? 'var(--success)' : 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))', borderColor: (q.isFact ?? true) ? 'rgba(var(--success-rgb), max(0.5, var(--text-fade-floor, 0)))' : 'rgba(var(--glass-rgb),0.15)' }}
                onClick={() => update(i, { isFact: true, answer: 'FAKT' })}
              >FAKT</button>
              <button
                className="be-icon-btn"
                style={{ background: !(q.isFact ?? true) ? 'rgba(var(--error-deep-rgb),0.25)' : 'transparent', color: !(q.isFact ?? true) ? 'var(--error-lighter)' : 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))', borderColor: !(q.isFact ?? true) ? 'rgba(var(--error-deep-rgb), max(0.5, var(--text-fade-floor, 0)))' : 'rgba(var(--glass-rgb),0.15)' }}
                onClick={() => update(i, { isFact: false, answer: 'FAKE' })}
              >FAKE</button>
            </div>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(var(--glass-rgb), 0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.06)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
            </>}
          </div>

          {/* Optional fields (expanded): question + answer image */}
          {!isVirtual && expandedOptional.has(i) && (
            <div className="question-fields" style={{ marginTop: 8 }}>
              <div className="question-fields-col">
                <AssetField
                  label="Frage-Bild (optional)"
                  value={q.questionImage}
                  category="images"
                  onChange={v => update(i, { questionImage: v })}
                />
              </div>
              <div className="question-fields-col">
                <AssetField
                  label="Antwort-Bild (optional)"
                  value={q.answerImage}
                  category="images"
                  onChange={v => update(i, { answerImage: v })}
                />
              </div>
            </div>
          )}
        </div>
        );
      })}

      {previewImage && (() => {
        const isSvg = previewImage.toLowerCase().endsWith('.svg');
        return (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className={`image-lightbox${isSvg ? ' image-lightbox--svg' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">{previewImage.split('/').pop()}</span>
              {previewDims && !isSvg && <span className="image-lightbox-dims">{previewDims.w} × {previewDims.h}px</span>}
              <button className="be-icon-btn" onClick={() => setPreviewImage(null)}>✕</button>
            </div>
            <div className="image-lightbox-body">
              <img
                src={previewImage}
                alt=""
                onLoad={e => {
                  const img = e.target as HTMLImageElement;
                  setPreviewDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
