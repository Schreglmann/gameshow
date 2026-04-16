/**
 * Per-video Whisper transcription controls — rendered inside the AssetsTab video detail modal.
 *
 * State flow:
 *  1. On mount: fetch /whisper/health (gates the Start button) + /whisper/status?path=<rel>
 *     to seed the job state.
 *  2. While open: subscribe to `system-status` WebSocket and pull the matching whisper-asr
 *     backgroundTask for live percent updates. The subscription is the only mechanism for
 *     real-time UI updates — there is no client-side timer.
 *  3. On reload: the server holds authoritative state, so re-mounting just re-fetches.
 *
 * The panel does not own any persistent state beyond the in-flight job snapshot it shows.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  fetchWhisperHealth, fetchWhisperStatus, startWhisperJob, pauseWhisperJob, resumeWhisperJob, stopWhisperJob,
  type WhisperJob, type WhisperLanguage, type WhisperHealth, type SystemStatusResponse,
} from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';

// Map the backend's slug convention exactly. Mirrors `cacheSlug` in server/index.ts:
//   relPath.replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '_')
// Then whisper-jobs strips the trailing extension and appends `__<lang>`.
function expectedTaskLabelSuffix(videoRelPath: string): string {
  // backgroundTask.label is `Whisper: <basename> (<LANG>)` — match on basename + lang
  const basename = videoRelPath.split('/').pop() || videoRelPath;
  return basename;
}

/** Compact human-readable duration in German: "2h 14m", "8m 30s", "45s". Negative or
 *  non-finite inputs render as "–". */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Estimated time-to-completion for the current phase (extraction or transcription),
 *  extrapolated linearly from elapsed phase runtime and percent. Returns null when there's
 *  no usable signal yet (percent === 0) or when we're complete (percent === 100). For
 *  paused jobs we anchor "now" at `updatedAt` so the countdown freezes instead of
 *  artificially shrinking while paused.
 *
 *  Note: this is per-phase, NOT overall. After extraction completes the panel resets the
 *  bar and ETA — that's the right UX because extraction (~1 min) and transcription
 *  (~15-25 min) have wildly different time scales, and conflating them produced wrong
 *  estimates while the bar was still measuring the fast phase. */
function computeEtaSeconds(job: WhisperJob): number | null {
  if (job.percent <= 0 || job.percent >= 100) return null;
  const referenceTime = job.status === 'running' ? Date.now() : job.updatedAt;
  const phaseStart = job.phaseStartedAt || job.startedAt;
  const elapsed = (referenceTime - phaseStart) / 1000;
  if (elapsed <= 0) return null;
  const totalEstimated = elapsed / (job.percent / 100);
  return Math.max(0, totalEstimated - elapsed);
}

interface Props {
  videoRelPath: string;
}

