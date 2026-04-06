import { useState, useEffect, useRef } from 'react';
import { fetchSystemStatus, fetchWarmPreview, warmAllVideoCaches, type SystemStatusResponse, type WarmPreviewVideo } from '@/services/backendApi';

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
  return <span style={{ color: ok ? '#4ade80' : '#f87171', fontSize: 14, marginRight: 6 }}>●</span>;
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

export default function SystemTab() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackExpanded, setTrackExpanded] = useState(false);
  const [sdrExpanded, setSdrExpanded] = useState(false);
  const [warmingAll, setWarmingAll] = useState(false);
  const [warmResult, setWarmResult] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVideos, setPreviewVideos] = useState<WarmPreviewVideo[]>([]);
  const [previewSelection, setPreviewSelection] = useState<Map<string, { trackCache: boolean; hdrProbe: boolean; audioTranscode: boolean }>>(new Map());

  // Preload warm-preview data in background so the modal opens instantly
  const preloadedPreview = useRef<{ videos: WarmPreviewVideo[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetchWarmPreview().then(result => {
      if (active) preloadedPreview.current = result;
    }).catch(() => { /* will fetch fresh when button is clicked */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const status = await fetchSystemStatus();
        if (active) {
          setData(status);
          setError(null);
          // Poll faster (2s) when active processes exist, otherwise every 5s
          const hasActive = status.processes.transcodes.length > 0
            || status.processes.ytDownloads.length > 0
            || status.processes.backgroundTasks.some(t => t.status === 'running');
          timer = setTimeout(load, hasActive ? 2000 : 5000);
        }
      } catch (err) {
        if (active) { setError((err as Error).message); timer = setTimeout(load, 5000); }
      }
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  if (error && !data) return <div className="be-loading">Fehler: {error}</div>;
  if (!data) return <div className="be-loading">Lade Systemstatus…</div>;

  const { server, storage, caches, processes, config } = data;
  const hasActiveProcesses = processes.transcodes.length > 0 || processes.ytDownloads.length > 0 || processes.backgroundTasks.length > 0;

  return (
    <div>
      {/* ── Server ── */}
      <div className="backend-card">
        <h3>Server</h3>
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
            <span style={{ display: 'inline-block', width: 60, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${server.cpu.systemPercent}%`, background: server.cpu.systemPercent > 80 ? '#f87171' : server.cpu.systemPercent > 50 ? '#fbbf24' : '#4ade80', borderRadius: 3, transition: 'width 0.5s' }} />
            </span>
            {server.cpu.systemPercent}%
          </span>
        } />
        <StatRow label="Prozess-CPU" value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 60, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${server.cpu.processPercent}%`, background: server.cpu.processPercent > 80 ? '#f87171' : server.cpu.processPercent > 50 ? '#fbbf24' : '#4ade80', borderRadius: 3, transition: 'width 0.5s' }} />
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
              {storage.nasMount.active
                ? (storage.nasMount.reachable ? 'Aktiv & erreichbar' : 'Aktiviert, nicht erreichbar')
                : 'Nicht aktiviert'}
            </>
          }
        />
        <StatRow label="Modus" value={storage.mode === 'nas' ? 'NAS' : 'Lokal'} />
        <StatRow label="Pfad" value={<span style={{ fontSize: 11, wordBreak: 'break-all' }}>{storage.basePath}</span>} />
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Lokale Assets
          </div>
          {storage.categories.map(cat => (
            <div key={cat.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{CATEGORY_LABELS[cat.name] || cat.name}</span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'monospace' }}>
                {cat.fileCount} Dateien · {formatBytes(cat.totalSizeBytes)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Caches ── */}
      <div className="backend-card">
        <h3>Caches</h3>
        <StatRow label="Track-Remux" value={`${caches.track.count} Einträge · ${formatBytes(caches.track.totalSizeBytes)}`} />
        {caches.track.count > 0 && (
          <div style={{ marginBottom: 6 }}>
            <button
              className="be-icon-btn"
              style={{ fontSize: 11, padding: '2px 6px', marginTop: 2 }}
              onClick={() => setTrackExpanded(!trackExpanded)}
            >
              {trackExpanded ? '▾ Verbergen' : '▸ Dateien anzeigen'}
            </button>
            {trackExpanded && (
              <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                {caches.track.files.map(f => <div key={f}>{f}</div>)}
              </div>
            )}
          </div>
        )}

        <StatRow label="SDR-Tonemapping" value={`${caches.sdr.count} Einträge · ${formatBytes(caches.sdr.totalSizeBytes)}`} />
        {caches.sdr.count > 0 && (
          <div style={{ marginBottom: 6 }}>
            <button
              className="be-icon-btn"
              style={{ fontSize: 11, padding: '2px 6px', marginTop: 2 }}
              onClick={() => setSdrExpanded(!sdrExpanded)}
            >
              {sdrExpanded ? '▾ Verbergen' : '▸ Dateien anzeigen'}
            </button>
            {sdrExpanded && (
              <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                {caches.sdr.files.map(f => <div key={f}>{f}</div>)}
              </div>
            )}
          </div>
        )}

        <StatRow label="HDR-Metadaten" value={`${caches.hdr.count} Einträge`} />

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="be-icon-btn"
            style={{ fontSize: 12 }}
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
                const sel = new Map<string, { trackCache: boolean; hdrProbe: boolean; audioTranscode: boolean }>();
                for (const v of videos) {
                  sel.set(v.path, { trackCache: v.needsTrackCache, hdrProbe: v.needsHdrProbe, audioTranscode: v.needsAudioTranscode });
                }
                setPreviewSelection(sel);
              } else {
                setPreviewLoading(true);
                try {
                  const { videos } = await fetchWarmPreview();
                  setPreviewVideos(videos);
                  const sel = new Map<string, { trackCache: boolean; hdrProbe: boolean; audioTranscode: boolean }>();
                  for (const v of videos) {
                    sel.set(v.path, { trackCache: v.needsTrackCache, hdrProbe: v.needsHdrProbe, audioTranscode: v.needsAudioTranscode });
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
            🔄 Alle Caches generieren
          </button>
          {warmResult && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{warmResult}</span>
          )}
        </div>
      </div>

      {/* ── Aktive Prozesse ── */}
      <div className="backend-card">
        <h3>Aktive Prozesse</h3>
        {!hasActiveProcesses && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: '8px 0' }}>
            Keine aktiven Prozesse
          </div>
        )}

        {processes.transcodes.map((t, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>🎬 Transcode: {t.filePath}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{t.phase}</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${t.percent}%`, background: '#3b82f6', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{t.status}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{t.percent}%</span>
            </div>
          </div>
        ))}

        {processes.ytDownloads.map(dl => (
          <div key={dl.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>⬇️ Download: {dl.title || dl.id}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{dl.phase}</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${dl.percent}%`, background: '#a855f7', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            {dl.playlistTotal != null && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                Playlist: {dl.playlistDone ?? 0} / {dl.playlistTotal}
              </div>
            )}
          </div>
        ))}

        {processes.backgroundTasks.length > 0 && (
          <div style={{ marginTop: processes.transcodes.length > 0 || processes.ytDownloads.length > 0 ? 8 : 0 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Hintergrund-Aufgaben
            </div>
            {processes.backgroundTasks.map(task => (
              <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                  <StatusDot ok={task.status !== 'error'} />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {task.detail && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{task.detail}</span>
                  )}
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                    {task.status === 'running' ? `${task.elapsed}s` : task.status === 'done' ? '✓' : '✗'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
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
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Videos werden analysiert…</div>
              </div>
            ) : (
            <>
            <div style={{ padding: '12px 16px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>
                {previewVideos.length} Video{previewVideos.length !== 1 ? 's' : ''} gefunden. Aktionen abwählen, die nicht ausgeführt werden sollen.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { trackCache: v.needsTrackCache, hdrProbe: v.needsHdrProbe, audioTranscode: v.needsAudioTranscode });
                    }
                    setPreviewSelection(sel);
                  }}
                >Fehlende auswählen</button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { trackCache: true, hdrProbe: true, audioTranscode: v.needsAudioTranscode });
                    }
                    setPreviewSelection(sel);
                  }}
                >Alle auswählen</button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    const sel = new Map(previewSelection);
                    for (const v of previewVideos) {
                      sel.set(v.path, { trackCache: false, hdrProbe: false, audioTranscode: false });
                    }
                    setPreviewSelection(sel);
                  }}
                >Keine auswählen</button>
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 10px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Video</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', width: 100, borderBottom: '1px solid rgba(255,255,255,0.06)' }} title="Extrahiert jede Audio-Spur als separate Datei (Remux). Ermöglicht schnelles Umschalten zwischen Sprachen im Browser.">Track-Cache</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', width: 90, borderBottom: '1px solid rgba(255,255,255,0.06)' }} title="Liest Video-Metadaten aus (HDR-Status, MaxCLL, Farbraum). Wird für korrektes Tone-Mapping benötigt.">HDR-Probe</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', width: 110, borderBottom: '1px solid rgba(255,255,255,0.06)' }} title="Konvertiert inkompatible Audio-Codecs (DTS, TrueHD, EAC3) zu AAC.">Audio→AAC</th>
                  </tr>
                </thead>
                <tbody>
                  {previewVideos.map((v, i) => {
                    const sel = previewSelection.get(v.path) ?? { trackCache: false, hdrProbe: false, audioTranscode: false };
                    return (
                      <tr key={v.path} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderRadius: 4 }}>
                        <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.85)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRadius: '4px 0 0 4px' }} title={v.path}>
                          {v.path.split('/').pop()}
                          {v.isHdr && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: 'rgba(251,191,36,0.95)', verticalAlign: 'middle' }}>HDR</span>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                            <input type="checkbox" checked={sel.trackCache} onChange={e => { const next = new Map(previewSelection); next.set(v.path, { ...sel, trackCache: e.target.checked }); setPreviewSelection(next); }} style={{ display: 'none' }} />
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 18, height: 18, borderRadius: 4,
                              background: sel.trackCache ? 'rgba(129,140,248,0.9)' : 'rgba(255,255,255,0.06)',
                              border: `1.5px solid ${sel.trackCache ? 'rgba(129,140,248,1)' : 'rgba(255,255,255,0.15)'}`,
                              transition: 'all 0.15s', fontSize: 11, color: '#fff', fontWeight: 700,
                            }}>
                              {sel.trackCache && '✓'}
                            </span>
                            {!v.needsTrackCache && <span style={{ position: 'absolute', left: '100%', marginLeft: 4, fontSize: 9, color: 'rgba(74,222,128,0.6)' }} title="Bereits vorhanden">✓</span>}
                          </label>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                            <input type="checkbox" checked={sel.hdrProbe} onChange={e => { const next = new Map(previewSelection); next.set(v.path, { ...sel, hdrProbe: e.target.checked }); setPreviewSelection(next); }} style={{ display: 'none' }} />
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 18, height: 18, borderRadius: 4,
                              background: sel.hdrProbe ? 'rgba(129,140,248,0.9)' : 'rgba(255,255,255,0.06)',
                              border: `1.5px solid ${sel.hdrProbe ? 'rgba(129,140,248,1)' : 'rgba(255,255,255,0.15)'}`,
                              transition: 'all 0.15s', fontSize: 11, color: '#fff', fontWeight: 700,
                            }}>
                              {sel.hdrProbe && '✓'}
                            </span>
                            {!v.needsHdrProbe && <span style={{ position: 'absolute', left: '100%', marginLeft: 4, fontSize: 9, color: 'rgba(74,222,128,0.6)' }} title="Bereits vorhanden">✓</span>}
                          </label>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 8px', borderRadius: '0 4px 4px 0' }}>
                          {v.needsAudioTranscode ? (
                            <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }} title={`Inkompatibel: ${v.incompatibleCodecs.join(', ')}`}>
                              <input type="checkbox" checked={sel.audioTranscode} onChange={e => { const next = new Map(previewSelection); next.set(v.path, { ...sel, audioTranscode: e.target.checked }); setPreviewSelection(next); }} style={{ display: 'none' }} />
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 18, height: 18, borderRadius: 4,
                                background: sel.audioTranscode ? 'rgba(248,113,113,0.85)' : 'rgba(255,255,255,0.06)',
                                border: `1.5px solid ${sel.audioTranscode ? 'rgba(248,113,113,1)' : 'rgba(255,255,255,0.15)'}`,
                                transition: 'all 0.15s', fontSize: 11, color: '#fff', fontWeight: 700,
                              }}>
                                {sel.audioTranscode && '✓'}
                              </span>
                              <span style={{ fontSize: 9, color: 'rgba(248,113,113,0.7)' }}>{v.incompatibleCodecs.join(', ')}</span>
                            </label>
                          ) : (
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                {(() => {
                  let tc = 0, hp = 0, at = 0;
                  previewSelection.forEach(s => { if (s.trackCache) tc++; if (s.hdrProbe) hp++; if (s.audioTranscode) at++; });
                  const parts = [`${tc} Track-Cache`, `${hp} HDR-Probe`];
                  if (at > 0) parts.push(`${at} Audio→AAC`);
                  return parts.join(' · ');
                })()}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => setPreviewOpen(false)}>
                  Abbrechen
                </button>
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 12, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }}
                  disabled={warmingAll}
                  onClick={async () => {
                    const selected: Array<{ path: string; trackCache: boolean; hdrProbe: boolean; audioTranscode: boolean }> = [];
                    previewSelection.forEach((s, p) => {
                      if (s.trackCache || s.hdrProbe || s.audioTranscode) selected.push({ path: p, ...s });
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
