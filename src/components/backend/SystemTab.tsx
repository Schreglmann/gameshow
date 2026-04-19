import { useState, useEffect, useRef } from 'react';
import { fetchWarmPreview, warmAllVideoCaches, fetchCacheStatus, warmAllCaches, clearAllCaches, type SystemStatusResponse, type WarmPreviewVideo } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import InstallButton from '@/components/common/InstallButton';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const CATEGORY_LABELS: Record<string, string> = {
  images: 'Bilder',
  audio: 'Audio',
  'background-music': 'Hintergrundmusik',
  videos: 'Videos',
  'audio-guess': 'Audio-Guess',
};

function StatusDot({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? 'var(--success)' : 'var(--error-light)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>;
}

// ── Unified job list (Aktive Prozesse) ──

export type BgTaskEntry = SystemStatusResponse['processes']['backgroundTasks'][number];
export type YtEntry = SystemStatusResponse['processes']['ytDownloads'][number];
export type WhisperEntry = NonNullable<SystemStatusResponse['processes']['whisperJobs']>[number];

export type UnifiedJob =
  | { key: string; source: 'bgTask'; task: BgTaskEntry }
  | { key: string; source: 'yt'; dl: YtEntry }
  | { key: string; source: 'whisper'; job: WhisperEntry };

/** Map every job type to a visual prefix (icon + German label). Keeps the System
 *  tab's row titles consistent and scannable. */
function prefixForBgTask(type: string): string {
  switch (type) {
    case 'sdr-warmup':
    case 'compressed-warmup': return '🎬 Video-Cache:';
    case 'nas-sync':          return '🔄 NAS-Sync:';
    case 'startup-sync':      return '🔃 NAS-Initial-Sync:';
    case 'nas-mirror':        return '🔄 NAS-Spiegel:';
    case 'audio-normalize':   return '🔊 Audio-Normalisierung:';
    case 'poster-fetch':      return '🖼️ Poster:';
    case 'hdr-probe':         return '📊 HDR-Probe:';
    case 'faststart':         return '⚡ Faststart:';
    case 'whisper-asr':       return '🎙️ Whisper:';
    default:                   return '⚙️';
  }
}

/** Pull a `nn %` percent out of the free-form detail string (e.g. "42 %",
 *  "Audio extrahieren · 42 %"). Returns `null` if no percent is present. */
function parseDetailPercent(detail: string | undefined): number | null {
  if (!detail) return null;
  const m = detail.match(/(\d{1,3})\s*%/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 0 && n <= 100 ? n : null;
}

/** Format seconds as a compact ETA string (e.g. `3m 20s`, `45s`, `1h 12m`).
 *  Returns null when seconds is ≤0 or not finite. */
function formatEta(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** ETA from linear extrapolation: elapsed seconds at `percent` →
 *  remaining = elapsed × (100 / percent − 1). Only meaningful once percent
 *  is well above zero, otherwise the estimate is wildly unreliable. */
function computeEta(elapsed: number, percent: number): string | null {
  if (percent <= 2 || percent >= 100 || elapsed <= 0) return null;
  const remaining = elapsed * (100 / percent - 1);
  return formatEta(remaining);
}

/** Strip the `{label}: …` prefix from a bgTask label so the row can prepend a
 *  standardised icon+prefix. Preserves anything that doesn't look prefixed. */
function stripLegacyPrefix(label: string): string {
  const colon = label.indexOf(':');
  if (colon < 0 || colon > 40) return label;
  return label.slice(colon + 1).trim();
}

/** Renders a progress bar — determinate when `percent` is a real number,
 *  indeterminate (barber-pole shimmer) otherwise. Kept inline so JobRow stays
 *  a single place to update visuals. */
function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div className="upload-progress-track" style={{ height: 4 }}>
      {percent === null ? (
        <div key="indeterminate" className="upload-progress-fill upload-progress-indeterminate" />
      ) : (
        <div key="determinate" className="upload-progress-fill upload-progress-processing" style={{ width: `${percent}%`, transition: 'width 0.3s ease-out' }} />
      )}
    </div>
  );
}

export function JobRow({ job }: { job: UnifiedJob }) {
  if (job.source === 'yt') {
    const dl = job.dl;
    const title = dl.title || dl.id;
    const elapsed = dl.elapsed ?? 0;
    const eta = computeEta(elapsed, dl.percent);
    const detailParts: string[] = [`${dl.percent}%`];
    if (dl.phase) detailParts.push(dl.phase);
    if (dl.playlistTotal != null) detailParts.push(`Playlist ${dl.playlistDone ?? 0}/${dl.playlistTotal}`);
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(var(--glass-rgb),0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, gap: 8 }}>
          <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb),0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            ⬇️ YouTube: {title}
          </span>
          <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(var(--text-rgb),0.35)', fontFamily: 'monospace', flexShrink: 0 }}>
            {detailParts.join(' · ')}
            {elapsed > 0 && ` · ${elapsed}s`}
            {eta && ` · noch ${eta}`}
          </span>
        </div>
        <ProgressBar percent={dl.percent > 0 ? dl.percent : null} />
      </div>
    );
  }

  if (job.source === 'whisper') {
    const j = job.job;
    const basename = j.video.split('/').pop() ?? j.video;
    const isRunning = j.status === 'running' || j.status === 'paused';
    const phaseLabel = j.phase === 'extracting' ? 'Audio extrahieren' : 'Transkribieren';
    const isQueued = j.status === 'pending';
    const eta = isRunning ? computeEta(j.elapsed, j.percent) : null;
    const statusLabel =
      j.status === 'running' ? `${phaseLabel} · ${j.percent} %` :
      j.status === 'paused' ? `Pausiert · ${j.percent} %` :
      j.status === 'pending' ? 'In Warteschlange' :
      j.status === 'interrupted' ? 'Unterbrochen (Node-Neustart)' :
      j.status === 'error' ? (j.error ? j.error.slice(0, 100) : 'Fehler') :
      j.status === 'done' ? '✓ Fertig' :
      j.status;
    const statusColor =
      j.status === 'error' ? 'rgba(var(--error-deep-rgb),0.8)' :
      j.status === 'pending' ? 'rgba(var(--gold-warm-rgb),0.8)' :
      j.status === 'interrupted' ? 'rgba(var(--gold-warm-rgb),0.8)' :
      'rgba(var(--text-rgb),0.5)';
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(var(--glass-rgb),0.04)', opacity: isQueued ? 0.55 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isRunning ? 4 : 0, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <StatusDot ok={j.status !== 'error'} />
            <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb),0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🎙️ Whisper: {basename} ({j.language.toUpperCase()})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: statusColor }}>{statusLabel}</span>
            {isRunning && (
              <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(var(--text-rgb),0.25)', fontFamily: 'monospace' }}>
                {j.elapsed}s{eta && ` · noch ${eta}`}
              </span>
            )}
          </div>
        </div>
        {isRunning && <ProgressBar percent={j.percent > 0 ? j.percent : null} />}
      </div>
    );
  }

  // source === 'bgTask'
  const task = job.task;
  const prefix = prefixForBgTask(task.type);
  const tail = stripLegacyPrefix(task.label);
  const percent = parseDetailPercent(task.detail);
  const isQueued = task.status === 'queued';
  const isRunning = task.status === 'running';
  const isDone = task.status === 'done';
  const isError = task.status === 'error';
  const eta = isRunning && percent !== null ? computeEta(task.elapsed, percent) : null;
  const statusLabel =
    isQueued ? 'In Warteschlange' :
    isError ? (task.detail?.slice(0, 100) ?? 'Fehler') :
    isDone ? '✓ Fertig' :
    task.detail ?? '';
  const statusColor =
    isError ? 'rgba(var(--error-deep-rgb),0.8)' :
    isQueued ? 'rgba(var(--gold-warm-rgb),0.8)' :
    'rgba(var(--text-rgb),0.35)';
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(var(--glass-rgb),0.04)', opacity: isQueued ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isRunning ? 4 : 0, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <StatusDot ok={!isError} />
          <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb),0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {prefix} {tail}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {statusLabel && (
            <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: statusColor }}>{statusLabel}</span>
          )}
          {isRunning && (
            <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(var(--text-rgb),0.25)', fontFamily: 'monospace' }}>
              {task.elapsed}s{eta && ` · noch ${eta}`}
            </span>
          )}
        </div>
      </div>
      {isRunning && <ProgressBar percent={percent} />}
    </div>
  );
}

