import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useUpload, type YtPlaylistTrack, type AudioCoverProgress } from '@/components/backend/UploadContext';
import { Lightbox } from '@/components/layout/Lightbox';
import { isUploadThrottled } from '@/services/backendApi';
import {
  buildProgressItems,
  overallPercent,
  overallPhase,
  overallDetail,
  type ProgressItemInfo,
  type ProgressPhase,
} from '@/utils/progressItems';

const EXPANDED_ROWS_STORAGE = 'admin-expanded-progress-rows';
const GROUP_COLLAPSED_STORAGE = 'admin-progress-group-collapsed';
/** Superseded by EXPANDED_ROWS_STORAGE (inverted semantics) — cleaned up once on mount. */
const LEGACY_MINIMIZED_STORAGE = 'admin-minimized-progress-keys';

function fillClass(phase: ProgressPhase): string {
  switch (phase) {
    case 'done': return ' upload-progress-done';
    case 'error': return ' upload-progress-error';
    case 'processing': return ' upload-progress-processing';
    case 'resolving': return ' upload-progress-resolving';
    default: return '';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function PlaylistTrackList({ tracks }: { tracks: YtPlaylistTrack[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Only show tracks that have resolved a title — unresolved placeholders and
  // completed tracks are hidden so the list stays focused on active downloads.
  // The row number keeps the original playlist position so the user can still
  // orient themselves in a long playlist.
  const visible = tracks
    .map((t, originalIdx) => ({ t, originalIdx }))
    .filter(({ t }) => t.phase !== 'done' && t.title);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="progress-track-list">
      {visible.map(({ t, originalIdx }) => (
        <div key={originalIdx} className="progress-track-row">
          <div className="progress-track-index">
            {t.phase === 'processing' ? '~' : t.phase === 'resolving' ? '…' : `${originalIdx + 1}`}
          </div>
          <div className="progress-track-body">
            <div className="progress-track-name">{t.title || 'Wird geladen…'}</div>
            <div className="upload-progress-track progress-track-bar">
              <div
                className={`upload-progress-fill${t.phase === 'resolving' ? ' upload-progress-resolving' : ''}${t.phase === 'processing' ? ' upload-progress-processing' : ''}`}
                style={{ width: t.phase === 'downloading' ? `${t.percent}%` : '100%' }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AudioCoverTrackList({ files }: { files: AudioCoverProgress['files'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [files]);

  return (
    <div ref={ref} className="progress-track-list">
      {files.map((f, i) => (
        <div key={i} className="progress-track-row">
          <div className="progress-track-index">
            {f.phase === 'done' ? '✓' : f.phase === 'error' ? '✕' : f.phase === 'searching' ? '…' : `${i + 1}`}
          </div>
          <div className="progress-track-body">
            <div className={`progress-track-name${f.phase === 'done' ? ' progress-track-name--ok' : ''}${f.phase === 'error' ? ' progress-track-name--error' : ''}`}>
              {f.name}
            </div>
            <div className="upload-progress-track progress-track-bar">
              <div
                className={`upload-progress-fill${f.phase === 'searching' ? ' upload-progress-resolving' : ''}${f.phase === 'done' ? ' upload-progress-done' : ''}${f.phase === 'error' ? ' upload-progress-error' : ''}`}
                style={{ width: f.phase === 'pending' ? '0%' : '100%' }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MinimizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="upload-progress-minimize-btn"
      title="Minimieren"
      aria-label="Minimieren"
      onClick={onClick}
    >
      ▬
    </button>
  );
}

function MinimizedBar({
  label,
  detail,
  percent,
  phase,
  onClick,
}: {
  label: string;
  detail: string;
  percent: number;
  phase: ProgressPhase;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="upload-progress-minimized"
      onClick={onClick}
      title="Erweitern"
      aria-label="Erweitern"
    >
      <div className="upload-progress-minimized-row">
        <span className="upload-progress-minimized-label">{label}</span>
        <span className="upload-progress-minimized-detail">{detail}</span>
      </div>
      <div className="upload-progress-track">
        <div
          className={`upload-progress-fill${fillClass(phase)}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </button>
  );
}

function ProgressRow({
  item,
  expanded,
  onToggle,
  onAction,
  onMinimizeGroup,
  children,
}: {
  item: ProgressItemInfo;
  expanded: boolean;
  onToggle: () => void;
  onAction: () => void;
  /** Only passed for the lone row, where there is no group header to host the ▬ button. */
  onMinimizeGroup?: () => void;
  children?: ReactNode;
}) {
  // A resolving job has no percentage yet — run the shimmer across the full track.
  const width = item.phase === 'resolving' ? 100 : Math.max(0, Math.min(100, item.percent));
  return (
    <div className="progress-row">
      <div className="progress-row-head">
        <button
          type="button"
          className="progress-row-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? 'Details ausblenden' : 'Details anzeigen'}
        >
          <span className="progress-row-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="progress-row-label">{item.label}</span>
          <span className="progress-row-detail">{item.detail}</span>
        </button>
        {onMinimizeGroup && <MinimizeButton onClick={onMinimizeGroup} />}
        <button
          type="button"
          className="progress-row-cancel"
          onClick={onAction}
          title={item.canCancel ? 'Abbrechen' : 'Ausblenden'}
          aria-label={item.canCancel ? 'Abbrechen' : 'Ausblenden'}
        >
          ✕
        </button>
      </div>
      <div className="upload-progress-track progress-row-track">
        <div className={`upload-progress-fill${fillClass(item.phase)}`} style={{ width: `${width}%` }} />
      </div>
      {expanded && children && <div className="progress-row-detail-block">{children}</div>}
    </div>
  );
}

export default function ProgressOverlay() {
  const {
    uploadProgress, abortUpload,
    ytDownloads, cancelYtDownload, dismissYtDownload,
    audioCoverDownloads, cancelAudioCoverFetch, dismissAudioCoverFetch,
    pendingCoverConfirm, respondCoverConfirm,
  } = useUpload();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Every job is a compact row in one shared panel. `expandedKeys` holds the rows whose
  // detail block is open — the user owns that state, any combination is allowed, and a
  // newly started job never changes an existing row's state. Persisted to localStorage so
  // a reload keeps rows open while the server-backed jobs reconnect via WebSocket.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_ROWS_STORAGE);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  const [groupCollapsed, setGroupCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(GROUP_COLLAPSED_STORAGE) === '1'; } catch { return false; }
  });
  // Keys that have been observed as active in this session. A key is only prunable
  // once we've seen it alive — otherwise the initial render (before WS reconnect
  // delivers in-flight jobs) would wipe restored keys from localStorage.
  const seenKeys = useRef<Set<string>>(new Set());
  // Rows already auto-opened because their job failed — so re-collapsing one sticks.
  const errorSeeded = useRef<Set<string>>(new Set());

  const items = buildProgressItems(uploadProgress, ytDownloads, audioCoverDownloads);
  const activeKeys = items.map(it => it.key);
  const erroredKeys = items.filter(it => it.phase === 'error').map(it => it.key);

  useEffect(() => {
    try { localStorage.removeItem(LEGACY_MINIMIZED_STORAGE); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const unseen = activeKeys.filter(k => !seenKeys.current.has(k));
    for (const k of activeKeys) seenKeys.current.add(k);
    const newErrors = erroredKeys.filter(k => !errorSeeded.current.has(k));
    for (const k of erroredKeys) errorSeeded.current.add(k);

    setExpandedKeys(prev => {
      const active = new Set(activeKeys);
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (active.has(k) || !seenKeys.current.has(k)) next.add(k);
        else changed = true;
      }
      // A job that starts while it is the only one opens expanded — a lone download still
      // shows its phase text without a click. Jobs started alongside others stay compact.
      const soleNewKey = activeKeys.length === 1 && unseen.length === 1 ? unseen[0] : undefined;
      if (soleNewKey !== undefined && !next.has(soleNewKey)) {
        next.add(soleNewKey);
        changed = true;
      }
      // A failure always opens its row, so the error message is never hidden behind a click.
      for (const k of newErrors) {
        if (!next.has(k)) { next.add(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [activeKeys.join('|'), erroredKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (expandedKeys.size === 0) localStorage.removeItem(EXPANDED_ROWS_STORAGE);
      else localStorage.setItem(EXPANDED_ROWS_STORAGE, JSON.stringify([...expandedKeys]));
    } catch { /* ignore */ }
  }, [expandedKeys]);

  useEffect(() => {
    try {
      if (groupCollapsed) localStorage.setItem(GROUP_COLLAPSED_STORAGE, '1');
      else localStorage.removeItem(GROUP_COLLAPSED_STORAGE);
    } catch { /* ignore */ }
  }, [groupCollapsed]);

  // Keep the newest row in view when the list grows past its scroll cap.
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeKeys.length]);

  if (items.length === 0 && !pendingCoverConfirm) return null;

  const toggleRow = (key: string) => setExpandedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const isAudioUpload = uploadProgress && (uploadProgress.category === 'audio' || uploadProgress.category === 'background-music');

  const detailFor = (item: ProgressItemInfo): ReactNode => {
    if (item.kind === 'upload' && uploadProgress) {
      return (
        <>
          {uploadProgress.phase === 'uploading' && uploadProgress.speed > 0 && uploadProgress.elapsed >= 5 && (
            <div className="progress-row-stats">
              <span>{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.fileSize)}</span>
              <span>{formatBytes(uploadProgress.speed)}/s{isUploadThrottled() ? ' (gedrosselt)' : ''}</span>
              {uploadProgress.eta > 0 && <span>~{formatEta(uploadProgress.eta)} verbleibend</span>}
            </div>
          )}
          {uploadProgress.phase === 'processing' && isAudioUpload && (
            <div className="upload-progress-phase">🎵 Audio wird normalisiert — kann einige Sekunden dauern…</div>
          )}
          {uploadProgress.phase === 'processing' && !isAudioUpload && (
            <div className="upload-progress-phase">Datei wird gespeichert…</div>
          )}
        </>
      );
    }

    if (item.kind === 'yt' || item.kind === 'yt-playlist') {
      const dl = ytDownloads.find(d => d.id === item.id);
      if (!dl) return null;
      if (item.kind === 'yt') {
        return (
          <>
            {dl.phase === 'resolving' && <div className="upload-progress-phase">Video wird vorbereitet…</div>}
            {dl.phase === 'downloading' && (
              <div className="upload-progress-phase">
                {dl.category === 'videos' ? 'Video wird von YouTube heruntergeladen…' : 'Audio wird von YouTube heruntergeladen…'}
              </div>
            )}
            {dl.phase === 'processing' && (
              <div className="upload-progress-phase">
                {dl.category === 'videos' ? 'Video wird gespeichert…' : '🎵 Lautstärke wird normalisiert…'}
              </div>
            )}
            {dl.phase === 'done' && <div className="progress-row-note progress-row-note--ok">Fertig — Datei wurde gespeichert</div>}
            {dl.phase === 'error' && <div className="progress-row-note progress-row-note--error">{dl.error}</div>}
          </>
        );
      }
      const tracks = dl.tracks ?? [];
      return (
        <>
          {tracks.length > 0 && <PlaylistTrackList tracks={tracks} />}
          {tracks.length === 0 && dl.phase !== 'done' && dl.phase !== 'error' && (
            <div className="upload-progress-phase">
              {dl.trackCount ? 'Tracks werden vorbereitet…' : 'Playlist wird geladen…'}
            </div>
          )}
          {dl.phase === 'done' && (
            <div className="progress-row-note progress-row-note--ok">
              Fertig — {dl.trackCount} Tracks in '{dl.playlistTitle}' gespeichert
            </div>
          )}
          {dl.phase === 'error' && <div className="progress-row-note progress-row-note--error">{dl.error}</div>}
        </>
      );
    }

    const dl = audioCoverDownloads.find(d => d.id === item.id);
    if (!dl) return null;
    const doneCount = dl.files.filter(f => f.phase === 'done').length;
    const errorCount = dl.files.filter(f => f.phase === 'error').length;
    return (
      <>
        {dl.files.length > 0 && <AudioCoverTrackList files={dl.files} />}
        {dl.phase === 'searching' && !pendingCoverConfirm && (
          <div className="upload-progress-phase">Cover wird gesucht…</div>
        )}
        {dl.phase === 'done' && (
          <div className="progress-row-note progress-row-note--ok">
            Fertig — {doneCount} Cover geladen{errorCount > 0 ? `, ${errorCount} nicht gefunden` : ''}
          </div>
        )}
        {dl.phase === 'error' && <div className="progress-row-note progress-row-note--error">{dl.error}</div>}
      </>
    );
  };

  const actionFor = (item: ProgressItemInfo) => () => {
    if (item.kind === 'upload') { abortUpload(); return; }
    if (item.kind === 'cover') {
      if (item.canCancel) cancelAudioCoverFetch(item.id); else dismissAudioCoverFetch(item.id);
      return;
    }
    if (item.canCancel) cancelYtDownload(item.id); else dismissYtDownload(item.id);
  };

  const confirmElement = pendingCoverConfirm ? (
    <div className="upload-progress-box">
      <div style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'var(--gold-warm)', marginBottom: 6 }}>
        Unsicherer Treffer — bitte bestätigen
      </div>
      <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))', marginBottom: 4 }}>
        <strong style={{ color: 'rgba(var(--text-rgb), max(0.85, var(--text-fade-floor, 0)))' }}>{pendingCoverConfirm.fileName}</strong>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <img
          src={pendingCoverConfirm.coverPreview}
          alt="Cover preview"
          style={{ width: 60, height: 60, borderRadius: 4, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }}
          onClick={() => setLightboxSrc(pendingCoverConfirm.coverPreview)}
        />
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)' }}>
          <div><span style={{ color: 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))' }}>Künstler:</span> {pendingCoverConfirm.foundArtist}</div>
          <div><span style={{ color: 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))' }}>Titel:</span> {pendingCoverConfirm.foundTrack}</div>
          <div style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(var(--text-rgb), max(0.3, var(--text-fade-floor, 0)))' }}>via {pendingCoverConfirm.source}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="be-icon-btn" style={{ fontSize: 'var(--admin-sz-12, 12px)', padding: '6px 14px', lineHeight: 1 }} onClick={() => respondCoverConfirm(false)}>Ablehnen</button>
        <button className="be-btn-primary" style={{ fontSize: 'var(--admin-sz-12, 12px)', padding: '6px 14px', lineHeight: 1 }} onClick={() => respondCoverConfirm(true)}>Übernehmen</button>
      </div>
    </div>
  ) : null;

  const overall = overallPercent(items);
  const groupPhase = overallPhase(items);

  return (
    <div className="upload-progress-overlay">
      <div className="progress-stack">
        {items.length > 0 && (groupCollapsed ? (
          <MinimizedBar
            label="Aktivität"
            detail={overallDetail(items)}
            percent={overall}
            phase={groupPhase}
            onClick={() => setGroupCollapsed(false)}
          />
        ) : (
          <div className="upload-progress-box progress-group">
            {items.length >= 2 && (
              <div className="progress-group-header">
                <div className="progress-group-header-row">
                  <span className="progress-group-title">Aktivität · {items.length}</span>
                  <span className="progress-group-summary">{overallDetail(items)}</span>
                  <MinimizeButton onClick={() => setGroupCollapsed(true)} />
                </div>
                <div className="upload-progress-track">
                  <div className={`upload-progress-fill${fillClass(groupPhase)}`} style={{ width: `${overall}%` }} />
                </div>
              </div>
            )}
            <div className="progress-group-rows" ref={rowsRef}>
              {items.map(item => (
                <ProgressRow
                  key={item.key}
                  item={item}
                  expanded={expandedKeys.has(item.key)}
                  onToggle={() => toggleRow(item.key)}
                  onAction={actionFor(item)}
                  onMinimizeGroup={items.length === 1 ? () => setGroupCollapsed(true) : undefined}
                >
                  {detailFor(item)}
                </ProgressRow>
              ))}
            </div>
          </div>
        ))}
        {confirmElement}
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