export default function VideoTranscriptionPanel({ videoRelPath }: Props) {
  const [job, setJob] = useState<WhisperJob | null>(null);
  const [health, setHealth] = useState<WhisperHealth | null>(null);
  const [language, setLanguage] = useState<WhisperLanguage>('en');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Initial fetch — runs whenever the modal opens for a different video
  useEffect(() => {
    let cancelled = false;
    setActionError(null);
    Promise.all([fetchWhisperHealth(), fetchWhisperStatus(videoRelPath)])
      .then(([h, j]) => {
        if (cancelled) return;
        setHealth(h);
        setJob(j);
        if (j) setLanguage(j.language);
      })
      .catch(() => { if (!cancelled) { setHealth({ ok: false, binPath: null, modelPath: null, reason: 'Status konnte nicht geladen werden' }); } });
    return () => { cancelled = true; };
  }, [videoRelPath]);

  const refresh = useCallback(async () => {
    try { setJob(await fetchWhisperStatus(videoRelPath)); } catch { /* ignore */ }
  }, [videoRelPath]);

  // Live progress: the server publishes whisper progress as backgroundTasks on the
  // existing system-status channel. The bgTask detail line encodes the phase too:
  //   "Audio extrahieren · 42 %"    → phase=extracting
  //   "42 %"                         → phase=transcribing
  //   "Pausiert · 42 %"              → phase=transcribing (paused)
  // We parse both so the panel stays in sync across the phase boundary without waiting
  // for the next refresh — otherwise the bar would briefly look like it regressed (99 %
  // extraction → 0 % transcription) before the client caught up.
  const onSystemStatus = useCallback((status: SystemStatusResponse) => {
    if (!job || (job.status !== 'running' && job.status !== 'paused')) return;
    const wantedSuffix = expectedTaskLabelSuffix(videoRelPath);
    const task = status.processes.backgroundTasks.find(
      t => t.type === 'whisper-asr' && t.label.includes(wantedSuffix),
    );
    if (!task) return;
    const detail = task.detail || '';
    const m = /(\d+)\s*%/.exec(detail);
    if (!m) return;
    const pct = parseInt(m[1], 10);
    if (!Number.isFinite(pct)) return;
    const phase: 'extracting' | 'transcribing' = /extrahieren/i.test(detail) ? 'extracting' : 'transcribing';
    if (pct === job.percent && phase === job.phase) return;
    // Phase transition (extracting → transcribing) — refresh from server so we get the
    // authoritative `phaseStartedAt` for ETA, instead of guessing it client-side.
    if (phase !== job.phase) { void refresh(); return; }
    setJob(prev => prev ? { ...prev, percent: pct } : prev);
  }, [job, videoRelPath, refresh]);
  useWsChannel<SystemStatusResponse>('system-status', onSystemStatus);

  async function runAction(fn: () => Promise<WhisperJob>) {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await fn();
      setJob(updated);
    } catch (err) {
      setActionError((err as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // Poll the server every 5 seconds while the job is active (running or paused). This
  // catches lifecycle transitions (extraction→transcription, running→done, running→error)
  // that don't flow through the system-status WebSocket — that channel only carries the
  // backgroundTask progress percent, not the job's status field. Without this, the panel
  // would stay stuck on "running" after the job completes until the user reloads.
  // The WebSocket still drives instant percent updates between polls; the poll handles the
  // "phase/status changed" events that WS doesn't convey.
  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'paused' && job.status !== 'pending')) return;
    // Immediate refresh 1s after start (catches the fast pending→running transition)
    const initial = setTimeout(() => { void refresh(); }, 1000);
    // Then every 5s for lifecycle changes
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [job?.status, refresh]);

  // Tick once per second while running so the elapsed-time / ETA display advances even
  // between WebSocket pushes (whisper.cpp emits progress every few seconds, but the user
  // expects the seconds counter to look continuous). Paused jobs don't tick — their ETA
  // is anchored to `updatedAt` and shouldn't change until resume.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (job?.status !== 'running') return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [job?.status]);

  // ── Render ──

  // Setup not done yet — show install hint instead of the Start button
  if (health && !health.ok) {
    return (
      <div style={panelStyle}>
        <div style={panelTitleStyle}>📝 Transkription (Whisper)</div>
        <div style={{ color: 'rgba(251,191,36,0.95)', fontSize: 12 }}>
          ⚠ {health.reason || 'Whisper ist nicht eingerichtet'}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
          npm run whisper:install
        </div>
      </div>
    );
  }

  // No-job (initial) is rendered as the "ready to start" state; once a job exists, its
  // actual status drives the UI — a literal 'pending' from the server now means "queued
  // behind another running job", distinct from "never started".
  const noJob = job === null;
  const status = job?.status ?? 'idle';
  const percent = job?.percent ?? 0;

  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>📝 Transkription (Whisper)</div>

      {actionError && (
        <div style={{ color: 'rgba(248,113,113,0.95)', fontSize: 12, marginBottom: 6 }}>
          Fehler: {actionError}
        </div>
      )}

      {/* Queued behind another running job */}
      {status === 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'rgba(251,191,36,0.95)', fontSize: 12 }}>
            ⏳ In Warteschlange · wartet auf freien Slot
          </span>
          <button className="be-icon-btn" disabled={busy} onClick={() => runAction(() => stopWhisperJob(videoRelPath))}>
            ⏹ Abbrechen
          </button>
        </div>
      )}

      {/* No job yet, or stopped/error/interrupted/done — show the start controls */}
      {(noJob || status === 'idle' || status === 'error' || status === 'interrupted' || status === 'done') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {status === 'done' && (
            <span style={{ color: 'rgba(74,222,128,0.95)', fontSize: 12 }}>
              ✓ Fertig — Transkript verfügbar
            </span>
          )}
          {status === 'interrupted' && (
            <span style={{ color: 'rgba(251,191,36,0.95)', fontSize: 12 }}>
              ⚠ Unterbrochen (Node-Neustart). Erneut starten, um die Transkription neu zu beginnen.
            </span>
          )}
          {status === 'error' && job?.error && (
            <span style={{ color: 'rgba(248,113,113,0.95)', fontSize: 12 }}>
              ✗ {job.error}
            </span>
          )}
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Sprache:</span>
          <select
            className="be-input"
            style={{ width: 140, fontSize: 12, padding: '3px 6px' }}
            value={language}
            onChange={e => setLanguage(e.target.value as WhisperLanguage)}
            disabled={busy}
          >
            <option value="en">Englisch (Original)</option>
            <option value="de">Deutsch (Synchron)</option>
          </select>
          <button
            className="be-btn-primary"
            disabled={busy}
            onClick={() => runAction(() => startWhisperJob(videoRelPath, language))}
          >
            {status === 'done' ? '🔁 Erneut transkribieren' : status === 'interrupted' ? '🔄 Neu starten' : status === 'error' ? '🔄 Erneut versuchen' : '🎙 Transkribieren'}
          </button>
          {status === 'done' && job?.transcriptPath && (
            <a
              href={`/api/backend/assets/videos/whisper/transcript?path=${encodeURIComponent(videoRelPath)}`}
              target="_blank"
              rel="noreferrer"
              className="be-icon-btn"
              style={{ fontSize: 12, textDecoration: 'none' }}
            >
              📄 Transkript öffnen
            </a>
          )}
        </div>
      )}

      {/* Running or paused — show progress + ETA + action buttons */}
      {(status === 'running' || status === 'paused') && job && (() => {
        const etaSec = computeEtaSeconds(job);
        const elapsedSec = ((status === 'running' ? Date.now() : job.updatedAt) - job.startedAt) / 1000;
        // Phase-aware labels. Extraction is fast (~1 min) and transcription is slow
        // (~15-25 min); we surface which step is active so the bar's pace is interpretable.
        const phaseLabel = job.phase === 'extracting' ? 'Audio extrahieren' : 'Whisper-Transkription';
        const rightLabel =
          etaSec === null ? `${percent} %` :
          status === 'running' ? `${percent} % · noch ~${formatDuration(etaSec)}` :
          `${percent} % · noch ~${formatDuration(etaSec)} (pausiert)`;
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
              <span>
                {status === 'running' ? '⏳' : '⏸'} {phaseLabel} · Sprache: {job.language === 'en' ? 'Englisch' : 'Deutsch'}
                {' · '}{formatDuration(elapsedSec)} gelaufen
                {job.pid ? ` · PID ${job.pid}` : ''}
              </span>
              <span style={{ fontFamily: 'monospace' }}>{rightLabel}</span>
            </div>
            <div className="upload-progress-track">
              {/* Deliberately NOT adding `upload-progress-processing`. That class layers
               *  a continuous shimmering gradient animation on top of the base 2s width
               *  transition, which reads as constant flashing on a job that only updates
               *  the percent every few seconds. The "Läuft" header + live ETA already
               *  convey activity; a plain solid bar with a short transition is calmer.
               *  Inline `transition` overrides the base-class 2s rule for this specific bar. */}
              <div
                className="upload-progress-fill"
                style={{ width: `${percent}%`, transition: 'width 0.3s ease-out' }}
              />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              {status === 'running' && (
                <button className="be-icon-btn" disabled={busy} onClick={() => runAction(() => pauseWhisperJob(videoRelPath))}>⏸ Pausieren</button>
              )}
              {status === 'paused' && (
                <button className="be-icon-btn" disabled={busy} onClick={() => runAction(() => resumeWhisperJob(videoRelPath))}>▶ Fortsetzen</button>
              )}
              <button className="be-icon-btn" disabled={busy} onClick={() => runAction(() => stopWhisperJob(videoRelPath))}>⏹ Stoppen</button>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
              Läuft im Hintergrund weiter, auch wenn der Tab geschlossen oder der Node-Server neu gestartet wird.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: 'rgba(129, 140, 248, 0.08)',
  borderTop: '1px solid rgba(129, 140, 248, 0.25)',
  fontSize: 12,
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'rgba(255, 255, 255, 0.6)',
  marginBottom: 8,
};