/** Collect every active job (YouTube download, generic bgTask, whisper) into a
 *  single list. Order: running first (preserving insertion order for stability),
 *  then queued, then done/error at the bottom for a few seconds before the
 *  server prunes them. */
function buildUnifiedJobs(processes: SystemStatusResponse['processes']): UnifiedJob[] {
  const ytJobs: UnifiedJob[] = processes.ytDownloads.map(dl => ({ key: `yt-${dl.id}`, source: 'yt' as const, dl }));
  const bgJobs: UnifiedJob[] = processes.backgroundTasks.map(task => ({ key: `bg-${task.id}`, source: 'bgTask' as const, task }));
  const whisperJobs: UnifiedJob[] = (processes.whisperJobs ?? [])
    .filter(j => j.status !== 'done')
    .map(j => ({ key: `whisper-${j.video}-${j.language}`, source: 'whisper' as const, job: j }));

  const rank = (j: UnifiedJob): number => {
    if (j.source === 'bgTask') {
      if (j.task.status === 'running') return 0;
      if (j.task.status === 'queued')  return 1;
      if (j.task.status === 'error')   return 2;
      return 3;
    }
    if (j.source === 'whisper') {
      if (j.job.status === 'running' || j.job.status === 'paused') return 0;
      if (j.job.status === 'pending') return 1;
      if (j.job.status === 'error' || j.job.status === 'interrupted') return 2;
      return 3;
    }
    return 0;
  };
  return [...ytJobs, ...bgJobs, ...whisperJobs].sort((a, b) => rank(a) - rank(b));
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(var(--glass-rgb),0.04)' }}>
      <span style={{ color: 'rgba(var(--text-rgb),0.5)', fontSize: 'var(--admin-sz-12, 12px)' }}>{label}</span>
      <span style={{ color: 'rgba(var(--text-rgb),0.85)', fontSize: 'var(--admin-sz-12, 12px)', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

export default function SystemTab() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sdrExpanded, setSdrExpanded] = useState(false);
  const [compressedExpanded, setCompressedExpanded] = useState(false);
  const [warmingAll, setWarmingAll] = useState(false);
  const [warmResult, setWarmResult] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVideos, setPreviewVideos] = useState<WarmPreviewVideo[]>([]);
  const [previewSelection, setPreviewSelection] = useState<Map<string, { hdrProbe: boolean }>>(new Map());
  const [segmentWarming, setSegmentWarming] = useState(false);
  const [segmentProgress, setSegmentProgress] = useState<{ done: number; total: number } | null>(null);
  const [segmentResult, setSegmentResult] = useState<string | null>(null);
  const [segmentMissingCount, setSegmentMissingCount] = useState<number | null>(null);
  const [allLanguages, setAllLanguages] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  // Preload warm-preview data in background so the modal opens instantly
  const preloadedPreview = useRef<{ videos: WarmPreviewVideo[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetchWarmPreview().then(result => {
      if (active) preloadedPreview.current = result;
    }).catch(() => { /* will fetch fresh when button is clicked */ });
    return () => { active = false; };
  }, []);

  // Receive system status via WebSocket push
  useWsChannel<SystemStatusResponse>('system-status', (status) => {
    setData(status);
    setError(null);
  });

  const activeGameshow = data?.config.activeGameshow;
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!activeGameshow || segmentWarming) return;
    let active = true;
    fetchCacheStatus(activeGameshow, allLanguages)
      .then(s => { if (active) setSegmentMissingCount(s.missing.length); })
      .catch(() => { if (active) setSegmentMissingCount(null); });
    return () => { active = false; };
  }, [activeGameshow, allLanguages, segmentWarming, refreshTick]);

  // Re-query whenever any cache event fires — either the operator wipes caches, or a
  // new cache is successfully generated (via this tab's batch button, a per-question
  // generate, or another operator). Without this the "(N)" counter stays stale until
  // the tab is revisited.
  useWsChannel<unknown>('caches-cleared', () => setRefreshTick(t => t + 1));
  useWsChannel<unknown>('cache-ready', () => setRefreshTick(t => t + 1));

  if (error && !data) return <div className="be-loading">Fehler: {error}</div>;
  if (!data) return <div className="be-loading">Lade Systemstatus…</div>;

  const { server, storage, caches, processes, config, nasSync } = data;
  const unifiedJobs = buildUnifiedJobs(processes);
  const hasActiveProcesses = unifiedJobs.length > 0;

  return (
    <div>
      {/* ── Server ── */}
      <div className="backend-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Server</h3>
          <InstallButton variant="admin" label="Admin installieren" />
        </div>
        <StatRow label="Laufzeit" value={formatUptime(server.uptimeSeconds)} />
        <StatRow label="Node.js" value={server.nodeVersion} />
        <StatRow label="Speicher (RSS)" value={`${server.memoryMB.rss} MB`} />
        <StatRow label="Heap" value={`${server.memoryMB.heapUsed} / ${server.memoryMB.heapTotal} MB`} />
        <StatRow label="ffmpeg" value={<><StatusDot ok={server.ffmpegAvailable} />{server.ffmpegAvailable ? 'Verfügbar' : 'Nicht gefunden'}</>} />
        <StatRow label="yt-dlp" value={<><StatusDot ok={server.ytDlpAvailable} />{server.ytDlpAvailable ? 'Verfügbar' : 'Nicht installiert'}</>} />
      </div>

      {/* ── CPU ── */}
      <div className="backend-card">
        <h3>CPU</h3>
        <StatRow label="System-CPU" value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 60, height: 6, background: 'rgba(var(--glass-rgb),0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${server.cpu.systemPercent}%`, background: server.cpu.systemPercent > 80 ? 'var(--error-light)' : server.cpu.systemPercent > 50 ? 'var(--gold-warm)' : 'var(--success)', borderRadius: 3, transition: 'width 0.5s' }} />
            </span>
            {server.cpu.systemPercent}%
          </span>
        } />
        <StatRow label="Prozess-CPU" value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 60, height: 6, background: 'rgba(var(--glass-rgb),0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${server.cpu.processPercent}%`, background: server.cpu.processPercent > 80 ? 'var(--error-light)' : server.cpu.processPercent > 50 ? 'var(--gold-warm)' : 'var(--success)', borderRadius: 3, transition: 'width 0.5s' }} />
            </span>
            {server.cpu.processPercent}%
          </span>
        } />
        <StatRow label="Load Average" value={server.cpu.loadAvg.join(' / ')} />
        <StatRow label="CPU-Kerne" value={server.cpu.cores} />
      </div>

      {/* ── Netzwerk ── */}
      <div className="backend-card">
        <h3>Netzwerk</h3>
        <StatRow label="↓ Eingehend" value={`${formatBytes(server.network.bandwidthInPerSec)}/s`} />
        <StatRow label="↑ Ausgehend" value={`${formatBytes(server.network.bandwidthOutPerSec)}/s`} />
      </div>

      {/* ── Speicher ── */}
      <div className="backend-card">
        <h3>Speicher</h3>
        <StatRow
          label="NAS"
          value={
            <>
              <StatusDot ok={storage.nasMount.reachable} />
              {storage.nasMount.reachable ? 'Erreichbar' : 'Nicht erreichbar'}
            </>
          }
        />
        <StatRow label="Modus" value="Lokal (NAS-Sync)" />
        {storage.nasMount.reachable && (
          <StatRow label="Sync" value={
            nasSync.startupSync && nasSync.startupSync.phase !== 'done' ? (
              <><span style={{ color: 'var(--sync-blue)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>Synchronisierung läuft…</>
            ) : nasSync.queueLength > 0 || nasSync.status === 'syncing' ? (
              <><span style={{ color: 'var(--gold-warm)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>Nicht synchron ({nasSync.queueLength} ausstehend)</>
            ) : (
              <><StatusDot ok />{nasSync.throttled ? 'Synchron (gedrosselt)' : 'Synchron'}</>
            )
          } />
        )}
        <StatRow label="Pfad" value={<span style={{ fontSize: 'var(--admin-sz-11, 11px)', wordBreak: 'break-all' }}>{storage.basePath}</span>} />
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.35)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Lokale Assets
          </div>
          {storage.categories.map(cat => (
            <div key={cat.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(var(--glass-rgb),0.04)' }}>
              <span style={{ color: 'rgba(var(--text-rgb),0.5)', fontSize: 'var(--admin-sz-12, 12px)' }}>{CATEGORY_LABELS[cat.name] || cat.name}</span>
              <span style={{ color: 'rgba(var(--text-rgb),0.7)', fontSize: 'var(--admin-sz-12, 12px)', fontFamily: 'monospace' }}>
                {cat.fileCount} Dateien · {formatBytes(cat.totalSizeBytes)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── NAS-Synchronisation ── */}
      <div className="backend-card">
        <h3>NAS-Synchronisation</h3>
        <StatRow label="Status" value={
          nasSync.startupSync && nasSync.startupSync.phase !== 'done' ? (
            <><span style={{ color: 'var(--sync-blue)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>Erstsynchronisation</>
          ) : nasSync.throttled ? (
            <><span style={{ color: 'var(--gold-warm)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>Gedrosselt (Video läuft)</>
          ) : nasSync.queueLength > 0 ? (
            <><span style={{ color: 'var(--gold-warm)', fontSize: 'var(--admin-sz-14, 14px)', marginRight: 6 }}>●</span>{nasSync.queueLength} ausstehend</>
          ) : (
            <><StatusDot ok={storage.nasMount.reachable} />{storage.nasMount.reachable ? 'Synchron' : 'NAS nicht erreichbar'}</>
          )
        } />
        {nasSync.startupSync && nasSync.startupSync.phase !== 'done' && nasSync.startupSync.total > 0 && (
          <div style={{ padding: '6px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.5)' }}>
                {nasSync.startupSync.phase === 'scanning' ? 'Dateien werden analysiert…' : `${nasSync.startupSync.done} / ${nasSync.startupSync.total} Dateien`}
              </span>
              <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.4)', fontFamily: 'monospace' }}>
                {nasSync.startupSync.total > 0 ? `${Math.round((nasSync.startupSync.done / nasSync.startupSync.total) * 100)}%` : ''}
              </span>
            </div>
            <div style={{ height: 4, background: 'rgba(var(--glass-rgb),0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${nasSync.startupSync.total > 0 ? (nasSync.startupSync.done / nasSync.startupSync.total) * 100 : 0}%`, background: 'var(--sync-blue)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
        {nasSync.currentOp && (
          <StatRow label="Aktuell" value={<span style={{ fontSize: 'var(--admin-sz-11, 11px)', wordBreak: 'break-all' }}>{nasSync.currentOp}</span>} />
        )}
        {nasSync.queueLength > 0 && (
          <StatRow label="Warteschlange" value={`${nasSync.queueLength} Operationen`} />
        )}
        <StatRow label="Synchronisiert" value={formatBytes(nasSync.bytesSynced)} />
        <StatRow label="Letzte Überprüfung" value={nasSync.lastRescanAt ? new Date(nasSync.lastRescanAt).toLocaleTimeString('de-DE') : '—'} />
      </div>

      {/* ── Caches ── */}
      <div className="backend-card">
        <h3>Caches</h3>
        <StatRow label="SDR-Tonemapping" value={`${caches.sdr.count} Einträge · ${formatBytes(caches.sdr.totalSizeBytes)}`} />
        {caches.sdr.count > 0 && (
          <div style={{ marginBottom: 6 }}>
            <button
              className="be-icon-btn"
              style={{ fontSize: 'var(--admin-sz-11, 11px)', padding: '2px 6px', marginTop: 2 }}
              onClick={() => setSdrExpanded(!sdrExpanded)}
            >
              {sdrExpanded ? '▾ Verbergen' : '▸ Dateien anzeigen'}
            </button>
            {sdrExpanded && (
              <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', fontSize: 'var(--admin-sz-11, 11px)', fontFamily: 'monospace', color: 'rgba(var(--text-rgb),0.5)', lineHeight: 1.6 }}>
                {caches.sdr.files.map(f => <div key={f}>{f}</div>)}
              </div>
            )}
          </div>
        )}

        <StatRow label="Komprimierte Segmente" value={`${caches.compressed.count} Einträge · ${formatBytes(caches.compressed.totalSizeBytes)}`} />
        {caches.compressed.count > 0 && (
          <div style={{ marginBottom: 6 }}>
            <button
              className="be-icon-btn"
              style={{ fontSize: 'var(--admin-sz-11, 11px)', padding: '2px 6px', marginTop: 2 }}
              onClick={() => setCompressedExpanded(!compressedExpanded)}
            >
              {compressedExpanded ? '▾ Verbergen' : '▸ Dateien anzeigen'}
            </button>
            {compressedExpanded && (
              <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', fontSize: 'var(--admin-sz-11, 11px)', fontFamily: 'monospace', color: 'rgba(var(--text-rgb),0.5)', lineHeight: 1.6 }}>
                {caches.compressed.files.map(f => <div key={f}>{f}</div>)}
              </div>
            )}
          </div>
        )}

        <StatRow label="HDR-Metadaten" value={`${caches.hdr.count} Einträge`} />

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="be-icon-btn"
            style={{ fontSize: 'var(--admin-sz-12, 12px)' }}
            disabled={previewLoading}
            onClick={async () => {
              setPreviewOpen(true);
              setPreviewVideos([]);
              setPreviewSelection(new Map());
              setWarmResult(null);

              // Use preloaded data if available, otherwise fetch fresh
              const preloaded = preloadedPreview.current;
              if (preloaded) {
                preloadedPreview.current = null;
                const videos = preloaded.videos;
                setPreviewVideos(videos);
                const sel = new Map<string, { hdrProbe: boolean }>();
                for (const v of videos) {
                  sel.set(v.path, { hdrProbe: v.needsHdrProbe });
                }
                setPreviewSelection(sel);
              } else {
                setPreviewLoading(true);
                try {
                  const { videos } = await fetchWarmPreview();
                  setPreviewVideos(videos);
                  const sel = new Map<string, { hdrProbe: boolean }>();
                  for (const v of videos) {
                    sel.set(v.path, { hdrProbe: v.needsHdrProbe });
                  }
                  setPreviewSelection(sel);
                } catch (e) {
                  setWarmResult(`Fehler: ${(e as Error).message}`);
                  setPreviewOpen(false);
                } finally {
                  setPreviewLoading(false);
                }
              }
            }}
          >
            🔄 Caches generieren
          </button>
          {warmResult && (
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.5)' }}>{warmResult}</span>
          )}
        </div>

        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="be-icon-btn"
            style={{ fontSize: 'var(--admin-sz-12, 12px)' }}
            disabled={segmentWarming}
            onClick={async () => {
              setSegmentResult(null);
              setSegmentProgress(null);
              setSegmentWarming(true);
              try {
                const status = await fetchCacheStatus(config.activeGameshow, allLanguages);
                if (status.missing.length === 0) {
                  setSegmentResult('Alle Segment-Caches vorhanden');
                  setSegmentMissingCount(0);
                  setSegmentWarming(false);
                  return;
                }
                setSegmentProgress({ done: 0, total: status.missing.length });
                let warmed = 0;
                let failed = 0;
                await warmAllCaches((event) => {
                  if (typeof event.index === 'number' && typeof event.total === 'number') {
                    setSegmentProgress({ done: event.index, total: event.total });
                  }
                  if (event.done) {
                    warmed = event.warmed ?? 0;
                    failed = event.failed?.length ?? 0;
                  }
                }, config.activeGameshow, undefined, allLanguages);
                setSegmentResult(failed > 0 ? `${warmed} erstellt, ${failed} Fehler` : `${warmed} Segment-Cache${warmed !== 1 ? 's' : ''} erstellt`);
              } catch (e) {
                setSegmentResult(`Fehler: ${(e as Error).message}`);
              } finally {
                setSegmentWarming(false);
                setSegmentProgress(null);
              }
            }}
          >
            {segmentWarming
              ? '⏳ Läuft…'
              : `🎬 Fehlende Segment-Caches generieren${segmentMissingCount !== null ? ` (${segmentMissingCount})` : ''}`}
          </button>
          {!segmentWarming && (
            <label className="be-toggle">
              <input
                type="checkbox"
                checked={allLanguages}
                onChange={(e) => setAllLanguages(e.target.checked)}
              />
              <span className="be-toggle-track" />
              <span className="be-toggle-label">Alle Sprachen</span>
            </label>
          )}
          {segmentResult && !segmentWarming && (
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.5)' }}>{segmentResult}</span>
          )}
        </div>

        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="be-icon-btn danger"
            style={{ fontSize: 'var(--admin-sz-12, 12px)' }}
            disabled={clearing}
            onClick={async () => {
              if (!window.confirm('Alle Caches wirklich löschen? Sie werden bei Bedarf neu generiert.')) return;
              setClearResult(null);
              setClearing(true);
              try {
                const { cleared } = await clearAllCaches();
                setClearResult(`${cleared.sdr} SDR, ${cleared.compressed} komprimiert, ${cleared.hdr} HDR gelöscht`);
              } catch (e) {
                setClearResult(`Fehler: ${(e as Error).message}`);
              } finally {
                setClearing(false);
              }
            }}
          >
            {clearing ? '⏳ Läuft…' : '🗑 Alle Caches löschen'}
          </button>
          {clearResult && (
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.5)' }}>{clearResult}</span>
          )}
        </div>
      </div>

      {/* ── Aktive Prozesse ── */}
      <div className="backend-card">
        <h3>Aktive Prozesse</h3>
        {!hasActiveProcesses && (
          <div style={{ textAlign: 'center', color: 'rgba(var(--text-rgb),0.3)', fontSize: 'var(--admin-sz-12, 12px)', padding: '8px 0' }}>
            Keine aktiven Prozesse
          </div>
        )}
        {unifiedJobs.map(job => <JobRow key={job.key} job={job} />)}
      </div>

      {/* ── Konfiguration ── */}
      <div className="backend-card">
        <h3>Konfiguration</h3>
        <StatRow label="Aktive Gameshow" value={config.activeGameshow} />
        <StatRow label="Spiele in Reihenfolge" value={config.gameOrderCount} />
        <StatRow label="Spieldateien gesamt" value={config.totalGameFiles} />
      </div>

      {/* ── Cache-Vorschau Modal ── */}
      {previewOpen && (
        <div className="modal-overlay" onClick={() => setPreviewOpen(false)}>
          <div className="video-detail-modal" style={{ width: 'min(780px, 95vw)' }} onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">Cache-Generierung</span>
              <button className="be-icon-btn" onClick={() => setPreviewOpen(false)}>✕</button>
            </div>
            {previewLoading ? (
              <div style={{ padding: '40px 16px', textAlign: 'center' }}>
                <div className="video-loading-spinner" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb),0.5)' }}>Videos werden analysiert…</div>
              </div>
            ) : (
            <>
            <div style={{ padding: '12px 16px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb),0.5)', marginBottom: 10 }}>
                {previewVideos.length} Video{previewVideos.length !== 1 ? 's' : ''} gefunden. Aktionen abwählen, die nicht ausgeführt werden sollen.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { hdrProbe: v.needsHdrProbe });
                    }
                    setPreviewSelection(sel);
                  }}
                >Fehlende auswählen</button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { hdrProbe: true });
                    }
                    setPreviewSelection(sel);
                  }}
                >Alle auswählen</button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { hdrProbe: false });
                    }
                    setPreviewSelection(sel);
                  }}
                >Keine auswählen</button>
              </div>
              <table style={{ width: '100%', fontSize: 'var(--admin-sz-12, 12px)', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 10px', color: 'rgba(var(--text-rgb),0.4)', fontWeight: 500, fontSize: 'var(--admin-sz-10, 10px)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(var(--glass-rgb),0.06)' }}>Video</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', color: 'rgba(var(--text-rgb),0.4)', fontWeight: 500, fontSize: 'var(--admin-sz-10, 10px)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 90, borderBottom: '1px solid rgba(var(--glass-rgb),0.06)' }} title="Liest Video-Metadaten aus (HDR-Status, MaxCLL, Farbraum). Wird für korrektes Tone-Mapping benötigt.">HDR-Probe</th>
                  </tr>
                </thead>
                <tbody>
                  {previewVideos.map((v, i) => {
                    const sel = previewSelection.get(v.path) ?? { hdrProbe: false };
                    return (
                      <tr key={v.path} style={{ background: i % 2 === 0 ? 'rgba(var(--glass-rgb),0.02)' : 'transparent', borderRadius: 4 }}>
                        <td style={{ padding: '5px 10px', color: 'rgba(var(--text-rgb),0.85)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRadius: '4px 0 0 4px' }} title={v.path}>
                          {v.path.split('/').pop()}
                          {v.isHdr && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 'var(--admin-sz-9, 9px)', fontWeight: 700, background: 'rgba(var(--gold-warm-rgb),0.15)', border: '1px solid rgba(var(--gold-warm-rgb),0.4)', color: 'rgba(var(--gold-warm-rgb),0.95)', verticalAlign: 'middle' }}>HDR</span>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 8px', borderRadius: '0 4px 4px 0' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                            <input type="checkbox" checked={sel.hdrProbe} onChange={e => { const next = new Map(previewSelection); next.set(v.path, { ...sel, hdrProbe: e.target.checked }); setPreviewSelection(next); }} style={{ display: 'none' }} />
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 18, height: 18, borderRadius: 4,
                              background: sel.hdrProbe ? 'rgba(var(--admin-accent-rgb),0.9)' : 'rgba(var(--glass-rgb),0.06)',
                              border: `1.5px solid ${sel.hdrProbe ? 'rgba(var(--admin-accent-rgb),1)' : 'rgba(var(--glass-rgb),0.15)'}`,
                              transition: 'all 0.15s', fontSize: 'var(--admin-sz-11, 11px)', color: '#fff', fontWeight: 700,
                            }}>
                              {sel.hdrProbe && '✓'}
                            </span>
                            {!v.needsHdrProbe && <span style={{ position: 'absolute', left: '100%', marginLeft: 4, fontSize: 'var(--admin-sz-9, 9px)', color: 'rgba(var(--success-rgb),0.6)' }} title="Bereits vorhanden">✓</span>}
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(var(--glass-rgb),0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.4)' }}>
                {(() => {
                  let hp = 0;
                  previewSelection.forEach(s => { if (s.hdrProbe) hp++; });
                  return `${hp} HDR-Probe`;
                })()}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="be-icon-btn" style={{ fontSize: 'var(--admin-sz-12, 12px)' }} onClick={() => setPreviewOpen(false)}>
                  Abbrechen
                </button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-12, 12px)', background: 'rgba(var(--success-rgb),0.15)', border: '1px solid rgba(var(--success-rgb),0.3)', color: 'var(--success)' }}
                  disabled={warmingAll}
                  onClick={async () => {
                    const selected: Array<{ path: string; hdrProbe: boolean }> = [];
                    previewSelection.forEach((s, p) => {
                      if (s.hdrProbe) selected.push({ path: p, ...s });
                    });
                    if (selected.length === 0) { setPreviewOpen(false); return; }
                    setWarmingAll(true);
                    try {
                      const { queued } = await warmAllVideoCaches(selected);
                      setWarmResult(`${queued} Video${queued !== 1 ? 's' : ''} in Warteschlange`);
                    } catch (e) {
                      setWarmResult(`Fehler: ${(e as Error).message}`);
                    } finally {
                      setWarmingAll(false);
                      setPreviewOpen(false);
                    }
                  }}
                >
                  {warmingAll ? '⏳ Wird gestartet…' : '▶ Starten'}
                </button>
              </div>
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
