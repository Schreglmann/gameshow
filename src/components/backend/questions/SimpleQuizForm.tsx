import { useState } from 'react';
import type { SimpleQuizQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';

interface Props {
  questions: SimpleQuizQuestion[];
  onChange: (questions: SimpleQuizQuestion[]) => void;
}

const empty = (): SimpleQuizQuestion => ({ question: '', answer: '' });

export default function SimpleQuizForm({ questions, onChange }: Props) {
  const [expandedOptional, setExpandedOptional] = useState<Set<number>>(new Set());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);
  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<SimpleQuizQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof SimpleQuizQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };

  const toggleOptional = (i: number) =>
    setExpandedOptional(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const hasOptional = (q: SimpleQuizQuestion) =>
    q.questionImage || q.answerImage || q.questionAudio || q.answerAudio ||
    q.replaceImage || q.timer !== undefined || (q.answerList && q.answerList.length > 0);

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''}`}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          {/* Single compact row */}
          <div className="question-block-row">
            <span className="drag-handle" title="Ziehen zum Sortieren">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div className="question-block-inputs">
              <input
                className="be-input"
                value={q.question}
                placeholder="Frage..."
                onChange={e => update(i, { question: e.target.value })}
              />
              <input
                className="be-input"
                value={q.answer}
                placeholder="Antwort..."
                onChange={e => update(i, { answer: e.target.value })}
              />
            </div>
            {/* Compact badges inline */}
            {!expandedOptional.has(i) && hasOptional(q) && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                {q.questionImage && <img src={q.questionImage} alt="" style={{ height: 59, width: 59, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', cursor: 'pointer' }} title={`Q-Bild: ${q.questionImage}`} onClick={e => { e.stopPropagation(); setPreviewDims(null); setPreviewImage(q.questionImage!); }} />}
                {q.answerImage && <img src={q.answerImage} alt="" style={{ height: 59, width: 59, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', opacity: 0.6, cursor: 'pointer' }} title={`A-Bild: ${q.answerImage}`} onClick={e => { e.stopPropagation(); setPreviewDims(null); setPreviewImage(q.answerImage!); }} />}
                {q.questionAudio && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>🎵Q</span>}
                {q.answerAudio && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>🎵A</span>}
                {q.timer !== undefined && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>⏱{q.timer}s</span>}
              </div>
            )}
            <button
              className="be-icon-btn"
              style={{ fontSize: 11, flexShrink: 0, opacity: expandedOptional.has(i) || hasOptional(q) ? 1 : 0.4 }}
              onClick={() => toggleOptional(i)}
            >
              {expandedOptional.has(i) ? '▲' : '▶'} Opt.
            </button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen">🗑</button>
          </div>

          {/* Optional fields (expanded) */}
          {expandedOptional.has(i) && (
            <div className="question-fields" style={{ marginTop: 8 }}>
              <AssetField
                label="Frage-Bild"
                value={q.questionImage}
                category="images"
                onChange={v => update(i, { questionImage: v })}
              />
              <AssetField
                label="Antwort-Bild"
                value={q.answerImage}
                category="images"
                onChange={v => update(i, { answerImage: v })}
              />
              <AssetField
                label="Frage-Audio"
                value={q.questionAudio}
                category="audio"
                onChange={v => update(i, { questionAudio: v })}
              />
              <AssetField
                label="Antwort-Audio"
                value={q.answerAudio}
                category="audio"
                onChange={v => update(i, { answerAudio: v })}
              />
              <div>
                <label className="be-label">Timer (Sekunden)</label>
                <input
                  className="be-input"
                  type="number"
                  value={q.timer ?? ''}
                  placeholder="Kein Timer"
                  onChange={e => update(i, { timer: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', paddingTop: 18 }}>
                <label className="be-checkbox-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={q.replaceImage ?? false}
                    onChange={e => update(i, { replaceImage: e.target.checked || undefined })}
                  />
                  Bild ersetzen bei Auflösung
                </label>
              </div>
              <div className="full-width">
                <label className="be-label">Mehrzeilige Antwort (eine Zeile pro Abschnitt)</label>
                <textarea
                  className="be-textarea"
                  value={(q.answerList ?? []).join('\n')}
                  placeholder="Jede Zeile wird als eigene Zeile der Antwort angezeigt..."
                  onChange={e => {
                    const list = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                    update(i, { answerList: list.length > 0 ? list : undefined });
                  }}
                />
              </div>
            </div>
          )}

        </div>
      ))}

      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>

      {previewImage && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className="image-lightbox" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">{previewImage.split('/').pop()}</span>
              {previewDims && <span className="image-lightbox-dims">{previewDims.w} × {previewDims.h}px</span>}
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
      )}
    </div>
  );
}
