import { useCallback, useEffect, useRef, useState } from 'react';
import type { RandomFrameQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';
import { prerenderRandomFrames, getRandomFramePrerenderStatus, randomFramePrerenderKey, type RandomFramePrerenderStatus } from '@/services/backendApi';
import RandomFramePreviewModal from './RandomFramePreviewModal';

/** Normalise a question's stored video path to the rel-path the prerender API keys on. */
const relVideo = (video: string): string => video.replace(/^\/?videos\//, '');

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
      next[i] = { ...next[i]!, ...patch };
      (Object.keys(next[i]!) as (keyof RandomFrameQuestion)[]).forEach(k => {
        if (next[i]![k] === undefined) delete next[i]![k];
      });
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };

  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i]! }); onChange(next); };

  // ── Prerender (download) fallback frames so the show works when the source video is
  // unreachable (NAS-only, not mounted at the live event). 3 variants per question so the
  // GM rotate button still cycles images offline; re-running refills with fresh frames. ──
  const [status, setStatus] = useState<Record<string, RandomFramePrerenderStatus>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  // Which question's downloaded-frames preview is open (null = none).
  const [preview, setPreview] = useState<{ path: string; index: number; count: number; first: number; frameStart?: number; frameEnd?: number } | null>(null);

  // Frames are stored PER QUESTION (keyed by `<path>#<originalIndex>`), so the same movie used
  // in several questions gets its own distinct downloaded frames. `index` is the question's
  // position in the full questions array (before the disabled/video filter), matching the
  // original index the show sends as `qindex`.
  const videoItems = questions
    .map((q, index) => ({ q, index }))
    .filter(({ q }) => !q.disabled && q.video)
    .map(({ q, index }) => ({ path: relVideo(q.video), index, frameStart: q.frameStart, frameEnd: q.frameEnd }));
  const itemKeys = videoItems.map(it => randomFramePrerenderKey(it.path, it.index));

  const refreshStatus = useCallback((keys: string[]) => {
    if (keys.length === 0) { setStatus({}); return; }
    getRandomFramePrerenderStatus(keys).then(setStatus).catch(() => {});
  }, []);

  // Refresh badges on mount + whenever the set of question keys changes.
  const keysKey = itemKeys.join('|');
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;
  useEffect(() => {
    refreshRef.current(keysKey ? keysKey.split('|') : []);
  }, [keysKey]);

  const allReady = itemKeys.length > 0 && itemKeys.every(k => (status[k]?.count ?? 0) > 0);

  const download = async () => {
    if (running || videoItems.length === 0) return;
    setRunning(true);
    setProgress(0);
    setMsg(null);
    let failures = 0;
    try {
      await prerenderRandomFrames(
        videoItems,
        ev => {
          if (typeof ev.percent === 'number') setProgress(ev.percent);
          if (ev.itemError) failures++;
        },
      );
      setMsg(failures > 0 ? `⚠ ${failures} fehlgeschlagen (Video nicht erreichbar?)` : '✅ Bilder heruntergeladen');
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setRunning(false);
      refreshStatus(itemKeys);
    }
  };

  const onVideoChange = (i: number, video: string) => {
    const base = i >= questions.length ? empty() : questions[i]!;
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
      <div className="random-frame-prerender-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(8px, 2vw, 14px)', marginBottom: 14, padding: 'clamp(10px, 2vw, 14px)', borderRadius: 8, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.05)' }}>
        <button
          className="be-btn-primary"
          onClick={download}
          disabled={running || videoItems.length === 0}
          title="Lädt 3 Standbilder pro Frage herunter, damit die Show auch ohne erreichbares Video (NAS) funktioniert"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          {running ? 'Lädt…' : allReady ? 'Bilder neu herunterladen' : 'Bilder herunterladen'}
        </button>
        {running && (
          <div style={{ flex: 1, minWidth: 120, height: 8, borderRadius: 4, background: 'rgba(var(--glass-rgb), 0.15)', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'rgba(34,197,94,0.7)', transition: 'width 0.3s ease' }} />
          </div>
        )}
        {!running && msg && <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.75)' }}>{msg}</span>}
        {!running && !msg && videoItems.length > 0 && (
          <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.6)' }}>
            {itemKeys.filter(k => (status[k]?.count ?? 0) > 0).length}/{itemKeys.length} Fragen vorbereitet
          </span>
        )}
      </div>
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
              {!isVirtual && q.video && (() => {
                const st = status[randomFramePrerenderKey(relVideo(q.video), i)];
                const n = st?.count ?? 0;
                if (n === 0) {
                  return (
                    <span
                      title={'Keine Offline-Standbilder — auf „Bilder herunterladen" klicken'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.45)' }}
                    >— keine Offline-Bilder</span>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => setPreview({ path: relVideo(q.video), index: i, count: n, first: st?.first ?? 0, frameStart: q.frameStart, frameEnd: q.frameEnd })}
                    title="Heruntergeladene Bilder ansehen und auswählen"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.1)', fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(34,197,94,0.9)' }}
                  >✓ {n} Bilder</button>
                );
              })()}
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

      {preview && (
        <RandomFramePreviewModal
          path={preview.path}
          index={preview.index}
          count={preview.count}
          initialFirst={preview.first}
          frameStart={preview.frameStart}
          frameEnd={preview.frameEnd}
          onClose={() => { setPreview(null); refreshStatus(itemKeys); }}
        />
      )}
    </div>
  );
}
