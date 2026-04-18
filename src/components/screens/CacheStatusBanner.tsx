import { useState, useEffect, useRef } from 'react';
import {
  fetchCacheStatus,
  warmAllCaches,
  cancelWarmAllCaches,
  type MissingCacheEntry,
  type WarmAllEvent,
  type SystemStatusResponse,
} from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';

/**
 * Pre-flight warning shown on HomeScreen: if any video-guess segment caches are missing for
 * the active gameshow, the operator sees a banner + "Jetzt alle generieren"-Button so they
 * can warm everything before starting the show. Non-blocking — the start button still works.
 * See specs/video-caching.md §5 / pre-flight.
 *
 * Encodes survive a page reload: the SSE stream is only an observer; the actual work lives
 * in `bgTaskQueue`. After a reload the banner re-attaches via the `system-status` WebSocket
 * and shows progress derived from warmup bg tasks. Cancel hits
 * `POST /api/backend/cache-warm-all/cancel` — client disconnect alone no longer stops work.
 */
export default function CacheStatusBanner() {
  const [missing, setMissing] = useState<MissingCacheEntry[] | null>(null);
  const [localWarming, setLocalWarming] = useState(false);
  const [localProgress, setLocalProgress] = useState<{ index: number; total: number; percent: number; current?: MissingCacheEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Count of active warmup bg tasks + a running-task snapshot pulled from system-status WS.
  // Lets the banner reflect work that started in a previous session (survived a reload).
  const [remoteActive, setRemoteActive] = useState<{ count: number; runningPercent: number | null; runningVideo: string | null } | null>(null);
  const prevRemoteCountRef = useRef(0);

  // Initial fetch: what's missing? Silently bail on errors — the banner just doesn't appear.
  useEffect(() => {
    let active = true;
    fetchCacheStatus()
      .then(result => { if (active) setMissing(result.missing); })
      .catch(() => { if (active) setMissing([]); });
    return () => { active = false; };
  }, []);

  // Observe server-side warmup tasks. If they drain to zero while we thought something was
  // running, refresh cache-status to show the updated missing list (or hide the banner).
  useWsChannel<SystemStatusResponse>('system-status', (status) => {
    let count = 0;
    let runningPercent: number | null = null;
    let runningVideo: string | null = null;
    for (const task of status.processes.backgroundTasks) {
      if (task.type !== 'sdr-warmup' && task.type !== 'compressed-warmup') continue;
      if (task.status !== 'queued' && task.status !== 'running') continue;
      count++;
      if (task.status === 'running' && runningVideo === null) {
        runningVideo = task.meta?.video ?? task.label;
        const m = task.detail?.match(/(\d{1,3})\s*%/);
        runningPercent = m ? parseInt(m[1], 10) : null;
      }
    }
    setRemoteActive(count === 0 ? null : { count, runningPercent, runningVideo });
    // Transition from "had tasks" → "no tasks": refresh missing so the banner reflects the
    // new state (either fewer items missing or the banner hides entirely).
    if (prevRemoteCountRef.current > 0 && count === 0) {
      fetchCacheStatus().then(r => setMissing(r.missing)).catch(() => setMissing([]));
    }
    prevRemoteCountRef.current = count;
  });

  const warming = localWarming || remoteActive !== null;

  // Hide when nothing's missing and nothing's running.
  if ((!missing || missing.length === 0) && !warming) return null;

  const startWarmAll = (e: React.MouseEvent) => {
    // HomeScreen auto-advances on any click after teams are assigned; swallow the click
    // so pressing "Alle generieren" doesn't also navigate to /rules.
    e.stopPropagation();
    if (warming || !missing || missing.length === 0) return;
    setLocalWarming(true);
    setError(null);
    setLocalProgress({ index: 0, total: missing.length, percent: 0 });
    warmAllCaches((ev: WarmAllEvent) => {
      if (ev.error && !ev.done) {
        setError(ev.error);
        return;
      }
      if (ev.done) {
        setLocalWarming(false);
        setLocalProgress(null);
        fetchCacheStatus().then(r => setMissing(r.missing)).catch(() => setMissing([]));
        return;
      }
      if (typeof ev.index === 'number' && typeof ev.total === 'number') {
        setLocalProgress({ index: ev.index, total: ev.total, percent: ev.percent ?? 0, current: ev.current });
      }
    }).catch(err => {
      // The SSE read may error if the server aborts (e.g. via cancel). That's fine — the
      // WS-derived state will take over and refresh missing when tasks drain.
      if (err?.name !== 'AbortError') setError(err.message ?? 'Generierung fehlgeschlagen');
      setLocalWarming(false);
      setLocalProgress(null);
    });
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelWarmAllCaches().catch(() => { /* best effort */ });
    setLocalWarming(false);
    setLocalProgress(null);
  };

  const fmtEntry = (e: MissingCacheEntry) => {
    const label = e.instance ? `${e.game} · ${e.instance}` : e.game;
    return `${label} · Clip ${e.questionIndex}`;
  };

  // Progress display: prefer the local SSE stream (most detailed), fall back to WS snapshot
  // (works after reload when the local stream was never established).
  const displayProgress = (() => {
    if (localProgress) {
      return {
        label: localProgress.current ? fmtEntry(localProgress.current) : 'Vorbereiten…',
        counter: `${localProgress.index + 1} / ${localProgress.total}`,
        percent: localProgress.percent,
      };
    }
    if (remoteActive) {
      const total = Math.max(missing?.length ?? 0, remoteActive.count);
      const label = remoteActive.runningVideo
        ? remoteActive.runningVideo.split('/').pop() ?? 'Generierung läuft…'
        : 'Generierung läuft…';
      return {
        label,
        counter: `${remoteActive.count} / ${total}`,
        percent: remoteActive.runningPercent ?? 0,
      };
    }
    return null;
  })();

  return (
    <div
      className="cache-preflight-banner"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="cache-preflight-banner__head">
        <span className="cache-preflight-banner__icon" aria-hidden="true">⚠️</span>
        <strong>
          {warming
            ? 'Video-Caches werden generiert…'
            : `${missing!.length} Video-Cache${missing!.length === 1 ? '' : 's'} ${missing!.length === 1 ? 'fehlt' : 'fehlen'}.`}
        </strong>
      </div>

      {!warming && missing && missing.length > 0 && (
        <>
          <ul className="cache-preflight-banner__list">
            {missing.slice(0, 5).map((m, i) => (
              <li key={i}>{fmtEntry(m)}</li>
            ))}
            {missing.length > 5 && <li>… und {missing.length - 5} weitere</li>}
          </ul>
          <button
            type="button"
            className="cache-preflight-banner__btn"
            onClick={startWarmAll}
          >
            📦 Jetzt alle generieren ({missing.length})
          </button>
        </>
      )}

      {warming && displayProgress && (
        <div className="cache-preflight-banner__progress">
          <div className="cache-preflight-banner__progress-row">
            <span>{displayProgress.label}</span>
            <span className="cache-preflight-banner__progress-counter">
              {displayProgress.counter}
            </span>
          </div>
          <div className="upload-progress-track">
            <div
              className="upload-progress-fill upload-progress-processing"
              style={{ width: `${displayProgress.percent}%` }}
            />
          </div>
          <button
            type="button"
            className="cache-preflight-banner__btn cache-preflight-banner__btn--cancel"
            onClick={cancel}
          >
            Abbrechen
          </button>
        </div>
      )}

      {error && (
        <div className="cache-preflight-banner__error">Fehler: {error}</div>
      )}
    </div>
  );
}
