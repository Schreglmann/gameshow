import { useState, useEffect } from 'react';
import type { SimpleQuizQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import StatusMessage from '../StatusMessage';
import AudioTrimTimeline from '../AudioTrimTimeline';
import MoveQuestionButton from './MoveQuestionButton';

interface Props {
  questions: SimpleQuizQuestion[];
  onChange: (questions: SimpleQuizQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): SimpleQuizQuestion => ({ question: '', answer: '' });

const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface ColorEntryProps {
  color: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  onError: (msg: string) => void;
}

function ColorEntry({ color, onChange, onRemove, onError }: ColorEntryProps) {
  const [draft, setDraft] = useState(color);

  // Sync when external value changes (e.g. from native color picker)
  useEffect(() => { setDraft(color); }, [color]);

  const valid = isValidHex(draft);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <label style={{ cursor: 'pointer', flexShrink: 0 }} title="Farbe wählen">
        <div style={{ width: 36, height: 36, borderRadius: 4, background: valid ? draft : '#888888', border: '1px solid rgba(255,255,255,0.2)' }} />
        <input
          type="color"
          value={valid ? draft : '#888888'}
          onChange={e => { setDraft(e.target.value); onChange(e.target.value); }}
          style={{ display: 'none' }}
        />
      </label>
      <input
        className="be-input"
        value={draft}
        placeholder="#000000"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (isValidHex(draft)) {
            onChange(draft);
          } else {
            onError(`Ungültiger Hex-Code "${draft}" – bitte im Format #rrggbb eingeben.`);
            setDraft(color);
          }
        }}
        style={{ width: 90, borderColor: valid ? undefined : 'rgba(var(--error-deep-rgb),0.8)' }}
      />
      <button className="be-icon-btn" onClick={onRemove} title="Farbe entfernen">✕</button>
    </div>
  );
}

interface ColorListProps {
  colors: string[];
  onChange: (colors: string[]) => void;
  onUpdate: (colors: string[]) => void;
  onError: (msg: string) => void;
}

function ColorList({ colors, onChange, onUpdate, onError }: ColorListProps) {
  const drag = useDragReorder(colors, onChange);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
      {colors.map((color, ci) => (
        <div
          key={ci}
          draggable
          onDragStart={drag.onDragStart(ci)}
          onDragOver={drag.onDragOver(ci)}
          onDragEnd={drag.onDragEnd}
          style={{ opacity: drag.overIdx === ci ? 0.5 : 1, cursor: 'grab' }}
        >
          <ColorEntry
            color={color}
            onChange={v => {
              const next = [...colors];
              next[ci] = v;
              onUpdate(next);
            }}
            onRemove={() => {
              const next = colors.filter((_, idx) => idx !== ci);
              onUpdate(next.length > 0 ? next : []);
            }}
            onError={onError}
          />
        </div>
      ))}
      <button
        className="be-icon-btn"
        onClick={() => onUpdate([...colors, '#ff0000'])}
      >+ Farbe</button>
    </div>
  );
}

