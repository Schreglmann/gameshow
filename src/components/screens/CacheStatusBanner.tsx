import { useState, useEffect, useRef } from 'react';
import { fetchCacheStatus, warmAllCaches, type MissingCacheEntry, type WarmAllEvent } from '@/services/backendApi';

/**
 * Pre-flight warning shown on HomeScreen: if any video-guess segment caches are missing for
 * the active gameshow, the operator sees a banner + "Jetzt alle generieren"-Button so they
 * can warm everything before starting the show. Non-blocking — the start button still works.
 * See specs/video-caching.md §5 / pre-flight.
 *
 * The banner owns an AbortController so a user-initiated cancel or unmount kills the in-flight
 * SSE stream (and the server's idle-cancel hook then aborts the ffmpeg).
 */
export default function CacheStatusBanner() {
  const [missing, setMissing] = useState<MissingCacheEntry[] | null>(null);
  const [warming, setWarming] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number; current?: MissingCacheEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Initial fetch: what's missing? Silently bail on errors — the banner just doesn't appear.
  useEffect(() => {
    let active = true;
    fetchCacheStatus()
      .then(result => { if (active) setMissing(result.missing); })
      .catch(() => { if (active) setMissing([]); });
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  if (!missing || missing.length === 0) return null;

  const startWarmAll = (e: React.MouseEvent) => {
    // HomeScreen auto-advances on any click after teams are assigned; swallow the click
    // so pressing "Alle generieren" doesn't also navigate to /rules.
    e.stopPropagation();
    if (warming) return;
    setWarming(true);
    setError(null);
    setProgress({ index: 0, total: missing.length, percent: 0 });
    const ac = new AbortController();
    abortRef.current = ac;
    warmAllCaches((ev: WarmAllEvent) => {
      if (ev.error && !ev.done) {
        setError(ev.error);
        return;
      }
      if (ev.done) {
        setWarming(false);
        setProgress(null);
        // If nothing failed, clear the banner; otherwise refresh to show remaining.
        fetchCacheStatus().then(r => setMissing(r.missing)).catch(() => setMissing([]));
        return;
      }
      if (typeof ev.index === 'number' && typeof ev.total === 'number') {
        setProgress({ index: ev.index, total: ev.total, percent: ev.percent ?? 0, current: ev.current });
      }
    }, undefined, ac.signal).catch(err => {
      if (err?.name !== 'AbortError') setError(err.message ?? 'Generierung fehlgeschlagen');
      setWarming(false);
    });
  };

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    abortRef.current?.abort();
    setWarming(false);
    setProgress(null);
  };

  const fmtEntry = (e: MissingCacheEntry) => {
    const label = e.instance ? `${e.game} · ${e.instance}` : e.game;
    return `${label} · Clip ${e.questionIndex}`;
  };

  return (
    <div
      className="cache-preflight-banner"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="cache-preflight-banner__head">
        <span className="cache-preflight-banner__icon" aria-hidden="true">⚠️</span>
        <strong>{missing.length} Video-Cache{missing.length === 1 ? '' : 's'} {missing.length === 1 ? 'fehlt' : 'fehlen'}.</strong>
        <span>Live-Transcoding würde während des Spiels stottern.</span>
      </div>

      {!warming && (
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

      {warming && progress && (
        <div className="cache-preflight-banner__progress">
          <div className="cache-preflight-banner__progress-row">
            <span>
              {progress.current ? fmtEntry(progress.current) : 'Vorbereiten…'}
            </span>
            <span className="cache-preflight-banner__progress-counter">
              {progress.index + 1} / {progress.total}
            </span>
          </div>
          <div className="upload-progress-track">
            <div
              className="upload-progress-fill upload-progress-processing"
              style={{ width: `${progress.percent}%` }}
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
