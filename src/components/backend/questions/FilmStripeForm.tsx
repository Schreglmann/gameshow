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
import { getFilmStripeStatus, prepareFilmStripes, type FilmStripeStatus, type SystemStatusResponse } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import { formatDuration } from '@/utils/formatDuration';
import { runBatchPercent, runCurrentFilm, runEtaSeconds, runFilmState, type FilmStripeRun } from '@/utils/filmStripeRun';

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
  // The run this form started (fed by the prepare stream) and one started elsewhere — in
  // another browser tab, or by this form before a tab switch unmounted it (fed by the
  // `system-status` channel). The local one wins.
  const [localRun, setLocalRun] = useState<FilmStripeRun | null>(null);
  const [remoteRun, setRemoteRun] = useState<(FilmStripeRun & { taskId: string }) | null>(null);
  /** Errors of the films that failed in the last finished run, shown until the next one. */
  const [lastErrors, setLastErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Task id of the run this form started — its `system-status` copy is not a remote run. */
  const localTaskIdRef = useRef<string | null>(null);

  const videoPaths = [...new Set(questions.filter(q => q.video).map(q => relVideo(q.video)))];
  const videoPathSet = new Set(videoPaths);
  const videoPathSetRef = useRef(videoPathSet);
  videoPathSetRef.current = videoPathSet;

  const refreshStatus = useCallback((paths: string[]) => {
    if (paths.length === 0) { setStatus({}); return; }
    getFilmStripeStatus(paths).then(setStatus).catch(() => {});
  }, []);

  /** Reload the status of single films (a stripe that just finished) into the map. */
  const refreshFilms = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    getFilmStripeStatus(paths).then(s => setStatus(prev => ({ ...prev, ...s }))).catch(() => {});
  }, []);

  // Refresh on mount and whenever the set of videos changes.
  const pathsKey = videoPaths.join('|');
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;
  useEffect(() => {
    refreshRef.current(pathsKey ? pathsKey.split('|') : []);
  }, [pathsKey]);

  useWsChannel<SystemStatusResponse>('system-status', data => {
    const task = data.processes.backgroundTasks.find(t =>
      t.type === 'film-stripe'
      && (t.status === 'running' || t.status === 'queued')
      && t.id !== localTaskIdRef.current
      && t.meta?.filmStripe?.paths.some(p => videoPathSetRef.current.has(p)));
    const meta = task?.meta?.filmStripe;
    setRemoteRun(prev => {
      if (!task || !meta) return null;
      // `runningAt` rather than `elapsed`: a snapshot replayed from the socket cache
      // carries the elapsed time of when it was sent.
      const startedAt = prev?.taskId === task.id
        ? prev.startedAt
        : task.runningAt ?? Date.now() - task.elapsed * 1000;
      return { ...meta, taskId: task.id, startedAt };
    });
  });

  // A remote run reports finished films by count; reload their stripes as they come in,
  // and everything once the run is gone.
  const seenRemoteRef = useRef<{ taskId: string; done: number; paths: string[]; failed: FilmStripeRun['failed'] } | null>(null);
  useEffect(() => {
    const seen = seenRemoteRef.current;
    if (remoteRun) {
      const from = seen?.taskId === remoteRun.taskId ? seen.done : 0;
      if (remoteRun.done > from) {
        const failed = new Set(remoteRun.failed.map(f => f.path));
        refreshFilms(remoteRun.paths.slice(from, remoteRun.done).filter(p => !failed.has(p)));
      }
      seenRemoteRef.current = { taskId: remoteRun.taskId, done: remoteRun.done, paths: remoteRun.paths, failed: remoteRun.failed };
    } else if (seen) {
      seenRemoteRef.current = null;
      setLastErrors(Object.fromEntries(seen.failed.map(f => [f.path, f.error])));
      refreshRef.current(pathsKey ? pathsKey.split('|') : []);
    }
  }, [remoteRun, refreshFilms, pathsKey]);

  const run = localRun ?? remoteRun;
  const running = run !== null;

  // Tick once a second while a run is shown, so the elapsed time and the ETA advance.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const usableCount = videoPaths.filter(p => isUsable(status[p])).length;
  const allReady = videoPaths.length > 0 && usableCount === videoPaths.length;

  const compute = async () => {
    if (running || videoPaths.length === 0) return;
    // Only the films that need work — the count and the ETA then cover real work. When
    // every stripe is current the button reads "neu berechnen" and means all of them.
    const queue = allReady ? videoPaths : videoPaths.filter(p => !isUsable(status[p]));
    if (queue.length === 0) return;
    setLocalRun({ paths: queue, done: 0, failed: [], startedAt: Date.now() });
    setLastErrors({});
    setMsg(null);
    localTaskIdRef.current = null;
    const failed: FilmStripeRun['failed'] = [];
    let finished = false;
    try {
      await prepareFilmStripes(
        queue,
        ev => {
          if (ev.done) finished = true;
          if (ev.taskId) { localTaskIdRef.current = ev.taskId; return; }
          const path = ev.path;
          if (path === undefined) return;
          if (typeof ev.percent === 'number') {
            const percent = ev.percent;
            setLocalRun(r => r && { ...r, current: path, currentPercent: percent });
          }
          if (ev.ready || ev.itemError) {
            if (ev.itemError) failed.push({ path, error: ev.itemError });
            const failedNow = [...failed];
            setLocalRun(r => r && { ...r, done: r.done + 1, current: undefined, currentPercent: undefined, failed: failedNow });
            // Show the new stripe right away instead of after the whole batch.
            if (ev.ready) refreshFilms([path]);
          }
        },
        allReady,
      );
      // A stream that ends without `done` was cut off (server restart, lost connection):
      // the remaining films were never computed.
      setMsg(!finished
        ? '❌ Abgebrochen (Server neu gestartet?) – erneut starten, fertige Filme werden übersprungen'
        : failed.length > 0 ? `⚠ ${failed.length} fehlgeschlagen` : '✅ Streifen berechnet');
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setLastErrors(Object.fromEntries(failed.map(f => [f.path, f.error])));
      setLocalRun(null);
      refreshStatus(videoPaths);
    }
  };

  const currentFilm = run ? runCurrentFilm(run) : null;
  const batchPercent = run ? runBatchPercent(run) : 0;
  const elapsed = run ? formatDuration((now - run.startedAt) / 1000) : null;
  const etaSeconds = run ? runEtaSeconds(run, now) : null;
  const eta = etaSeconds !== null ? formatDuration(etaSeconds) : null;
  const filmNumber = run ? Math.min(run.done + 1, run.paths.length) : 0;

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
        {run && (
          <div style={{ flex: 1, minWidth: 'min(100%, 220px)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              role="progressbar"
              aria-label="Fortschritt Filmstreifen"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={batchPercent}
              style={{ height: 8, borderRadius: 4, background: 'rgba(var(--glass-rgb), 0.15)', overflow: 'hidden' }}
            >
              <div style={{ width: `${batchPercent}%`, height: '100%', background: 'rgba(34,197,94,0.7)', transition: 'width 0.3s ease' }} />
            </div>
            <div data-testid="film-stripe-run-status" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 2, fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.75)' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>Film {filmNumber}/{run.paths.length}</span>
              {currentFilm && (
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {filenameToAnswer(currentFilm)} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{run.currentPercent ?? 0} %</span>
                </span>
              )}
              <span style={{ color: 'rgba(var(--text-rgb), 0.55)', fontVariantNumeric: 'tabular-nums' }}>
                {batchPercent} % gesamt{elapsed && ` · läuft ${elapsed}`}{eta ? ` · noch ca. ${eta}` : ' · Restzeit wird geschätzt…'}
              </span>
              {run.failed.length > 0 && <span style={{ color: 'rgba(245,158,11,0.9)' }}>⚠ {run.failed.length} fehlgeschlagen</span>}
            </div>
          </div>
        )}
        {!running && msg && <span style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(var(--text-rgb), 0.75)' }}>{msg}</span>}
        {!running && videoPaths.length > 0 && (
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
                        title="Die Videodatei wurde seit der Berechnung geändert, oder der Streifen stammt von einem älteren Verfahren"
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
              {!isVirtual && q.video && <FilmRunLine run={run} lastError={lastErrors[relVideo(q.video)]} path={relVideo(q.video)} />}
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

/** One question's part in a stripe run: being computed, queued, or failed. */
function FilmRunLine({ run, path, lastError }: { run: FilmStripeRun | null; path: string; lastError: string | undefined }) {
  const state = run ? runFilmState(run, path) : null;
  const error = state?.kind === 'failed' ? state.error : !run ? lastError : undefined;
  const lineStyle = { display: 'block', marginTop: 4, fontSize: 'var(--admin-sz-12, 12px)' } as const;
  if (error) {
    return <span style={{ ...lineStyle, color: 'rgba(245,158,11,0.9)' }}>⚠ Streifen fehlgeschlagen: {error}</span>;
  }
  if (state?.kind === 'current') {
    return (
      <div style={{ marginTop: 6 }}>
        <span style={{ ...lineStyle, marginTop: 0, color: 'rgba(var(--text-rgb), 0.75)', fontVariantNumeric: 'tabular-nums' }}>⏳ wird berechnet · {state.percent} %</span>
        <div className="upload-progress-track" style={{ height: 4, marginTop: 4 }}>
          <div className="upload-progress-fill upload-progress-processing" style={{ width: `${state.percent}%`, transition: 'width 0.3s ease-out' }} />
        </div>
      </div>
    );
  }
  if (state?.kind === 'queued') {
    return <span style={{ ...lineStyle, color: 'rgba(var(--text-rgb), 0.5)' }}>in Warteschlange</span>;
  }
  return null;
}