export default function SimpleQuizForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const [expandedOptional, setExpandedOptional] = useState<Set<number>>(new Set());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Track which questions have their trim panel open; key = "${i}-question" or "${i}-answer"
  const [trimExpanded, setTrimExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    questions.forEach((q, i) => {
      if (q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined) initial.add(`${i}-question`);
      if (q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) initial.add(`${i}-answer`);
    });
    return initial;
  });

  const drag = useDragReorder(questions, onChange);

  const showError = (text: string) => setMessage({ type: 'error', text });

  const update = (i: number, patch: Partial<SimpleQuizQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof SimpleQuizQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  const toggleOptional = (i: number) =>
    setExpandedOptional(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const toggleTrim = (key: string) =>
    setTrimExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const hasOptional = (q: SimpleQuizQuestion) =>
    q.questionImage || q.answerImage || q.questionAudio || q.answerAudio ||
    q.replaceImage || q.timer !== undefined || (q.answerList && q.answerList.length > 0) ||
    (q.questionColors && q.questionColors.length > 0);

  const hasTrim = (q: SimpleQuizQuestion) =>
    q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined ||
    q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined;

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
          {/* Single compact row */}
          <div className="question-block-row">
            <span className="drag-handle" draggable onDragStart={drag.onDragStart(i)} title="Ziehen zum Sortieren">⠿</span>
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
                {q.questionAudio && (
                  <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>
                    🎵Q{(q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined) ? ' ✂' : ''}
                  </span>
                )}
                {q.answerAudio && (
                  <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>
                    🎵A{(q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) ? ' ✂' : ''}
                  </span>
                )}
                {q.timer !== undefined && <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3 }}>⏱{q.timer}s</span>}
                {q.questionColors && q.questionColors.length > 0 && (
                  <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {q.questionColors.map((c, ci) => (
                      <span key={ci} style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 3, background: isValidHex(c) ? c : '#888', border: '1px solid rgba(255,255,255,0.2)' }} title={c} />
                    ))}
                  </span>
                )}
              </div>
            )}
            <button
              className="be-delete-btn"
              style={{
                width: 30, height: 30, borderRadius: 5, border: '1px solid',
                ...(expandedOptional.has(i)
                  ? { background: 'rgba(var(--admin-accent-deep-rgb),0.2)', color: 'var(--admin-accent-light)', borderColor: 'rgba(var(--admin-accent-deep-rgb),0.45)' }
                  : hasOptional(q)
                    ? { background: 'rgba(234,179,8,0.15)', color: '#fde047', borderColor: 'rgba(234,179,8,0.45)' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', borderColor: 'rgba(255,255,255,0.12)' }),
              }}
              onClick={() => toggleOptional(i)}
              title="Optionen"
            ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg></button>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
          </div>

          {/* Optional fields (expanded) */}
          {expandedOptional.has(i) && (
            <div className="question-fields" style={{ marginTop: 8 }}>
              {/* Left column: question fields */}
              <div className="question-fields-col">
                <AssetField
                  label="Frage-Bild"
                  value={q.questionImage}
                  category="images"
                  onChange={v => update(i, { questionImage: v })}
                />
                <div className="audio-field-with-trim">
                  <AssetField
                    label="Frage-Audio"
                    value={q.questionAudio}
                    category="audio"
                    onChange={v => {
                      update(i, { questionAudio: v, questionAudioStart: undefined, questionAudioEnd: undefined });
                      if (v === undefined) setTrimExpanded(prev => { const n = new Set(prev); n.delete(`${i}-question`); return n; });
                    }}
                  />
                  <button
                    className={`audio-trim-toggle-btn${trimExpanded.has(`${i}-question`) ? ' active' : ''}${hasTrim(q) && (q.questionAudioStart !== undefined || q.questionAudioEnd !== undefined) ? ' has-trim' : ''}`}
                    onClick={() => toggleTrim(`${i}-question`)}
                    title={trimExpanded.has(`${i}-question`) ? 'Trim ausblenden' : 'Trimmen'}
                    style={q.questionAudio ? undefined : { visibility: 'hidden' }}
                  >
                    ✂ Trimmen
                  </button>
                  {q.questionAudio && trimExpanded.has(`${i}-question`) && (
                    <AudioTrimTimeline
                      src={q.questionAudio}
                      start={q.questionAudioStart}
                      end={q.questionAudioEnd}
                      loop={q.questionAudioLoop}
                      onChange={(s, e) => update(i, { questionAudioStart: s, questionAudioEnd: e })}
                      onLoopChange={v => update(i, { questionAudioLoop: v || undefined })}
                    />
                  )}
                </div>
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
              </div>

              {/* Right column: answer fields */}
              <div className="question-fields-col">
                <AssetField
                  label="Antwort-Bild"
                  value={q.answerImage}
                  category="images"
                  onChange={v => update(i, { answerImage: v })}
                />
                <div className="audio-field-with-trim">
                  <AssetField
                    label="Antwort-Audio"
                    value={q.answerAudio}
                    category="audio"
                    onChange={v => {
                      update(i, { answerAudio: v, answerAudioStart: undefined, answerAudioEnd: undefined });
                      if (v === undefined) setTrimExpanded(prev => { const n = new Set(prev); n.delete(`${i}-answer`); return n; });
                    }}
                  />
                  <button
                    className={`audio-trim-toggle-btn${trimExpanded.has(`${i}-answer`) ? ' active' : ''}${(q.answerAudioStart !== undefined || q.answerAudioEnd !== undefined) ? ' has-trim' : ''}`}
                    onClick={() => toggleTrim(`${i}-answer`)}
                    title={trimExpanded.has(`${i}-answer`) ? 'Trim ausblenden' : 'Trimmen'}
                    style={q.answerAudio ? undefined : { visibility: 'hidden' }}
                  >
                    ✂ Trimmen
                  </button>
                  {q.answerAudio && trimExpanded.has(`${i}-answer`) && (
                    <AudioTrimTimeline
                      src={q.answerAudio}
                      start={q.answerAudioStart}
                      end={q.answerAudioEnd}
                      loop={q.answerAudioLoop}
                      onChange={(s, e) => update(i, { answerAudioStart: s, answerAudioEnd: e })}
                      onLoopChange={v => update(i, { answerAudioLoop: v || undefined })}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', paddingTop: 24 }}>
                  <label className="be-toggle" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={q.replaceImage ?? false}
                      onChange={e => update(i, { replaceImage: e.target.checked || undefined })}
                    />
                    <span className="be-toggle-track" />
                    <span className="be-toggle-label">Bild ersetzen bei Auflösung</span>
                  </label>
                </div>
              </div>
              <div className="full-width">
                <label className="be-label">Farben (Hex-Code)</label>
                <ColorList
                  colors={q.questionColors ?? []}
                  onChange={colors => update(i, { questionColors: colors.length > 0 ? colors : undefined })}
                  onUpdate={colors => update(i, { questionColors: colors.length > 0 ? colors : undefined })}
                  onError={showError}
                />
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

      <StatusMessage message={message} />
    </div>
  );
}
