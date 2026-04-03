import { useState, useEffect, useRef } from 'react';
import type { AssetCategory, AssetFolder } from '@/types/config';
import { fetchAssets, fetchVideoCover, deleteAsset, moveAsset, fetchAssetUsages, createAssetFolder, fetchAssetStorage, probeVideo, type VideoTrackInfo } from '@/services/backendApi';
import { useTranscode } from './TranscodeContext';
import StatusMessage from './StatusMessage';
import MiniAudioPlayer from './MiniAudioPlayer';
import AudioTrimTimeline from './AudioTrimTimeline';
import { useUpload } from './UploadContext';

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

/**
 * Derive the poster slug from a video filename.
 * Must match videoFilenameToSlug in server/movie-posters.ts exactly.
 */
function videoFilenameToSlug(filename: string): string {
  const basename = filename.replace(/\.[^.]+$/, '');
  return basename
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[._]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Video thumbnail: shows movie poster if available, otherwise a non-black
 * video frame (seeks to 10% of duration, capped at 5 s).
 */
function VideoThumb({ file, src }: { file: string; src: string }) {
  const [showVideo, setShowVideo] = useState(false);
  const slug = videoFilenameToSlug(file);
  if (!showVideo) {
    return (
      <img
        src={`/images/movie-posters/${slug}.jpg`}
        className="asset-file-video-thumb"
        draggable={false}
        onError={() => setShowVideo(true)}
      />
    );
  }
  return (
    <video
      src={src}
      muted
      disablePictureInPicture
      preload="metadata"
      className="asset-file-video-thumb"
      draggable={false}
      onLoadedMetadata={e => {
        const vid = e.currentTarget;
        vid.currentTime = Math.min(vid.duration * 0.1, 5);
      }}
    />
  );
}

const CATEGORIES: { id: AssetCategory; label: string; accept: string; mediaType: 'image' | 'audio' | 'video' }[] = [
  { id: 'images',           label: 'Bilder',           accept: 'image/*', mediaType: 'image' },
  { id: 'audio',            label: 'Audio',            accept: 'audio/*', mediaType: 'audio' },
  { id: 'background-music', label: 'Hintergrundmusik', accept: 'audio/*', mediaType: 'audio' },
  { id: 'videos',           label: 'Videos',           accept: 'video/*', mediaType: 'video' },
];

interface GameUsage { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; }
interface PosterModal { fileName: string; status: 'loading' | 'done' | 'error'; logs: string[]; posterPath: string | null; error?: string; }
interface MoveState { filePath: string; name: string; }

// Collect all folder paths recursively
function getAllFolderPaths(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [p, ...getAllFolderPaths(f.subfolders, p)];
  });
}

function DropZone({
  onFileDrop,
  onAssetDrop,
  className = '',
  noClick = false,
  style,
  children,
}: {
  onFileDrop: (files: File[]) => void;
  onAssetDrop?: (assetPath: string) => void;
  className?: string;
  noClick?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const counter = useRef(0);
  const divRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const callbackRef = useRef(onFileDrop);
  callbackRef.current = onFileDrop;
  const assetDropRef = useRef(onAssetDrop);
  assetDropRef.current = onAssetDrop;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      counter.current++;
      if (counter.current === 1) setIsDragActive(true);
    };
    const onOver = (e: DragEvent) => { e.preventDefault(); };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      counter.current--;
      if (counter.current <= 0) { counter.current = 0; setIsDragActive(false); }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      counter.current = 0;
      setIsDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        callbackRef.current(files);
      } else {
        const assetPath = e.dataTransfer?.getData('text/asset-path');
        if (assetPath && assetDropRef.current) assetDropRef.current(assetPath);
      }
    };

    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={divRef}
      className={`${className}${isDragActive ? ' dragover' : ''}`.trim()}
      style={style}
      onClick={noClick ? undefined : () => inputRef.current?.click()}
    >
      {!noClick && (
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => { onFileDrop(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
      )}
      {children}
    </div>
  );
}

interface AssetsTabProps {
  initialCategory?: AssetCategory;
  onCategoryChange?: (category: AssetCategory) => void;
}

