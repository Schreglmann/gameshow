import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { AssetCategory } from '@/types/config';
import { useTheme } from '@/context/ThemeContext';
import SessionTab from '@/components/backend/SessionTab';
import GamesTab from '@/components/backend/GamesTab';
import ConfigTab from '@/components/backend/ConfigTab';
import AssetsTab from '@/components/backend/AssetsTab';
import SystemTab from '@/components/backend/SystemTab';
import AnswersTab from '@/components/backend/AnswersTab';
import { UploadProvider, useUpload, type YtPlaylistTrack, type AudioCoverProgress } from '@/components/backend/UploadContext';
import { Lightbox } from '@/components/layout/Lightbox';
import { isUploadThrottled } from '@/services/backendApi';
import '@/admin.css';
import '@/backend.css';

type Tab = 'session' | 'games' | 'config' | 'assets' | 'system' | 'answers';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'session', label: 'Session', icon: '🎮' },
  { id: 'games', label: 'Spiele', icon: '🎲' },
  { id: 'config', label: 'Config', icon: '⚙️' },
  { id: 'assets', label: 'Assets', icon: '📁' },
];

const VALID_TABS = new Set<Tab>(['session', 'games', 'config', 'assets', 'system', 'answers']);
const VALID_ASSET_CATEGORIES = new Set<string>(['images', 'audio', 'background-music', 'videos']);

function parseHash(): { tab: Tab; file?: string; instance?: string; assetCategory?: AssetCategory } {
  const parts = window.location.hash.slice(1).split('/');
  const tab = (VALID_TABS.has(parts[0] as Tab) ? parts[0] : 'session') as Tab;
  const part1 = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  return {
    tab,
    file: part1,
    instance: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    assetCategory: (part1 && VALID_ASSET_CATEGORIES.has(part1)) ? part1 as AssetCategory : undefined,
  };
}

export default function AdminScreen() {
  return (
    <UploadProvider>
      <AdminScreenInner />
    </UploadProvider>
  );
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
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tracks]);

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
      {tracks.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
            {t.phase === 'done' ? '✓' : t.phase === 'processing' ? '~' : t.phase === 'resolving' ? '…' : `${i + 1}`}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: t.phase === 'done' ? 'rgba(74,222,128,0.7)' : 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title || 'Wird geladen…'}
            </div>
            <div className="upload-progress-track" style={{ height: 3, marginTop: 2 }}>
              <div
                className={`upload-progress-fill${t.phase === 'resolving' ? ' upload-progress-resolving' : ''}${t.phase === 'processing' ? ' upload-progress-processing' : ''}${t.phase === 'done' ? ' upload-progress-done' : ''}`}
                style={{ width: t.phase === 'downloading' ? `${t.percent}%` : t.phase === 'resolving' ? '100%' : '100%' }}
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
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
            {f.phase === 'done' ? '✓' : f.phase === 'error' ? '✕' : f.phase === 'searching' ? '…' : `${i + 1}`}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: f.phase === 'done' ? 'rgba(74,222,128,0.7)' : f.phase === 'error' ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.name}
            </div>
            <div className="upload-progress-track" style={{ height: 3, marginTop: 2 }}>
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

