import { useEffect, useState } from 'react';
import type { ColorGuessQuestion, ColorSlice } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { ColorPie } from '@/components/games/ColorGuess';
import { fetchColorProfile } from '@/services/backendApi';

interface Props {
  questions: ColorGuessQuestion[];
  onChange: (questions: ColorGuessQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): ColorGuessQuestion => ({ image: '', answer: '' });

function ColorPiePreview({ image, size = 40, onClick }: { image: string; size?: number; onClick?: () => void }) {
  const [colors, setColors] = useState<ColorSlice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!image) { setColors([]); return; }
    setColors(null);
    fetchColorProfile(image)
      .then(c => { if (!cancelled) setColors(c); })
      .catch(() => { if (!cancelled) setColors([]); });
    return () => { cancelled = true; };
  }, [image]);

  const style: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    borderRadius: '50%',
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div style={style} onClick={onClick} title={onClick ? 'Farbverteilung anzeigen' : undefined}>
      {colors === null ? (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>…</span>
      ) : colors.length === 0 ? (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>–</span>
      ) : (
        <ColorPie colors={colors} highlightIdx={null} onHighlight={() => {}} className="color-pie--fit" />
      )}
    </div>
  );
}

function ColorPieModal({ image, answer, onClose }: { image: string; answer: string; onClose: () => void }) {
  const [colors, setColors] = useState<ColorSlice[] | null>(null);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setColors(null);
    setHighlightIdx(null);
    fetchColorProfile(image)
      .then(c => { if (!cancelled) setColors(c); })
      .catch(() => { if (!cancelled) setColors([]); });
    return () => { cancelled = true; };
  }, [image]);

  const highlighted = highlightIdx !== null && colors ? colors[highlightIdx] : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 'min(900px, 92vw)', width: 'min(900px, 92vw)' }}
      >
        <h2 style={{ marginTop: 0 }}>{answer || 'Farbverteilung'}</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 24,
            alignItems: 'center',
            justifyItems: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              maxWidth: 380,
            }}
          >
            <div style={{ width: 'min(360px, 50vh)', aspectRatio: '1 / 1' }}>
              {colors === null ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' }}>Laden …</div>
              ) : (
                <ColorPie colors={colors} highlightIdx={highlightIdx} onHighlight={setHighlightIdx} className="color-pie--fit" />
              )}
            </div>
            <div style={{ minHeight: '1.4em', fontFamily: 'var(--admin-font-mono, monospace)', color: 'rgba(255,255,255,0.8)' }}>
              {highlighted ? `${highlighted.hex} · ${Math.round(highlighted.percent)} %` : 'Hover über ein Segment für den Farbcode'}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', maxWidth: 380 }}>
            {image && (
              <img
                src={image}
                alt={answer}
                style={{
                  maxWidth: '100%',
                  maxHeight: 'min(360px, 50vh)',
                  objectFit: 'contain',
                  borderRadius: 8,
                  padding: 12,
                  // Medium gray so white/light logo regions stay visible without
                  // the visual noise of a transparency-checker pattern.
                  background: '#9a9a9a',
                }}
              />
            )}
          </div>
        </div>
        <div className="be-actions" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="admin-button secondary" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

export default function ColorGuessForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const drag = useDragReorder(questions, onChange);
  const [modalIdx, setModalIdx] = useState<number | null>(null);

  const update = (i: number, patch: Partial<ColorGuessQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof ColorGuessQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
          data-question-index={i}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-row">
            <span className="drag-handle" draggable onDragStart={drag.onDragStart(i)} title="Ziehen zum Sortieren">⠿</span>
            <span className="question-num">{i === 0 ? 'Beispiel' : `#${i}`}</span>
            <div className="question-block-inputs">
              <input
                className="be-input"
                value={q.answer}
                placeholder="Antwort..."
                onChange={e => update(i, { answer: e.target.value })}
              />
            </div>
            {q.image && (
              <ColorPiePreview image={q.image} onClick={() => setModalIdx(i)} />
            )}
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
          </div>

          <div className="question-fields" style={{ marginTop: 8 }}>
            <div>
              <AssetField
                label="Bild"
                value={q.image || undefined}
                category="images"
                onChange={v => update(i, { image: v ?? '' })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
      {modalIdx !== null && questions[modalIdx] && (
        <ColorPieModal
          image={questions[modalIdx].image}
          answer={questions[modalIdx].answer}
          onClose={() => setModalIdx(null)}
        />
      )}
    </div>
  );
}