export default function AssetsTab({ initialCategory, onCategoryChange }: AssetsTabProps = {}) {
  const [activeCategory, setActiveCategory] = useState<AssetCategory>(initialCategory ?? 'images');

  const handleCategoryChange = (cat: AssetCategory) => {
    setActiveCategory(cat);
    onCategoryChange?.(cat);
  };

  // Sync with parent navigation (browser back/forward)
  useEffect(() => {
    if (initialCategory && initialCategory !== activeCategory) {
      setActiveCategory(initialCategory);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategory]);
  const [files, setFiles] = useState<string[]>([]);
  const [subfolders, setSubfolders] = useState<AssetFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState('');
  const [newSubfolderTarget, setNewSubfolderTarget] = useState<string | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);
  const [previewUsages, setPreviewUsages] = useState<GameUsage[] | null>(null);
  const [audioPreview, setAudioPreview] = useState<{ filePath: string; src: string } | null>(null);
  const [audioPreviewUsages, setAudioPreviewUsages] = useState<GameUsage[] | null>(null);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [videoPreview, setVideoPreview] = useState<{ filePath: string; src: string } | null>(null);
  const [videoPreviewUsages, setVideoPreviewUsages] = useState<GameUsage[] | null>(null);
  const [videoPreviewDuration, setVideoPreviewDuration] = useState(0);
  const [videoTracks, setVideoTracks] = useState<VideoTrackInfo[]>([]);
  const [videoNeedsTranscode, setVideoNeedsTranscode] = useState(false);
  const [videoPreviewTrack, setVideoPreviewTrack] = useState<number | null>(null);
  const { jobs: transcodeJobs, startJob: startTranscodeJob } = useTranscode();
  const [videoTranscodeError, setVideoTranscodeError] = useState('');
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [posterModal, setPosterModal] = useState<PosterModal | null>(null);
  const [storageMode, setStorageMode] = useState<'nas' | 'local' | null>(null);
  const [ytModal, setYtModal] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytSubfolder, setYtSubfolder] = useState('');
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef  = useRef<HTMLElement | null>(null);
  const { startUpload, startYtDownload } = useUpload();
  const currentCat = CATEGORIES.find(c => c.id === activeCategory)!;

  // Find the actual scrollable container (admin-tab-pane) — window doesn't scroll here
  useEffect(() => {
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') { scrollerRef.current = el; break; }
      el = el.parentElement;
    }
  }, []);

  // Poll storage mode every 5s so the badge reflects live NAS status
  useEffect(() => {
    fetchAssetStorage().then(r => setStorageMode(r.mode)).catch(() => {});
    const id = setInterval(() => {
      fetchAssetStorage().then(r => setStorageMode(r.mode)).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);


  // Auto-scroll during drag: scroll the container, not the window
  useEffect(() => {
    let dragY = -1;
    let timer: ReturnType<typeof setInterval> | null = null;
    const TOP_ZONE = 100;
    const BOT_ZONE = 300;
    const MAX_SPEED = 30;
    const MIN_FRAC = 0.35;

    const tick = () => {
      const scroller = scrollerRef.current;
      if (dragY < 0 || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const relY = dragY - rect.top;   // cursor Y relative to container top
      const h    = rect.height;
      let speed = 0;
      if (relY < TOP_ZONE) {
        const t = 1 - relY / TOP_ZONE;
        speed = -MAX_SPEED * (MIN_FRAC + (1 - MIN_FRAC) * t);
      } else if (relY > h - BOT_ZONE) {
        const t = (relY - (h - BOT_ZONE)) / BOT_ZONE;
        speed = MAX_SPEED * (MIN_FRAC + (1 - MIN_FRAC) * t);
      }
      if (speed !== 0) scroller.scrollBy(0, speed);
    };

    const onPointerMove = (e: PointerEvent) => { dragY = e.clientY; };
    const onDragOver    = (e: DragEvent)    => { e.preventDefault(); if (e.clientY > 0) dragY = e.clientY; };
    const onDrag        = (e: DragEvent)    => { if (e.clientY > 0) dragY = e.clientY; };
    const onStart = () => { dragY = -1; timer = setInterval(tick, 16); };
    const onStop  = () => { dragY = -1; if (timer) { clearInterval(timer); timer = null; } };

    document.addEventListener('dragstart',   onStart);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('drag',        onDrag);
    document.addEventListener('dragover',    onDragOver);
    document.addEventListener('dragend',     onStop);
    document.addEventListener('drop',        onStop);
    return () => {
      document.removeEventListener('dragstart',   onStart);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('drag',        onDrag);
      document.removeEventListener('dragover',    onDragOver);
      document.removeEventListener('dragend',     onStop);
      document.removeEventListener('drop',        onStop);
      if (timer) clearInterval(timer);
    };
  }, []);


  const load = async (opts?: { showLoading?: boolean; preserveScroll?: boolean }) => {
    const { showLoading = true, preserveScroll = false } = opts ?? {};
    const scroller = scrollerRef.current;
    const scrollTop = scroller?.scrollTop ?? 0;
    if (showLoading) setLoading(true);
    try {
      const data = await fetchAssets(activeCategory);
      setFiles(data.files ?? []);
      setSubfolders(data.subfolders ?? []);
    } catch (e) {
      showMsg('error', `Fehler beim Laden: ${(e as Error).message}`);
    } finally {
      if (showLoading) setLoading(false);
      if (preserveScroll) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scrollTop;
      }));
    }
  };

  useEffect(() => { load(); }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const isAudioCategory = activeCategory === 'audio' || activeCategory === 'background-music';

  const handleUpload = async (uploads: File[], subfolder?: string) => {
    if (!uploads.length) return;
    try {
      const result = await startUpload(activeCategory, uploads, subfolder);
      if (result.success) {
        showMsg('success', `✅ ${result.count} Datei${result.count !== 1 ? 'en' : ''} hochgeladen`);
      }
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Upload fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const handleYoutubeDownload = () => {
    const trimmedUrl = ytUrl.trim();
    if (!trimmedUrl) return;
    startYtDownload(activeCategory, trimmedUrl, ytSubfolder || undefined, () => {
      load({ showLoading: false, preserveScroll: true });
    });
    setYtModal(false);
    setYtUrl('');
    setYtSubfolder('');
  };

  const handleDelete = async (filePath: string, label: string) => {
    if (!confirm(`"${label}" wirklich löschen?`)) return;
    try {
      await deleteAsset(activeCategory, filePath);
      showMsg('success', `🗑️ "${label}" gelöscht`);
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
    }
  };

  const handleMoveAsset = async (fromPath: string, toFolderPath?: string) => {
    const fileName = fromPath.split('/').pop()!;
    const targetPath = toFolderPath ? `${toFolderPath}/${fileName}` : fileName;
    if (fromPath === targetPath) return;
    try {
      await moveAsset(activeCategory, fromPath, targetPath);
      showMsg('success', `✅ "${fileName}" verschoben`);
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
    }
  };

  const handleMove = async () => {
    if (!moveState) return;
    const targetPath = moveTarget.trim()
      ? `${moveTarget.trim()}/${moveState.name}`
      : moveState.name;
    try {
      await moveAsset(activeCategory, moveState.filePath, targetPath);
      showMsg('success', `✅ "${moveState.name}" verschoben`);
      setMoveState(null);
      setMoveTarget('');
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
    }
  };

  const handleFetchCover = async (e: React.MouseEvent, fileName: string) => {
    e.stopPropagation();
    setPosterModal({ fileName, status: 'loading', logs: [], posterPath: null });
    try {
      const result = await fetchVideoCover(fileName);
      setPosterModal({ fileName, status: 'done', logs: result.logs, posterPath: result.posterPath });
      if (result.posterPath) load({ showLoading: false, preserveScroll: true });
    } catch (err) {
      const logs = (err as { logs?: string[] }).logs ?? [];
      setPosterModal({ fileName, status: 'error', logs, posterPath: null, error: (err as Error).message });
    }
  };

  const openPreview = async (filePath: string) => {
    setPreviewImage(filePath);
    setPreviewDims(null);
    setPreviewUsages(null);
    const usages = await fetchAssetUsages(activeCategory, filePath).catch(() => []);
    setPreviewUsages(usages);
  };

  const openAudioPreview = async (filePath: string, src: string) => {
    setAudioPreview({ filePath, src });
    setAudioPreviewUsages(null);
    setAudioPreviewDuration(0);
    const usages = await fetchAssetUsages(activeCategory, filePath).catch(() => []);
    setAudioPreviewUsages(usages);
  };

  const openVideoPreview = async (filePath: string, src: string) => {
    setVideoPreview({ filePath, src });
    setVideoPreviewUsages(null);
    setVideoPreviewDuration(0);
    setVideoTracks([]);
    setVideoNeedsTranscode(false);
    setVideoPreviewTrack(null);
    setVideoTranscodeError('');
    const [usages, probe] = await Promise.all([
      fetchAssetUsages(activeCategory, filePath).catch(() => []),
      probeVideo(filePath).catch(() => null),
    ]);
    setVideoPreviewUsages(usages);
    if (probe) {
      setVideoTracks(probe.tracks);
      setVideoNeedsTranscode(probe.needsTranscode);
    }
  };

  const handleVideoTranscode = async () => {
    if (!videoPreview) return;
    setVideoTranscodeError('');
    try {
      await startTranscodeJob(videoPreview.filePath);
    } catch (e) {
      setVideoTranscodeError((e as Error).message);
    }
  };

  // When a transcode job for the currently previewed video finishes, re-probe
  const previewJob = videoPreview ? transcodeJobs.get(videoPreview.filePath) : undefined;
  const prevJobStatusRef = useRef<string | undefined>();
  useEffect(() => {
    if (previewJob?.status === 'done' && prevJobStatusRef.current === 'running') {
      // Job just finished — re-probe tracks
      probeVideo(videoPreview!.filePath).then(probe => {
        setVideoTracks(probe.tracks);
        setVideoNeedsTranscode(probe.needsTranscode);
      }).catch(() => {});
    }
    prevJobStatusRef.current = previewJob?.status;
  }, [previewJob?.status]);

  const closeVideoPreview = () => {
    videoPreviewRef.current?.pause();
    setVideoPreviewLoading(false);
    setVideoPreview(null);
  };

  // Programmatic video source switching — preserves playback position on track change
  const videoPreviewSrc = videoPreview
    ? (videoPreviewTrack !== null
      ? videoPreview.src.replace(/^\/videos\//, `/videos-track/${videoPreviewTrack}/`)
      : videoPreview.src)
    : null;
  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !videoPreviewSrc) return;

    const savedTime = video.currentTime;
    const wasPlaying = !video.paused;
    video.src = videoPreviewSrc;
    video.load();

    const onReady = () => {
      setVideoPreviewDuration(video.duration);
      // Restore position on track switch (not on first open)
      if (savedTime > 0 && savedTime < video.duration) {
        video.currentTime = savedTime;
      }
      if (wasPlaying || savedTime === 0) {
        video.play().catch(() => {});
      }
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, [videoPreviewSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track buffering state for the video preview
  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !videoPreview) return;
    const onWaiting = () => setVideoPreviewLoading(true);
    const onReady = () => setVideoPreviewLoading(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('seeked', onReady);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('seeked', onReady);
    };
  }, [videoPreview]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (subfolders.find(s => s.name === name)) return;
    try {
      await createAssetFolder(activeCategory, name);
      setSubfolders(prev => [...prev, { name, files: [], subfolders: [] }]);
      setExpandedFolders(prev => new Set([...prev, name]));
      setNewFolderName('');
      showMsg('success', `Ordner "${name}" erstellt`);
    } catch {
      showMsg('error', `Ordner konnte nicht erstellt werden`);
    }
  };

  const createSubfolder = async (parentPath: string) => {
    const name = newSubfolderName.trim();
    if (!name) return;
    try {
      await createAssetFolder(activeCategory, `${parentPath}/${name}`);
      const insert = (folders: AssetFolder[], target: string, cur: string): AssetFolder[] =>
        folders.map(f => {
          const fPath = cur ? `${cur}/${f.name}` : f.name;
          if (fPath === target) {
            if (f.subfolders.find(s => s.name === name)) return f;
            return { ...f, subfolders: [...f.subfolders, { name, files: [], subfolders: [] }] };
          }
          return { ...f, subfolders: insert(f.subfolders, target, fPath) };
        });
      setSubfolders(prev => insert(prev, parentPath, ''));
      setExpandedFolders(prev => new Set([...prev, `${parentPath}/${name}`]));
      setNewSubfolderTarget(null);
      setNewSubfolderName('');
      showMsg('success', `Unterordner "${name}" erstellt`);
    } catch {
      showMsg('error', `Unterordner konnte nicht erstellt werden`);
    }
  };

  const toggleFolder = (folderPath: string) =>
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(folderPath) ? next.delete(folderPath) : next.add(folderPath);
      return next;
    });

  const renderAudioItem = (file: string, filePath: string, src: string) => (
    <div
      key={filePath}
      className="asset-file-item"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/asset-path', filePath);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => openAudioPreview(filePath, src)}
    >
      <span className="asset-file-icon">🎵</span>
      <span className="asset-file-name" title={file}>{file}</span>
      <MiniAudioPlayer src={src} className="asset-file-audio" />
      <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
      <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
    </div>
  );

  const renderVideoItem = (file: string, filePath: string, src: string) => (
    <div
      key={filePath}
      className="asset-file-item"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/asset-path', filePath);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => openVideoPreview(filePath, src)}
    >
      <span className="asset-file-icon">🎬</span>
      <span className="asset-file-name" title={file}>{file}</span>
      {transcodeJobs.get(filePath)?.status === 'running' && (() => {
        const j = transcodeJobs.get(filePath)!;
        const eta = j.percent > 2 && j.elapsed > 0 ? (j.elapsed / j.percent) * (100 - j.percent) : 0;
        const etaStr = eta >= 60 ? `${Math.floor(eta / 60)}m` : eta > 0 ? `${Math.ceil(eta)}s` : '';
        return (
          <span style={{ fontSize: 10, color: 'rgba(129,140,248,0.9)', background: 'rgba(129,140,248,0.12)', padding: '1px 6px', borderRadius: 3, flexShrink: 0 }}>
            🔄 {j.percent}%{etaStr ? ` · ${etaStr}` : ''}
          </span>
        );
      })()}
      <VideoThumb file={file} src={src} />
      <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => handleFetchCover(e, file)} title="Filmcover laden">🖼</button>
      <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
      <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
    </div>
  );

  const renderFolder = (folder: AssetFolder, folderPath: string, depth: number) => {
    const isExpanded = expandedFolders.has(folderPath);
    const hasContent = folder.files.length > 0 || folder.subfolders.length > 0;
    const countLabel = [
      folder.files.length > 0 ? `${folder.files.length} Datei${folder.files.length !== 1 ? 'en' : ''}` : '',
      folder.subfolders.length > 0 ? `${folder.subfolders.length} Ordner` : '',
    ].filter(Boolean).join(' · ') || 'leer';

    return (
      <DropZone
        key={folderPath}
        className="asset-folder"
        style={depth > 0 ? { marginLeft: 20, marginBottom: 4 } : undefined}
        onFileDrop={files => handleUpload(files, folderPath)}
        onAssetDrop={assetPath => handleMoveAsset(assetPath, folderPath)}
        noClick
      >
        <div className="asset-folder-header" onClick={() => toggleFolder(folderPath)}>
          <span className={`asset-folder-chevron ${isExpanded ? 'open' : ''}`}>▶</span>
          <span className="asset-folder-name">{folder.name}</span>
          <span className="asset-folder-count">{countLabel}</span>
          <label className="be-icon-btn" style={{ cursor: 'pointer', fontSize: 12 }} title="Datei hochladen" onClick={e => e.stopPropagation()}>
            Upload
            <input
              type="file"
              accept={currentCat.accept}
              multiple
              style={{ display: 'none' }}
              onChange={e => { handleUpload(Array.from(e.target.files ?? []), folderPath); e.target.value = ''; }}
            />
          </label>
          <button
            className="be-icon-btn"
            style={{ fontSize: 15 }}
            onClick={e => { e.stopPropagation(); setNewSubfolderTarget(folderPath); setNewSubfolderName(''); }}
            title="Unterordner erstellen"
          >📁+</button>
          <button
            className="be-delete-btn"
            onClick={e => { e.stopPropagation(); handleDelete(folderPath, folder.name); }}
            title="Ordner löschen"
          >🗑</button>
        </div>

        {isExpanded && (
          <div className="asset-folder-files">
            {newSubfolderTarget === folderPath && (
              <div className="be-list-row" style={{ marginBottom: 8 }}>
                <input
                  className="be-input"
                  placeholder="Unterordner-Name"
                  value={newSubfolderName}
                  autoFocus
                  onChange={e => setNewSubfolderName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createSubfolder(folderPath);
                    if (e.key === 'Escape') setNewSubfolderTarget(null);
                  }}
                />
                <button className="be-icon-btn" style={{ fontSize: 15 }} onClick={() => createSubfolder(folderPath)}>📁+</button>
                <button className="be-icon-btn" onClick={() => setNewSubfolderTarget(null)}>✕</button>
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'image' && (
              <div className="asset-image-grid">
                {folder.files.map(file => (
                  <div
                    key={file}
                    className="asset-image-card"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/asset-path', `${folderPath}/${file}`);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => openPreview(`${folderPath}/${file}`)}
                  >
                    <img src={`/${activeCategory}/${folderPath}/${file}`} alt={file} loading="lazy" draggable={false} />
                    <div className="asset-image-card-footer">
                      <span className="asset-image-card-name" title={file}>{file}</span>
                      <button
                        className="be-icon-btn"
                        style={{ width: 24, height: 24, fontSize: 11 }}
                        onClick={e => { e.stopPropagation(); setMoveState({ filePath: `${folderPath}/${file}`, name: file }); setMoveTarget(''); }}
                        title="Verschieben"
                      >→</button>
                      <button
                        className="be-delete-btn"
                        onClick={e => { e.stopPropagation(); handleDelete(`${folderPath}/${file}`, file); }}
                        title="Löschen"
                        style={{ width: 24, height: 24, fontSize: 13 }}
                      >🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'audio' && (
              <div className="asset-file-list">
                {folder.files.map(file =>
                  renderAudioItem(file, `${folderPath}/${file}`, `/${activeCategory}/${folderPath}/${file}`)
                )}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'video' && (
              <div className="asset-file-list">
                {folder.files.map(file =>
                  renderVideoItem(file, `${folderPath}/${file}`, `/${activeCategory}/${folderPath}/${file}`)
                )}
              </div>
            )}

            {!hasContent && (
              <label className="upload-zone" style={{ margin: 0, cursor: 'pointer' }}>
                Dateien hier ablegen oder klicken zum Hochladen
                <input
                  type="file"
                  accept={currentCat.accept}
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { handleUpload(Array.from(e.target.files ?? []), folderPath); e.target.value = ''; }}
                />
              </label>
            )}

            {folder.subfolders.map(sub => renderFolder(sub, `${folderPath}/${sub.name}`, depth + 1))}
          </div>
        )}
      </DropZone>
    );
  };

  const allFolderPaths = getAllFolderPaths(subfolders);

  return (
    <div ref={containerRef}>
      <StatusMessage message={message} />

      <div className="asset-category-tabs">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`asset-category-btn ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.label}
          </button>
        ))}
        {storageMode && (
          <span className={`asset-storage-badge asset-storage-badge--${storageMode}`}>
            {storageMode === 'nas' ? '⬡ NAS' : '⬡ Lokal'}
          </span>
        )}
      </div>

      {loading && <div className="be-loading">Lade...</div>}

      {!loading && (
        <>
          <DropZone
            className="upload-zone"
            style={{ marginBottom: 16 }}
            onFileDrop={files => handleUpload(files)}
            onAssetDrop={assetPath => handleMoveAsset(assetPath)}
          >
            <span style={{ fontSize: 24, display: 'block', marginBottom: 6 }}>
              {currentCat.mediaType === 'image' ? '🖼️' : currentCat.mediaType === 'video' ? '🎬' : '🎵'}
            </span>
            Dateien hier ablegen oder klicken zum Auswählen
            {isAudioCategory && (
              <button
                className="yt-download-btn"
                onClick={e => { e.stopPropagation(); setYtModal(true); setYtUrl(''); setYtSubfolder(''); }}
              >
                <span className="yt-download-btn-icon">▶</span>
                YouTube
              </button>
            )}
          </DropZone>

          <div>
            <div className="be-list-row" style={{ marginBottom: 16 }}>
              <input
                className="be-input"
                placeholder="Neuer Ordnername"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()}
              />
              <button className="be-icon-btn" onClick={createFolder}>+ Ordner</button>
            </div>

            {subfolders.map(folder => renderFolder(folder, folder.name, 0))}
          </div>

          {(
            subfolders.length === 0 ? (
              // No subfolders: flat view, root upload zone at top is the drop target
              <>
                {currentCat.mediaType === 'image' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Bilder vorhanden</div>
                    : (
                      <div className="asset-image-grid">
                        {files.map(file => (
                          <div
                            key={file}
                            className="asset-image-card"
                            draggable
                            onDragStart={e => { e.dataTransfer.setData('text/asset-path', file); e.dataTransfer.effectAllowed = 'move'; }}
                            onClick={() => openPreview(file)}
                          >
                            <img src={`/${activeCategory}/${file}`} alt={file} loading="lazy" draggable={false} />
                            <div className="asset-image-card-footer">
                              <span className="asset-image-card-name" title={file}>{file}</span>
                              <button className="be-icon-btn" style={{ width: 24, height: 24, fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath: file, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
                              <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(file, file); }} title="Löschen" style={{ width: 24, height: 24, fontSize: 13 }}>🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                )}
                {currentCat.mediaType === 'audio' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Audiodateien vorhanden</div>
                    : <div className="asset-file-list">{files.map(file => renderAudioItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
                {currentCat.mediaType === 'video' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Videos vorhanden</div>
                    : <div className="asset-file-list">{files.map(file => renderVideoItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
              </>
            ) : (
              // Has subfolders: show Stammordner as a DropZone so drag-to-root works without scrolling up
              <DropZone
                className="asset-root"
                onFileDrop={filesArg => handleUpload(filesArg)}
                onAssetDrop={assetPath => handleMoveAsset(assetPath)}
                noClick
              >
                <div className="asset-root-header">
                  <span className="asset-root-count">
                    {files.length > 0 ? `${files.length} Datei${files.length !== 1 ? 'en' : ''} im Root` : ''}
                  </span>
                  <label className="be-icon-btn" style={{ cursor: 'pointer', fontSize: 12 }} title="Datei hochladen" onClick={e => e.stopPropagation()}>
                    Upload
                    <input type="file" accept={currentCat.accept} multiple style={{ display: 'none' }} onChange={e => { handleUpload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                  </label>
                </div>
                {currentCat.mediaType === 'image' && files.length > 0 && (
                  <div className="asset-image-grid" style={{ marginTop: 8 }}>
                    {files.map(file => (
                      <div
                        key={file}
                        className="asset-image-card"
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('text/asset-path', file); e.dataTransfer.effectAllowed = 'move'; }}
                        onClick={() => openPreview(file)}
                      >
                        <img src={`/${activeCategory}/${file}`} alt={file} loading="lazy" draggable={false} />
                        <div className="asset-image-card-footer">
                          <span className="asset-image-card-name" title={file}>{file}</span>
                          <button className="be-icon-btn" style={{ width: 24, height: 24, fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath: file, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
                          <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(file, file); }} title="Löschen" style={{ width: 24, height: 24, fontSize: 13 }}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {currentCat.mediaType === 'audio' && files.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{files.map(file => renderAudioItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
                {currentCat.mediaType === 'video' && files.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{files.map(file => renderVideoItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
              </DropZone>
            )
          )}
        </>
      )}

      {/* Audio detail modal */}
      {audioPreview && (
        <div className="modal-overlay" onClick={() => setAudioPreview(null)}>
          <div className="audio-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">🎵 {audioPreview.filePath.split('/').pop()}</span>
              {audioPreviewDuration > 0 && <span className="image-lightbox-dims">{fmtTime(audioPreviewDuration)}</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 11 }}
                onClick={() => { setMoveState({ filePath: audioPreview.filePath, name: audioPreview.filePath.split('/').pop()! }); setMoveTarget(''); setAudioPreview(null); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(audioPreview.filePath, audioPreview.filePath); setAudioPreview(null); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={() => setAudioPreview(null)}>✕</button>
            </div>
            <div className="audio-detail-waveform">
              <AudioTrimTimeline
                src={audioPreview.src}
                readOnly
                onChange={() => {}}
                onLoaded={setAudioPreviewDuration}
              />
            </div>
            <div className="audio-detail-meta">
              <span className="audio-detail-path">{activeCategory}/{audioPreview.filePath}</span>
            </div>
            {audioPreviewUsages !== null && (
              <div className="audio-detail-usages">
                <span className="asset-usage-label">Verwendet in:</span>
                {audioPreviewUsages.length === 0
                  ? <span className="asset-usage-none">keinem Spiel</span>
                  : audioPreviewUsages.map((u, i) => (
                    <div key={i} className="audio-detail-usage-row">
                      <span className="asset-usage-tag">
                        {u.title}{u.instance ? ` · ${u.instance}` : ''}
                      </span>
                      {(u.markers ?? []).length > 0 && (
                        <div className="audio-detail-usage-markers">
                          {(u.markers ?? []).map((m, mi) => {
                            const startLabel = fmtTime(m.start ?? 0);
                            const endLabel = m.end !== undefined
                              ? fmtTime(m.end)
                              : audioPreviewDuration > 0 ? fmtTime(audioPreviewDuration) : '—';
                            return <span key={mi} className="asset-usage-marker">{startLabel} → {endLabel}</span>;
                          })}
                        </div>
                      )}
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video detail modal */}
      {videoPreview && (
        <div className="modal-overlay" onClick={closeVideoPreview}>
          <div className="video-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">🎬 {videoPreview.filePath.split('/').pop()}</span>
              {videoPreviewDuration > 0 && <span className="image-lightbox-dims">{fmtTime(videoPreviewDuration)}</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 11 }}
                onClick={() => { setMoveState({ filePath: videoPreview.filePath, name: videoPreview.filePath.split('/').pop()! }); setMoveTarget(''); closeVideoPreview(); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(videoPreview.filePath, videoPreview.filePath); closeVideoPreview(); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={closeVideoPreview}>✕</button>
            </div>
            <div className="video-detail-player" style={{ position: 'relative' }}>
              <video
                ref={videoPreviewRef}
                controls
                disablePictureInPicture
              />
              {videoPreviewLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div className="video-loading-spinner" />
                </div>
              )}
            </div>
            <div className="audio-detail-meta">
              <span className="audio-detail-path">videos/{videoPreview.filePath}</span>
            </div>
            {videoPreviewUsages !== null && (
              <div className="audio-detail-usages">
                <span className="asset-usage-label">Verwendet in:</span>
                {videoPreviewUsages.length === 0
                  ? <span className="asset-usage-none">keinem Spiel</span>
                  : videoPreviewUsages.map((u, i) => (
                    <div key={i} className="audio-detail-usage-row">
                      <span className="asset-usage-tag">
                        {u.title}{u.instance ? ` · ${u.instance}` : ''}
                      </span>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Audio tracks info */}
            {videoTracks.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <span className="asset-usage-label">Audio-Spuren:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {videoTracks.map((t, i) => {
                    const lang = t.language === 'deu' ? 'DE' : t.language === 'eng' ? 'EN' : t.language === 'fra' ? 'FR' : t.language === 'und' ? '?' : t.language.toUpperCase();
                    const isSelected = videoPreviewTrack === i || (videoPreviewTrack === null && t.isDefault);
                    const clickable = t.browserCompatible;
                    return (
                      <button
                        key={i}
                        onClick={clickable ? () => setVideoPreviewTrack(i) : undefined}
                        disabled={!clickable}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: clickable ? 'pointer' : 'default',
                          background: isSelected && clickable ? 'rgba(129,140,248,0.2)'
                            : t.browserCompatible ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                          border: `1px solid ${isSelected && clickable ? 'rgba(129,140,248,0.6)'
                            : t.browserCompatible ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                          color: isSelected && clickable ? '#a5b4fc'
                            : t.browserCompatible ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)',
                          fontWeight: isSelected ? 600 : 400,
                        }}
                        title={clickable
                          ? `${t.codecLong} — ${t.channels}ch ${t.channelLayout} — Klick: Vorschau in dieser Sprache`
                          : `${t.codecLong} — ${t.channels}ch ${t.channelLayout} — nicht browserkompatibel`}
                      >
                        {lang} · {t.codec.toUpperCase()} · {t.channels}ch
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Transcode button / progress */}
            {videoNeedsTranscode && !previewJob && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, fontSize: 12 }}>
                <div style={{ color: 'rgba(248,113,113,0.9)', marginBottom: 6 }}>
                  Audio-Codec nicht browserkompatibel. Video hat kein Audio im Browser.
                </div>
                <button className="be-icon-btn" style={{ fontSize: 12 }} onClick={handleVideoTranscode}>
                  🔄 Audio zu AAC konvertieren (alle Sprachen)
                </button>
              </div>
            )}
            {previewJob?.status === 'running' && (() => {
              const eta = previewJob.percent > 2 && previewJob.elapsed > 0
                ? (previewJob.elapsed / previewJob.percent) * (100 - previewJob.percent)
                : 0;
              const etaStr = eta > 0
                ? eta < 60 ? `~${Math.ceil(eta)}s`
                : eta < 3600 ? `~${Math.floor(eta / 60)}m ${Math.ceil(eta % 60)}s`
                : `~${Math.floor(eta / 3600)}h ${Math.ceil((eta % 3600) / 60)}m`
                : '';
              return (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.3)', borderRadius: 6, fontSize: 12, color: 'rgba(129,140,248,0.9)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>🔄 Konvertiere Audio… {previewJob.percent}%</span>
                    {etaStr && <span style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: 11 }}>{etaStr} verbleibend</span>}
                  </div>
                  <div className="upload-progress-track" style={{ marginTop: 6 }}>
                    <div className="upload-progress-fill upload-progress-processing" style={{ width: `${previewJob.percent}%` }} />
                  </div>
                </div>
              );
            })()}
            {previewJob?.status === 'error' && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, fontSize: 12, color: 'rgba(248,113,113,0.9)' }}>
                Fehler: {previewJob.error}
              </div>
            )}
            {videoTranscodeError && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, fontSize: 12, color: 'rgba(248,113,113,0.9)' }}>
                Fehler: {videoTranscodeError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {previewImage && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className="image-lightbox" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">{previewImage.split('/').pop()}</span>
              {previewDims && <span className="image-lightbox-dims">{previewDims.w} × {previewDims.h}px</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 11 }}
                onClick={() => { setMoveState({ filePath: previewImage, name: previewImage.split('/').pop()! }); setMoveTarget(''); setPreviewImage(null); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(previewImage, previewImage); setPreviewImage(null); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={() => setPreviewImage(null)}>✕</button>
            </div>
            <div className="image-lightbox-body">
              <img
                src={`/${activeCategory}/${previewImage}`}
                alt={previewImage}
                onLoad={e => {
                  const img = e.target as HTMLImageElement;
                  setPreviewDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
            {previewUsages !== null && (
              <div className="image-lightbox-usages">
                <span className="asset-usage-label">Verwendet in:</span>
                {previewUsages.length === 0
                  ? <span className="asset-usage-none">keinem Spiel</span>
                  : previewUsages.map(u => (
                    <span key={`${u.fileName}${u.instance ? `-${u.instance}` : ''}`} className="asset-usage-tag">
                      {u.title}{u.instance ? ` · ${u.instance}` : ''}
                    </span>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload progress overlay is rendered in AdminScreen via UploadContext */}

      {/* Poster fetch modal */}
      {posterModal && (
        <div className="modal-overlay" onClick={() => posterModal.status !== 'loading' && setPosterModal(null)}>
          <div className="modal-box poster-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>🖼 Filmcover laden</h2>
              {posterModal.status !== 'loading' && (
                <button className="be-icon-btn" onClick={() => setPosterModal(null)}>✕</button>
              )}
            </div>
            <div className="poster-modal-filename">{posterModal.fileName}</div>
            {posterModal.status === 'loading' && (
              <div className="poster-modal-loading">
                <div className="upload-progress-track">
                  <div className="upload-progress-fill upload-progress-fetching-cover" style={{ width: '35%' }} />
                </div>
                <span>Poster wird gesucht…</span>
              </div>
            )}
            {posterModal.status === 'done' && (
              <div className={`poster-modal-status ${posterModal.posterPath ? 'poster-modal-status--ok' : 'poster-modal-status--none'}`}>
                {posterModal.posterPath ? '✅ Cover geladen' : '— Kein Cover gefunden'}
              </div>
            )}
            {posterModal.status === 'error' && (
              <div className="poster-modal-status poster-modal-status--err">❌ {posterModal.error}</div>
            )}
            {posterModal.posterPath && (
              <img src={posterModal.posterPath} className="poster-modal-img" />
            )}
            {posterModal.logs.length > 0 && (
              <div className="poster-modal-logs">
                {posterModal.logs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Move modal */}
      {moveState && (
        <div className="modal-overlay" onClick={() => setMoveState(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>Datei verschieben</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 12 }}>
              {moveState.filePath}
            </p>
            <div style={{ marginBottom: 8, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Zielordner:</div>
            <div className="be-list-row" style={{ marginBottom: 16 }}>
              <input
                className="be-input"
                list="folder-paths"
                placeholder="Ordnerpfad (leer = Wurzel)"
                value={moveTarget}
                onChange={e => setMoveTarget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleMove()}
                autoFocus
              />
              <datalist id="folder-paths">
                {allFolderPaths.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="be-list-row">
              <button className="be-btn-primary" onClick={handleMove}>Verschieben</button>
              <button className="be-icon-btn" onClick={() => setMoveState(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* YouTube download modal */}
      {ytModal && (
        <div className="modal-overlay" onClick={() => setYtModal(false)}>
          <div className="modal-box yt-modal" onClick={e => e.stopPropagation()}>
            <h2>YouTube Download</h2>
            <input
              className="be-input"
              placeholder="YouTube URL einfügen"
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleYoutubeDownload()}
              autoFocus
            />
            {allFolderPaths.length > 0 && (
              <select
                className="be-input"
                value={ytSubfolder}
                onChange={e => setYtSubfolder(e.target.value)}
              >
                <option value="">Stammordner</option>
                {allFolderPaths.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <div className="yt-modal-actions">
              <button className="be-btn-primary" onClick={handleYoutubeDownload} disabled={!ytUrl.trim()}>Herunterladen</button>
              <button className="be-btn-secondary" onClick={() => setYtModal(false)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
