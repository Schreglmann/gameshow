import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilmStripeQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import SpellField from '../SpellField';
import GmInfoField from './GmInfoField';
import { AssetField } from '../AssetPicker';
import MoveQuestionButton from './MoveQuestionButton';
import { stripTrailingEmpty } from './ghostRow';
import { useConfirm } from '../ConfirmContext';
import FilmStripeBar from '@/components/common/FilmStripeBar';
import { getFilmStripeStatus, prepareFilmStripes, type FilmStripeStatus } from '@/services/backendApi';

/** Normalise a question's stored video path to the rel-path the film-stripe API keys on. */
const relVideo = (video: string): string => video.replace(/^\/?videos\//, '');

interface Props {
  questions: FilmStripeQuestion[];
  onChange: (questions: FilmStripeQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): FilmStripeQuestion => ({ video: '', answer: '' });
const isEmpty = (q: FilmStripeQuestion) => !q.answer.trim() && !q.video && !q.gmInfo?.trim();

const filenameToAnswer = (path: string): string => {
  try {
    const base = decodeURIComponent(path.split('/').pop() ?? '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  } catch {
    return '';
  }
};

/** A stripe that exists and matches the video file as it is now. */
const isUsable = (st: FilmStripeStatus | undefined): boolean => Boolean(st?.ready && st.current);

export default function FilmStripeForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(questions, onChange);
  const displayQuestions = [...questions, empty()];

  const update = (i: number, patch: Partial<FilmStripeQuestion>) => {
    let next: FilmStripeQuestion[];
    if (i >= questions.length) {
      next = [...questions, { ...empty(), ...patch }];
    } else {
      next = [...questions];
      next[i] = { ...next[i]!, ...patch };
      (Object.keys(next[i]!) as (keyof FilmStripeQuestion)[]).forEach(k => {
        if (next[i]![k] === undefined) delete next[i]![k];
      });
    }
    onChange(stripTrailingEmpty(next, isEmpty));
  };

  const remove = async (i: number) => { if (await confirmDialog({ title: 'Frage löschen?' })) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i]! }); onChange(next); };

  // ── Stripes are computed per VIDEO, ahead of the show: a stripe takes minutes
  // (hundreds of seeks into a film that may sit on the NAS), so the show only ever
  // reads the cache. See specs/games/film-stripe.md. ──
  const [status, setStatus] = useState<Record<string, FilmStripeStatus>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFilm, setCurrentFilm] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const videoPaths = [...new Set(questions.filter(q => q.video).map(q => relVideo(q.video)))];

  const refreshStatus = useCallback((paths: string[]) => {
    if (paths.length === 0) { setStatus({}); return; }
    getFilmStripeStatus(paths).then(setStatus).catch(() => {});
  }, []);

  // Refresh on mount and whenever the set of videos changes.
  const pathsKey = videoPaths.join('|');
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;
  useEffect(() => {
    refreshRef.current(pathsKey ? pathsKey.split('|') : []);
  }, [pathsKey]);

  const usableCount = videoPaths.filter(p => isUsable(status[p])).length;
  const allReady = videoPaths.length > 0 && usableCount === videoPaths.length;

  const compute = async () => {
    if (running || videoPaths.length === 0) return;
    setRunning(true);
    setProgress(0);
    setCurrentFilm(null);
    setMsg(null);
    let failures = 0;
    const total = videoPaths.length;
    let finished = 0;
    try {
      await prepareFilmStripes(
        videoPaths,
        ev => {
          if (ev.path !== undefined && typeof ev.percent === 'number') {
            // Progress inside one film: blend it into the batch percentage, so the
            // bar keeps moving during a film that takes minutes.
            setCurrentFilm(filenameToAnswer(ev.path));
            setProgress(Math.round(((finished + ev.percent / 100) / total) * 100));
          }
          if (ev.path !== undefined && (ev.ready || ev.itemError)) finished++;
          if (ev.itemError) failures++;
          if (ev.done) setProgress(100);
        },
        // Everything is current already: the button reads "neu berechnen" and means it.
        allReady,
      );
      setMsg(failures > 0 ? `⚠ ${failures} fehlgeschlagen (Video nicht erreichbar?)` : '✅ Streifen berechnet');
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setRunning(false);
      setCurrentFilm(null);
      refreshStatus(videoPaths);
    }
  };

  const onVideoChange = (i: number, video: string) => {
    const base = i >= questions.length ? empty() : questions[i]!;
    const patch: Partial<FilmStripeQuestion> = { video };
    if (video && !base.answer?.trim()) {
      const name = filenameToAnswer(video);
      if (name) patch.answer = name;
    }
    update(i, patch);
  };

  return (
    <div>
      <div className="film-stripe-prepare-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(8px, 2vw, 14px)', marginBottom: 14, padding: 'clamp(10px, 2vw, 14px)', borderRadius: 8, border: '1px solid rgba(var(--glass-rgb), 0.12)', background: 'rgba(var(--glass-rgb), 0.05)' }}>
        <button
          className="be-btn-primary"
          onClick={compute}
          disabled={running || videoPaths.length === 0}
          title="Berechnet Farbstreifen und Zeitraffer für jeden Film. Dauert pro Film einige Minuten und muss vor der Show erledigt sein."
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="8" y1="5" x2="8" y2="19" /><line x1="13" y1="5" x2="13" y2="19" /><line x1="17" y1="5" x2="17" y2="19" /></svg>
          {running ? 'Berechnet…' : allReady ? 'Streifen neu berechnen' : 'Streifen berechnen'}
        </button>
        {running && (
          <div style={{ flex: 1, minWidth: 120, height: 8, borderRadius: 4, background: 'rgba(var(--glass-rgb), 0.15)', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'rgba(34,197,94,0.7)', transition: 'width 0.3s ease' }} />
          </div>
        )}
        {running && currentFilm && <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.75)' }}>{currentFilm}</span>}
        {!running && msg && <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.75)' }}>{msg}</span>}
        {!running && !msg && videoPaths.length > 0 && (
          <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.6)' }}>
            {usableCount}/{videoPaths.length} Filme vorbereitet
          </span>
        )}
      </div>
      {displayQuestions.map((q, i) => {
        const isVirtual = i >= questions.length;
        const st = q.video ? status[relVideo(q.video)] : undefined;
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
              {!isVirtual && q.video && (
                st?.ready ? (
                  <div style={{ marginTop: 6 }}>
                    <FilmStripeBar colors={st.colors} className="film-stripe-bar--fit" />
                    {!st.current && (
                      <span
                        title="Die Videodatei wurde seit der Berechnung geändert"
                        style={{ display: 'inline-block', marginTop: 4, fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(245,158,11,0.9)' }}
                      >⚠ Streifen veraltet – neu berechnen</span>
                    )}
                  </div>
                ) : (
                  <span
                    title={'Noch kein Farbstreifen — auf „Streifen berechnen" klicken'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.45)' }}
                  >— kein Streifen berechnet{st && !st.sourceReachable ? ' (Video nicht erreichbar)' : ''}</span>
                )
              )}
            </div>
            {!isVirtual && (
              <>
                <div>
                  <label className="be-label">Frage (optional)</label>
                  <SpellField
                    segKey={`q${i}.question`}
                    className="be-input"
                    value={q.question ?? ''}
                    placeholder="Welcher Film ist das?"
                    onChange={e => update(i, { question: e.target.value || undefined })}
                  />
                </div>
                <div>
                  <AssetField
                    label="Antwort-Bild (optional, z. B. Filmplakat)"
                    value={q.answerImage || undefined}
                    category="images"
                    onChange={v => update(i, { answerImage: v || undefined })}
                  />
                </div>
              </>
            )}
            {!isVirtual && <GmInfoField segKey={`q${i}.gmInfo`} value={q.gmInfo} onChange={v => update(i, { gmInfo: v })} />}
          </div>
        </div>
        );
      })}
    </div>
  );
}
