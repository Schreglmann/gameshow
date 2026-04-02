import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioGuessQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import AudioTrimTimeline from '../AudioTrimTimeline';

interface Props {
  questions: AudioGuessQuestion[];
  onChange: (questions: AudioGuessQuestion[]) => void;
}

const empty = (): AudioGuessQuestion => ({ answer: '', audio: '' });

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioGuessForm({ questions, onChange }: Props) {
  const [trimExpanded, setTrimExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    questions.forEach((q, i) => {
      if (q.audioStart !== undefined || q.audioEnd !== undefined) initial.add(`${i}-short`);
    });
    return initial;
  });

  // Sequential waveform loading: track which indices are visible and which have loaded
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const blockRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  // Determine which waveform should load next: lowest visible index that hasn't loaded yet
  const loadingIndex = (() => {
    const expandedVisible: number[] = [];
    for (const key of trimExpanded) {
      const i = parseInt(key);
      if (!isNaN(i) && visibleIndices.has(i) && !loadedIndices.has(i)) {
        expandedVisible.push(i);
      }
    }
    return expandedVisible.length > 0 ? Math.min(...expandedVisible) : -1;
  })();

  const markLoaded = useCallback((i: number) => {
    setLoadedIndices(prev => new Set(prev).add(i));
  }, []);

  // IntersectionObserver to track which question blocks are in the viewport
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleIndices(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.qIdx);
            if (!isNaN(idx)) {
              if (entry.isIntersecting) next.add(idx); else next.delete(idx);
            }
          }
          return next;
        });
      },
      { rootMargin: '200px' }
    );
    // Observe all currently mounted blocks
    for (const [, el] of blockRefsMap.current) {
      observerRef.current.observe(el);
    }
    return () => observerRef.current?.disconnect();
  }, []);

  const setBlockRef = useCallback((i: number, el: HTMLDivElement | null) => {
    const observer = observerRef.current;
    const prev = blockRefsMap.current.get(i);
    if (prev && observer) observer.unobserve(prev);
    if (el) {
      blockRefsMap.current.set(i, el);
      if (observer) observer.observe(el);
    } else {
      blockRefsMap.current.delete(i);
    }
  }, []);

  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<AudioGuessQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof AudioGuessQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  const toggleTrim = (key: string) =>
    setTrimExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const hasTrim = (q: AudioGuessQuestion) =>
    q.audioStart !== undefined || q.audioEnd !== undefined;

  const canLoad = (i: number) => loadedIndices.has(i) || loadingIndex === i;

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          ref={(el) => setBlockRef(i, el)}
          data-q-idx={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-row">
            <span className="drag-handle" title="Ziehen zum Sortieren">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div className="question-block-inputs">
              <input
                className="be-input"
                value={q.answer}
                placeholder="Antwort (Song - Künstler)..."
                onChange={e => update(i, { answer: e.target.value })}
              />
            </div>
            {/* Compact badges */}
            {q.answerImage && (
              <img src={q.answerImage} alt="" style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', opacity: 0.6, flexShrink: 0 }} title={`Bild: ${q.answerImage}`} />
            )}
            {q.audio && hasTrim(q) && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
                🎵 ✂
              </span>
            )}
            <label className="be-toggle" style={{ flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={q.isExample ?? false}
                onChange={e => update(i, { isExample: e.target.checked || undefined })}
              />
              <span className="be-toggle-track" />
              <span className="be-toggle-label">Beispiel</span>
            </label>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>⧉</button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}>🗑</button>
          </div>

          <div className="question-fields" style={{ marginTop: 8 }}>
            <div className="full-width">
              <div className="audio-field-with-trim">
                <AssetField
                  label="Audio-Datei"
                  value={q.audio || undefined}
                  category="audio"
                  onChange={v => update(i, {
                    audio: v ?? '',
                    audioStart: undefined,
                    audioEnd: undefined,
                  })}
                />

                {/* Short clip trim */}
                <button
                  className={`audio-trim-toggle-btn${trimExpanded.has(`${i}-short`) ? ' active' : ''}${hasTrim(q) ? ' has-trim' : ''}`}
                  onClick={() => toggleTrim(`${i}-short`)}
                  title={trimExpanded.has(`${i}-short`) ? 'Trim ausblenden' : 'Kurzer Ausschnitt trimmen'}
                  style={q.audio ? undefined : { visibility: 'hidden' }}
                >
                  ✂ Ausschnitt
                </button>
                {q.audio && trimExpanded.has(`${i}-short`) && (
                  canLoad(i) ? (
                    <AudioTrimTimeline
                      src={q.audio}
                      start={q.audioStart}
                      end={q.audioEnd}
                      onChange={(s, e) => update(i, { audioStart: s, audioEnd: e })}
                      onLoaded={() => markLoaded(i)}
                    />
                  ) : (
                    <div className="audio-trim-timeline">
                      <div className="audio-trim-waveform-container">
                        <div className="audio-trim-canvas" style={{ background: 'rgba(0,0,0,0.28)' }} />
                        <div className="audio-trim-canvas-loading">Warte auf vorherige Wellenformen…</div>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
            <div>
              <AssetField
                label="Antwort-Bild (optional)"
                value={q.answerImage}
                category="images"
                onChange={v => update(i, { answerImage: v })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