function UploadOverlay() {
  const { uploadProgress, abortUpload, ytDownloads, cancelYtDownload, dismissYtDownload, audioCoverDownloads, cancelAudioCoverFetch, dismissAudioCoverFetch, pendingCoverConfirm, respondCoverConfirm } = useUpload();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const hasContent = uploadProgress || ytDownloads.length > 0 || audioCoverDownloads.length > 0 || pendingCoverConfirm;
  if (!hasContent) return null;
  const isAudio = uploadProgress && (uploadProgress.category === 'audio' || uploadProgress.category === 'background-music');
  const isUploading = uploadProgress?.phase === 'uploading';
  return (
    <div className="upload-progress-overlay">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {uploadProgress && (
          <div className="upload-progress-box">
            <div className="upload-progress-label">
              <span>{uploadProgress.fileName}</span>
              <span>{uploadProgress.fileIndex + 1} / {uploadProgress.total}</span>
            </div>
            <div className="upload-progress-track">
              <div
                className={`upload-progress-fill${uploadProgress.phase === 'processing' ? ' upload-progress-processing' : ''}`}
                style={{ width: `${((uploadProgress.fileIndex * 100 + uploadProgress.filePercent) / uploadProgress.total)}%` }}
              />
            </div>
            {isUploading && uploadProgress.speed > 0 && uploadProgress.elapsed >= 5 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 12px', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6, fontFamily: 'monospace' }}>
                <span>{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.fileSize)}</span>
                <span>{formatBytes(uploadProgress.speed)}/s{isUploadThrottled() ? ' (gedrosselt)' : ''}</span>
                {uploadProgress.eta > 0 && <span>~{formatEta(uploadProgress.eta)} verbleibend</span>}
              </div>
            )}
            {uploadProgress.phase === 'processing' && isAudio && (
              <div className="upload-progress-phase">🎵 Audio wird normalisiert — kann einige Sekunden dauern…</div>
            )}
            {uploadProgress.phase === 'processing' && !isAudio && (
              <div className="upload-progress-phase">Datei wird gespeichert…</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={abortUpload}>✕ Abbrechen</button>
            </div>
          </div>
        )}
        {ytDownloads.map(dl => {
          const isPlaylist = !!dl.playlistTitle;

          // ── Single-video download (unchanged) ──
          if (!isPlaylist) return (
            <div key={dl.id} className="upload-progress-box">
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>YouTube Download</div>
              <div className="upload-progress-label">
                <span>{dl.title || 'Wird geladen…'}</span>
                <span style={{ fontSize: 11 }}>
                  {dl.phase === 'downloading' && `${Math.round(dl.percent)}%`}
                  {dl.phase === 'done' && '✓'}
                  {dl.phase === 'error' && '✕'}
                </span>
              </div>
              {dl.phase !== 'resolving' && (
                <div className="upload-progress-track">
                  <div
                    className={`upload-progress-fill${dl.phase === 'processing' ? ' upload-progress-processing' : ''}${dl.phase === 'done' ? ' upload-progress-done' : ''}${dl.phase === 'error' ? ' upload-progress-error' : ''}`}
                    style={{ width: dl.phase === 'downloading' ? `${dl.percent}%` : '100%' }}
                  />
                </div>
              )}
              {dl.phase === 'resolving' && (
                <div className="upload-progress-phase">Video wird vorbereitet…</div>
              )}
              {dl.phase === 'downloading' && dl.category === 'videos' && (
                <div className="upload-progress-phase">Video wird von YouTube heruntergeladen…</div>
              )}
              {dl.phase === 'downloading' && dl.category !== 'videos' && (
                <div className="upload-progress-phase">Audio wird von YouTube heruntergeladen…</div>
              )}
              {dl.phase === 'processing' && dl.category === 'videos' && (
                <div className="upload-progress-phase">Video wird gespeichert…</div>
              )}
              {dl.phase === 'processing' && dl.category !== 'videos' && (
                <div className="upload-progress-phase">🎵 Lautstärke wird normalisiert…</div>
              )}
              {dl.phase === 'done' && (
                <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.9)', marginTop: 2 }}>Fertig — Datei wurde gespeichert</div>
              )}
              {dl.phase === 'error' && (
                <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.9)', marginTop: 2 }}>{dl.error}</div>
              )}
              {dl.phase !== 'done' && dl.phase !== 'error' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => cancelYtDownload(dl.id)}>✕ Abbrechen</button>
                </div>
              )}
              {(dl.phase === 'done' || dl.phase === 'error') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => dismissYtDownload(dl.id)}>✕</button>
                </div>
              )}
            </div>
          );

          // ── Playlist download — per-track progress bars ──
          const tracks = dl.tracks ?? [];
          const doneCount = tracks.filter(t => t.phase === 'done').length;
          return (
            <div key={dl.id} className="upload-progress-box" style={{ maxWidth: 560 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>YouTube Playlist: {dl.playlistTitle}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                  {dl.phase === 'done' ? '✓' : dl.phase === 'error' ? '✕' : `${doneCount} / ${dl.trackCount ?? '?'}`}
                </div>
              </div>
              {tracks.length > 0 && <PlaylistTrackList tracks={tracks} />}
              {dl.phase === 'resolving' && tracks.length === 0 && (
                <div className="upload-progress-phase">Playlist wird geladen…</div>
              )}
              {dl.phase === 'done' && (
                <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.9)', marginTop: 2 }}>
                  Fertig — {dl.trackCount} Tracks in '{dl.playlistTitle}' gespeichert
                </div>
              )}
              {dl.phase === 'error' && (
                <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.9)', marginTop: 2 }}>{dl.error}</div>
              )}
              {dl.phase !== 'done' && dl.phase !== 'error' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => cancelYtDownload(dl.id)}>✕ Abbrechen</button>
                </div>
              )}
              {(dl.phase === 'done' || dl.phase === 'error') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => dismissYtDownload(dl.id)}>✕</button>
                </div>
              )}
            </div>
          );
        })}
        {audioCoverDownloads.map(dl => {
          const doneCount = dl.files.filter(f => f.phase === 'done').length;
          const errorCount = dl.files.filter(f => f.phase === 'error').length;
          const pct = dl.fileCount > 0 ? ((doneCount + errorCount) / dl.fileCount) * 100 : 0;
          return (
            <div key={dl.id} className="upload-progress-box" style={{ maxWidth: 560 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Audio Covers</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                  {dl.phase === 'done' ? '✓' : dl.phase === 'error' ? '✕' : `${doneCount} / ${dl.fileCount}`}
                </div>
              </div>
              <div className="upload-progress-track">
                <div
                  className={`upload-progress-fill${dl.phase === 'done' ? ' upload-progress-done' : ''}${dl.phase === 'error' ? ' upload-progress-error' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {dl.files.length > 0 && <AudioCoverTrackList files={dl.files} />}
              {dl.phase === 'searching' && !pendingCoverConfirm && (
                <div className="upload-progress-phase">Cover wird gesucht…</div>
              )}
              {dl.phase === 'done' && (
                <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.9)', marginTop: 2 }}>
                  Fertig — {doneCount} Cover geladen{errorCount > 0 ? `, ${errorCount} nicht gefunden` : ''}
                </div>
              )}
              {dl.phase === 'error' && (
                <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.9)', marginTop: 2 }}>{dl.error}</div>
              )}
              {dl.phase !== 'done' && dl.phase !== 'error' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => cancelAudioCoverFetch(dl.id)}>✕ Abbrechen</button>
                </div>
              )}
              {(dl.phase === 'done' || dl.phase === 'error') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={() => dismissAudioCoverFetch(dl.id)}>✕</button>
                </div>
              )}
            </div>
          );
        })}
        {pendingCoverConfirm && (
          <div className="upload-progress-box" style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 11, color: 'var(--gold-warm)', marginBottom: 6 }}>
              Unsicherer Treffer — bitte bestätigen
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
              <strong style={{ color: 'rgba(255,255,255,0.85)' }}>{pendingCoverConfirm.fileName}</strong>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <img
                src={pendingCoverConfirm.coverPreview}
                alt="Cover preview"
                style={{ width: 60, height: 60, borderRadius: 4, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }}
                onClick={() => setLightboxSrc(pendingCoverConfirm.coverPreview)}
              />
              <div style={{ fontSize: 12 }}>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Künstler:</span> {pendingCoverConfirm.foundArtist}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Titel:</span> {pendingCoverConfirm.foundTrack}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>via {pendingCoverConfirm.source}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="be-icon-btn" style={{ fontSize: 12, padding: '6px 14px', lineHeight: 1 }} onClick={() => respondCoverConfirm(false)}>Ablehnen</button>
              <button className="be-btn-primary" style={{ fontSize: 12, padding: '6px 14px', lineHeight: 1 }} onClick={() => respondCoverConfirm(true)}>Übernehmen</button>
            </div>
          </div>
        )}
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

function AdminScreenInner() {
  const { adminTheme } = useTheme();
  const initial = parseHash();
  const [activeTab, setActiveTab] = useState<Tab>(initial.tab);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gamesKey, setGamesKey] = useState(0);
  const [gamesNav, setGamesNav] = useState<{ file?: string; instance?: string; questionIndex?: number }>(
    initial.tab === 'games' ? { file: initial.file, instance: initial.instance } : {}
  );
  const [assetsCategory, setAssetsCategory] = useState<AssetCategory>(
    initial.tab === 'assets' && initial.assetCategory ? initial.assetCategory : 'images'
  );
  // Sync state → hash (only if different)
  useEffect(() => {
    const parts: string[] = [activeTab];
    if (activeTab === 'games' && gamesNav.file) {
      parts.push(encodeURIComponent(gamesNav.file));
      if (gamesNav.instance) parts.push(encodeURIComponent(gamesNav.instance));
    } else if (activeTab === 'assets') {
      parts.push(encodeURIComponent(assetsCategory));
    }
    const target = '#' + parts.join('/');
    if (window.location.hash !== target) {
      window.location.hash = parts.join('/');
    }
  }, [activeTab, gamesNav, assetsCategory]);

  // Sync hash → state (browser back/forward)
  const syncFromHash = useCallback(() => {
    const parsed = parseHash();
    setActiveTab(parsed.tab);
    if (parsed.tab === 'games') {
      setGamesNav(parsed.file ? { file: parsed.file, instance: parsed.instance } : {});
    } else if (parsed.tab === 'assets' && parsed.assetCategory) {
      setAssetsCategory(parsed.assetCategory);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [syncFromHash]);

  const switchTab = (tab: Tab) => {
    if (tab === 'games') {
      setGamesKey(k => k + 1);
      setGamesNav({});
    }
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleGamesNavigate = (file: string | null, instance?: string, questionIndex?: number) => {
    setGamesNav(file ? { file, instance, questionIndex } : {});
  };

  const handleAssetNavigateToGame = (fileName: string, instance?: string, questionIndex?: number) => {
    setGamesKey(k => k + 1);
    setGamesNav({ file: fileName, instance, questionIndex });
    setActiveTab('games');
    setSidebarOpen(false);
  };

  return (
    <div className="admin-shell" data-theme={adminTheme}>
      <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Menü öffnen">☰</button>
      <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`admin-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="admin-sidebar-header">
          <span className="admin-sidebar-title">Admin</span>
          <Link to="/" className="admin-back-link">← Home</Link>
        </div>
        <nav className="admin-nav">
          <Link to="/" className="admin-nav-item admin-nav-home" onClick={() => setSidebarOpen(false)}>
            <span className="admin-nav-icon">🏠</span>
            <span>Home</span>
          </Link>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`admin-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              <span className="admin-nav-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
          <div className="admin-nav-divider" />
          <button
            className={`admin-nav-item ${activeTab === 'answers' ? 'active' : ''}`}
            onClick={() => switchTab('answers')}
          >
            <span className="admin-nav-icon">📝</span>
            <span>Antworten</span>
          </button>
          <div className="admin-nav-spacer" />
          <button
            className={`admin-nav-item ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => switchTab('system')}
          >
            <span className="admin-nav-icon">📊</span>
            <span>System</span>
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        {activeTab === 'session' && <div className="admin-tab-pane"><SessionTab /></div>}
        {activeTab === 'answers' && <div className="admin-tab-pane"><AnswersTab /></div>}
        {activeTab === 'games' && (
          <div className="admin-tab-pane">
            <GamesTab
              key={gamesKey}
              onGoToAssets={() => switchTab('assets')}
              initialFile={gamesNav.file}
              initialInstance={gamesNav.instance}
              initialQuestion={gamesNav.questionIndex}
              onNavigate={handleGamesNavigate}
            />
          </div>
        )}
        {activeTab === 'config' && <div className="admin-tab-pane"><ConfigTab /></div>}
        {activeTab === 'assets' && (
          <div className="admin-tab-pane">
            <AssetsTab initialCategory={assetsCategory} onCategoryChange={setAssetsCategory} onNavigateToGame={handleAssetNavigateToGame} />
          </div>
        )}
        {activeTab === 'system' && <div className="admin-tab-pane"><SystemTab /></div>}
      </main>
      <UploadOverlay />
    </div>
  );
}
