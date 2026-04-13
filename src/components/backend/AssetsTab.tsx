import { useState, useEffect, useRef } from 'react';
import type { AssetCategory, AssetFolder, AssetFileMeta } from '@/types/config';
import { fetchAssets, fetchVideoCover, deleteAsset, moveAsset, fetchAssetUsages, createAssetFolder, probeVideo, fetchAudioCoverList, downloadImageFromUrl, type VideoTrackInfo, type VideoStreamInfo } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import { PickerModal } from './AssetPicker';
import StatusMessage from './StatusMessage';
import FolderNamePrompt from './FolderNamePrompt';
import MiniAudioPlayer from './MiniAudioPlayer';
import AudioTrimTimeline from './AudioTrimTimeline';
import { useUpload } from './UploadContext';
import { notifyStreamStart, notifyStreamEnd } from '@/services/networkPriority';

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function fmtEta(seconds: number): string {
  const s = Math.ceil(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

function fmtBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} kbit/s`;
  return `${bps} bit/s`;
}

function fmtFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
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

interface GameUsage { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[]; }
interface PosterModal { fileName: string; status: 'loading' | 'done' | 'error'; logs: string[]; posterPath: string | null; error?: string; }
interface MoveState { filePath: string; name: string; }

// Collect all folder paths recursively
function getAllFolderPaths(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [p, ...getAllFolderPaths(f.subfolders, p)];
  });
}

type SortField = 'name' | 'date' | 'size' | 'type';

function sortFiles(
  files: string[],
  meta: Record<string, AssetFileMeta> | undefined,
  sortBy: SortField,
  sortReverse: boolean,
): string[] {
  const sorted = [...files].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'date') {
      const ma = meta?.[a]?.mtime ?? 0;
      const mb = meta?.[b]?.mtime ?? 0;
      cmp = mb - ma; // newest first by default
    } else if (sortBy === 'size') {
      const sa = meta?.[a]?.size ?? 0;
      const sb = meta?.[b]?.size ?? 0;
      cmp = sb - sa; // largest first by default
    } else if (sortBy === 'type') {
      const extA = a.includes('.') ? a.split('.').pop()!.toLowerCase() : '';
      const extB = b.includes('.') ? b.split('.').pop()!.toLowerCase() : '';
      cmp = extA.localeCompare(extB, 'de', { sensitivity: 'base' });
      if (cmp === 0) cmp = a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true });
    }
    return cmp;
  });
  return sortReverse ? sorted.reverse() : sorted;
}

// Collect all files with their folder paths for search
interface FileEntry { file: string; filePath: string; folder: string | null; meta?: AssetFileMeta; }
function collectAllFiles(rootFiles: string[], rootMeta: Record<string, AssetFileMeta> | undefined, folders: AssetFolder[], prefix = ''): FileEntry[] {
  const entries: FileEntry[] = rootFiles.map(f => ({ file: f, filePath: f, folder: null, meta: rootMeta?.[f] }));
  const walk = (subs: AssetFolder[], pre: string) => {
    for (const folder of subs) {
      const fp = pre ? `${pre}/${folder.name}` : folder.name;
      for (const file of folder.files) {
        entries.push({ file, filePath: `${fp}/${file}`, folder: fp, meta: folder.fileMeta?.[file] });
      }
      walk(folder.subfolders, fp);
    }
  };
  walk(folders, prefix);
  return entries;
}

// Extract http(s) image URLs from a DataTransfer when dragging from another browser window.
// Priority: text/uri-list → text/html <img src> → text/plain.
// uri-list is preferred because:
//   - For normal websites, it's the same URL as the img src.
//   - For Google Images, uri-list is /imgres?imgurl=<real> which the server unwraps to the full
//     image, whereas the <img> in the HTML fragment is a low-res gstatic CDN thumbnail.
function extractDroppedUrls(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const uriList = dt.getData('text/uri-list');
  if (uriList) {
    const urls = uriList
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && /^https?:\/\//i.test(s));
    if (urls.length > 0) return urls;
  }
  const html = dt.getData('text/html');
  if (html) {
    const urls: string[] = [];
    const re = /<img[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (/^https?:\/\//i.test(m[1])) urls.push(m[1]);
    }
    if (urls.length > 0) return urls;
  }
  const plain = dt.getData('text/plain')?.trim();
  if (plain && /^https?:\/\/\S+$/i.test(plain)) return [plain];
  return [];
}

function DropZone({
  onFileDrop,
  onAssetDrop,
  onAssetMultiDrop,
  onUrlDrop,
  className = '',
  noClick = false,
  style,
  children,
}: {
  onFileDrop: (files: File[]) => void;
  onAssetDrop?: (assetPath: string) => void;
  onAssetMultiDrop?: (assetPaths: string[]) => void;
  onUrlDrop?: (urls: string[]) => void;
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
  const assetMultiDropRef = useRef(onAssetMultiDrop);
  assetMultiDropRef.current = onAssetMultiDrop;
  const urlDropRef = useRef(onUrlDrop);
  urlDropRef.current = onUrlDrop;

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
        return;
      }
      const multiPaths = e.dataTransfer?.getData('text/asset-paths');
      if (multiPaths && assetMultiDropRef.current) {
        try {
          const paths = JSON.parse(multiPaths) as string[];
          assetMultiDropRef.current(paths);
          return;
        } catch { /* ignore parse error */ }
      }
      const assetPath = e.dataTransfer?.getData('text/asset-path');
      if (assetPath && assetDropRef.current) {
        assetDropRef.current(assetPath);
        return;
      }
      // External browser window: image/link dragged from another tab
      if (urlDropRef.current) {
        const urls = extractDroppedUrls(e.dataTransfer);
        if (urls.length > 0) urlDropRef.current(urls);
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
  onNavigateToGame?: (fileName: string, instance?: string, questionIndex?: number) => void;
}

export default function AssetsTab({ initialCategory, onCategoryChange, onNavigateToGame }: AssetsTabProps = {}) {
  const [activeCategory, setActiveCategory] = useState<AssetCategory>(initialCategory ?? 'images');

  const handleCategoryChange = (cat: AssetCategory) => {
    setActiveCategory(cat);
    setSearchQuery('');
    setSelectionMode(false);
    setSelectedFiles(new Set());
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
  const [fileMeta, setFileMeta] = useState<Record<string, AssetFileMeta>>({});
  const [subfolders, setSubfolders] = useState<AssetFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortReverse, setSortReverse] = useState(false);
  const [folderPrompt, setFolderPrompt] = useState<{ title: string; parentPath?: string } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
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
  const [videoInfo, setVideoInfo] = useState<VideoStreamInfo | null>(null);
  const [videoPreviewTrack, setVideoPreviewTrack] = useState<number | null>(null);
  // Full-file transcoding (HDR→SDR and audio→AAC whole-file) has been removed. The cache-
  // based mechanic (segment cache + track remux with AAC audio) covers every prior use case.
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [posterModal, setPosterModal] = useState<PosterModal | null>(null);
  const [storageMode, setStorageMode] = useState<'local' | null>(null);
  const [nasMounted, setNasMounted] = useState(false);
  const [ytModal, setYtModal] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytSubfolder, setYtSubfolder] = useState('');
  const [imgUrlModal, setImgUrlModal] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [imgUrlSubfolder, setImgUrlSubfolder] = useState('');
  const [imgUrlLoading, setImgUrlLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSort, setShowSort] = useState(false);
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false);
  // Error surfaced when the browser gives up on the raw file (usually HEVC Main 10 HDR).
  // Cleared on src change or on successful re-seek. Kept in state so we can render a
  // useful fallback instead of the default silent-loading spinner.
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null);
  const [videoProbeLoading, setVideoProbeLoading] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef  = useRef<HTMLElement | null>(null);
  const { startUpload, startYtDownload, startAudioCoverFetch, lastRateLimitedFiles } = useUpload();
  const [audioCoverModal, setAudioCoverModal] = useState(false);
  const [existingCovers, setExistingCovers] = useState<Set<string>>(new Set());
  // Multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkOperationInProgress, setBulkOperationInProgress] = useState(false);
  const [bulkMoveModal, setBulkMoveModal] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');
  const lastClickedFileRef = useRef<string | null>(null);
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

  // Escape exits selection mode
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSelectionMode(false);
        setSelectedFiles(new Set());
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selectionMode]);

  // Clipboard paste: upload pasted images to root of current category
  useEffect(() => {
    if (activeCategory !== 'images') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      // Check if clipboard contains image data
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleUpload(imageFiles);
      }
      // If no image data, let the default paste (text into inputs) happen
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Receive storage mode via WebSocket push
  useWsChannel<{ mode: 'local'; nasMounted: boolean }>('asset-storage', (data) => {
    setStorageMode(data.mode);
    setNasMounted(data.nasMounted);
  });


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
      setFileMeta(data.fileMeta ?? {});
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
  const showYtDownload = isAudioCategory || activeCategory === 'videos';

  // Sort helpers that use current sort state
  const sortedFiles = (fileList: string[], meta: Record<string, AssetFileMeta> | undefined) =>
    sortFiles(fileList, meta, sortBy, sortReverse);

  const sortFileEntries = (entries: FileEntry[]): FileEntry[] => {
    const sorted = [...entries].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.file.localeCompare(b.file, 'de', { sensitivity: 'base', numeric: true });
      } else if (sortBy === 'date') {
        cmp = (b.meta?.mtime ?? 0) - (a.meta?.mtime ?? 0);
      } else if (sortBy === 'size') {
        cmp = (b.meta?.size ?? 0) - (a.meta?.size ?? 0);
      } else if (sortBy === 'type') {
        const extA = a.file.includes('.') ? a.file.split('.').pop()!.toLowerCase() : '';
        const extB = b.file.includes('.') ? b.file.split('.').pop()!.toLowerCase() : '';
        cmp = extA.localeCompare(extB, 'de', { sensitivity: 'base' });
        if (cmp === 0) cmp = a.file.localeCompare(b.file, 'de', { sensitivity: 'base', numeric: true });
      }
      return cmp;
    });
    return sortReverse ? sorted.reverse() : sorted;
  };

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

  const isPlaylistUrl = (url: string): boolean => {
    try {
      const u = new URL(url);
      return u.searchParams.has('list') || u.pathname === '/playlist';
    } catch { return false; }
  };

  const handleYoutubeDownload = (playlist?: boolean) => {
    const trimmedUrl = ytUrl.trim();
    if (!trimmedUrl) return;
    startYtDownload(activeCategory, trimmedUrl, ytSubfolder || undefined, () => {
      load({ showLoading: false, preserveScroll: true });
    }, playlist);
    setYtModal(false);
    setYtUrl('');
    setYtSubfolder('');
  };

  const handleImageUrlDownload = async () => {
    const trimmedUrl = imgUrl.trim();
    if (!trimmedUrl) return;
    setImgUrlLoading(true);
    try {
      await downloadImageFromUrl(activeCategory, trimmedUrl, imgUrlSubfolder || undefined);
      showMsg('success', '✅ Bild heruntergeladen');
      load({ showLoading: false, preserveScroll: true });
      setImgUrlModal(false);
      setImgUrl('');
      setImgUrlSubfolder('');
    } catch (e) {
      showMsg('error', `❌ Download fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setImgUrlLoading(false);
    }
  };

  // Drop one or more image URLs from another browser window into the DAM (or a folder).
  // Only enabled for the images category; other categories ignore URL drops.
  const handleUrlDrop = async (urls: string[], subfolder?: string) => {
    if (activeCategory !== 'images' || urls.length === 0) return;
    showMsg('success', `Lade ${urls.length} Bild${urls.length !== 1 ? 'er' : ''}…`);
    let succeeded = 0;
    const failures: string[] = [];
    for (const url of urls) {
      try {
        await downloadImageFromUrl(activeCategory, url, subfolder);
        succeeded++;
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
    load({ showLoading: false, preserveScroll: true });
    if (failures.length === 0) {
      showMsg('success', `✅ ${succeeded} Bild${succeeded !== 1 ? 'er' : ''} heruntergeladen`);
    } else if (succeeded === 0) {
      showMsg('error', `❌ Download fehlgeschlagen: ${failures[0]}`);
    } else {
      showMsg('error', `⚠️ ${succeeded} heruntergeladen, ${failures.length} fehlgeschlagen`);
    }
  };

  const openAudioCoverModal = async () => {
    setAudioCoverModal(true);
    try {
      const covers = await fetchAudioCoverList();
      setExistingCovers(new Set(covers.map(c => c.replace(/\.[^.]+$/, ''))));
    } catch {
      setExistingCovers(new Set());
    }
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

  const handleRenameFolder = async (oldPath: string, newName: string) => {
    const trimmed = newName.trim();
    const oldName = oldPath.split('/').pop()!;
    if (!trimmed || trimmed === oldName) { setRenamingFolder(null); return; }
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    try {
      await moveAsset(activeCategory, oldPath, newPath);
      showMsg('success', `✅ "${oldName}" → "${trimmed}"`);
      setRenamingFolder(null);
      // Update expandedFolders to reflect the new path
      setExpandedFolders(prev => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === oldPath) next.add(newPath);
          else if (p.startsWith(oldPath + '/')) next.add(newPath + p.substring(oldPath.length));
          else next.add(p);
        }
        return next;
      });
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
    setVideoInfo(null);
    setVideoPreviewTrack(null);
    setVideoProbeLoading(true);
    const [usages, probe] = await Promise.all([
      fetchAssetUsages(activeCategory, filePath).catch(() => []),
      probeVideo(filePath).catch(() => null),
    ]);
    setVideoProbeLoading(false);
    setVideoPreviewUsages(usages);
    if (probe) {
      setVideoTracks(probe.tracks);
      setVideoNeedsTranscode(probe.needsTranscode);
      setVideoInfo(probe.videoInfo ?? null);
    }
  };

  const closeVideoPreview = () => {
    videoPreviewRef.current?.pause();
    setVideoPreviewLoading(false);
    setVideoPreview(null);
  };

  // DAM preview plays the raw file directly — no cache involved. This gives full scrubbing
  // and fast start at the cost of browser-codec compatibility: HDR files render grey/flat,
  // non-AAC audio is silent, and exotic containers may not play at all. The warning banners
  // below (`videoInfo?.isHdr`, `videoNeedsTranscode`) tell the operator what to expect, and
  // the selected audio track still drives the *gameshow cache* (see the track-selector
  // label). For a tone-mapped, audio-fixed preview the operator uses the marker editor.
  const videoPreviewSrc = videoPreview?.src ?? null;

  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !videoPreviewSrc) return;

    const savedTime = video.currentTime;
    const wasPlaying = !video.paused;
    video.src = videoPreviewSrc;
    video.load();

    const onReady = () => {
      setVideoPreviewDuration(video.duration);
      if (savedTime > 0 && savedTime < video.duration) {
        video.currentTime = savedTime;
      }
      if (wasPlaying) {
        video.play().catch(() => {});
      }
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, [videoPreviewSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track buffering state + error state for the video preview + network priority.
  // Error handling: when the raw file can't be decoded (HEVC Main 10 HDR is the usual
  // culprit) or the browser's media pipeline crashes on seek, the `<video>` element fires
  // `error` with a MediaError code. We surface a friendly message and clear it on src
  // changes / successful re-seeks so a single bad seek doesn't permanently break the modal.
  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !videoPreview) return;
    let notified = false;
    const onWaiting = () => setVideoPreviewLoading(true);
    const onReady = () => { setVideoPreviewLoading(false); setVideoPreviewError(null); };
    const onPlay = () => { if (!notified) { notifyStreamStart(); notified = true; } };
    const onPause = () => { if (notified) { notifyStreamEnd(); notified = false; } };
    const onError = () => {
      setVideoPreviewLoading(false);
      const err = video.error;
      const code = err?.code ?? 0;
      const detail = err?.message ? ` (${err.message})` : '';
      // Both DAM and marker editor stream the raw file, so they share the same playback
      // limits — no point recommending "open in marker editor" as a fallback for a decoder
      // crash; VLC (or another native player) is the honest answer.
      const msgs: Record<number, string> = {
        1: 'Wiedergabe abgebrochen',
        2: 'Netzwerkfehler beim Laden',
        3: 'Browser konnte das Video nicht dekodieren — bei HDR/HEVC 10-Bit ist der eingebaute Decoder auf Seek-Positionen oft instabil. Für volle Wiedergabe extern öffnen (VLC, IINA, QuickTime). Der Gameshow-Cache macht daraus automatisch ein abspielbares SDR-Segment.',
        4: 'Videoformat wird vom Browser nicht unterstützt — extern öffnen (VLC, IINA, QuickTime).',
      };
      setVideoPreviewError((msgs[code] ?? 'Unbekannter Wiedergabefehler') + detail);
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('seeked', onReady);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('error', onError);
    return () => {
      if (notified) notifyStreamEnd();
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('seeked', onReady);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('error', onError);
    };
  }, [videoPreview]);

  // Clear the error and loading spinner when the operator opens a different video file.
  useEffect(() => {
    setVideoPreviewError(null);
    setVideoPreviewLoading(false);
  }, [videoPreview?.filePath]);

  const createFolder = async (name: string) => {
    if (subfolders.find(s => s.name === name)) return;
    try {
      await createAssetFolder(activeCategory, name);
      setSubfolders(prev => [...prev, { name, files: [], subfolders: [] }]);
      setExpandedFolders(prev => new Set([...prev, name]));
      showMsg('success', `Ordner "${name}" erstellt`);
    } catch {
      showMsg('error', `Ordner konnte nicht erstellt werden`);
    }
  };

  const createSubfolder = async (parentPath: string, name: string) => {
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

  // --- Multi-select helpers ---

  const getVisibleFilePaths = (): string[] => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return collectAllFiles(files, fileMeta, subfolders)
        .filter(e => e.file.toLowerCase().includes(q))
        .map(e => e.filePath);
    }
    const paths: string[] = [...files];
    const walkExpanded = (folders: AssetFolder[], prefix: string) => {
      for (const folder of folders) {
        const fp = prefix ? `${prefix}/${folder.name}` : folder.name;
        if (expandedFolders.has(fp)) {
          for (const file of folder.files) paths.push(`${fp}/${file}`);
          walkExpanded(folder.subfolders, fp);
        }
      }
    };
    walkExpanded(subfolders, '');
    return paths;
  };

  const selectAllAtLevel = (folderPath?: string) => {
    if (folderPath) {
      // Select only direct files in this folder
      const findFolder = (folders: AssetFolder[], prefix: string): AssetFolder | null => {
        for (const f of folders) {
          const fp = prefix ? `${prefix}/${f.name}` : f.name;
          if (fp === folderPath) return f;
          const found = findFolder(f.subfolders, fp);
          if (found) return found;
        }
        return null;
      };
      const folder = findFolder(subfolders, '');
      if (!folder) return;
      setSelectedFiles(prev => {
        const next = new Set(prev);
        for (const file of folder.files) next.add(`${folderPath}/${file}`);
        return next;
      });
    } else {
      // Select root-level files only
      setSelectedFiles(prev => {
        const next = new Set(prev);
        for (const file of files) next.add(file);
        return next;
      });
    }
  };

  const selectNone = () => setSelectedFiles(new Set());

  const handleFileClick = (filePath: string, e: React.MouseEvent, openPreviewFn: () => void) => {
    const isMod = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    // Outside selection mode: Cmd/Shift+click auto-enters selection mode
    if (!selectionMode && !isMod && !isShift) {
      openPreviewFn();
      return;
    }
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedFiles(new Set([filePath]));
      lastClickedFileRef.current = filePath;
      return;
    }

    // In selection mode: plain click toggles, shift = range
    if (isShift && lastClickedFileRef.current) {
      // Range select
      const allPaths = getVisibleFilePaths();
      const lastIdx = allPaths.indexOf(lastClickedFileRef.current);
      const curIdx = allPaths.indexOf(filePath);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        setSelectedFiles(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(allPaths[i]);
          return next;
        });
      }
    } else {
      // Toggle single file (additive)
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
    }
    lastClickedFileRef.current = filePath;
  };

  const handleBulkDelete = async () => {
    const paths = Array.from(selectedFiles);
    if (paths.length === 0) return;
    if (!confirm(`${paths.length} Datei${paths.length !== 1 ? 'en' : ''} wirklich löschen?`)) return;
    setBulkOperationInProgress(true);
    const errors: string[] = [];
    for (const filePath of paths) {
      try {
        await deleteAsset(activeCategory, filePath);
      } catch (e) {
        errors.push(`${filePath}: ${(e as Error).message}`);
      }
    }
    setBulkOperationInProgress(false);
    const successCount = paths.length - errors.length;
    if (successCount > 0) showMsg('success', `🗑️ ${successCount} Datei${successCount !== 1 ? 'en' : ''} gelöscht`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    load({ showLoading: false, preserveScroll: true });
  };

  const handleBulkMove = async () => {
    const paths = Array.from(selectedFiles);
    if (paths.length === 0) return;
    setBulkOperationInProgress(true);
    const errors: string[] = [];
    for (const fromPath of paths) {
      const fileName = fromPath.split('/').pop()!;
      const targetPath = bulkMoveTarget.trim()
        ? `${bulkMoveTarget.trim()}/${fileName}`
        : fileName;
      if (fromPath === targetPath) continue;
      try {
        await moveAsset(activeCategory, fromPath, targetPath);
      } catch (e) {
        errors.push(`${fromPath}: ${(e as Error).message}`);
      }
    }
    setBulkOperationInProgress(false);
    const successCount = paths.length - errors.length;
    if (successCount > 0) showMsg('success', `✅ ${successCount} Datei${successCount !== 1 ? 'en' : ''} verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    setBulkMoveModal(false);
    setBulkMoveTarget('');
    load({ showLoading: false, preserveScroll: true });
  };

  const handleMoveAssets = async (fromPaths: string[], toFolderPath?: string) => {
    setBulkOperationInProgress(true);
    const errors: string[] = [];
    for (const fromPath of fromPaths) {
      const fileName = fromPath.split('/').pop()!;
      const targetPath = toFolderPath ? `${toFolderPath}/${fileName}` : fileName;
      if (fromPath === targetPath) continue;
      try {
        await moveAsset(activeCategory, fromPath, targetPath);
      } catch (e) {
        errors.push(`${fromPath}: ${(e as Error).message}`);
      }
    }
    setBulkOperationInProgress(false);
    const successCount = fromPaths.length - errors.length;
    if (successCount > 0) showMsg('success', `✅ ${successCount} Datei${successCount !== 1 ? 'en' : ''} verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    load({ showLoading: false, preserveScroll: true });
  };

  const renderAudioItem = (file: string, filePath: string, src: string) => (
    <div
      key={filePath}
      className={`asset-file-item${selectionMode && selectedFiles.has(filePath) ? ' asset-file-item--selected' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath)}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => openAudioPreview(filePath, src))}
    >
      <span className="asset-file-icon">🎵</span>
      <span className="asset-file-name" title={file}>{file}</span>
      {!selectionMode && <MiniAudioPlayer src={src} className="asset-file-audio" />}
      {!selectionMode && (
        <>
          <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
          <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
        </>
      )}
    </div>
  );

  const renderVideoItem = (file: string, filePath: string, src: string) => (
    <div
      key={filePath}
      className={`asset-file-item${selectionMode && selectedFiles.has(filePath) ? ' asset-file-item--selected' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath)}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => openVideoPreview(filePath, src))}
    >
      <span className="asset-file-icon">🎬</span>
      <span className="asset-file-name" title={file}>{file}</span>
      <VideoThumb file={file} src={src} />
      {!selectionMode && (
        <>
          <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => handleFetchCover(e, file)} title="Filmcover laden"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.5"/><path d="M1.5 11l3.5-3.5 2.5 2.5 2-2L14.5 13"/></svg></button>
          <button className="be-icon-btn" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
          <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
        </>
      )}
    </div>
  );

  const renderImageCard = (file: string, filePath: string, folder?: string | null) => (
    <div
      key={filePath}
      className={`asset-image-card${selectionMode && selectedFiles.has(filePath) ? ' asset-image-card--selected' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath)}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => openPreview(filePath))}
    >
      <img src={`/${activeCategory}/${filePath}`} alt={file} loading="lazy" draggable={false} />
      <div className="asset-image-card-footer">
        {folder && <span className="asset-search-folder-badge" title={folder}>📁 {folder}</span>}
        <span className="asset-image-card-name" title={file}>{file}</span>
        {!selectionMode && (
          <>
            <button
              className="be-icon-btn"
              style={{ width: 24, height: 24, fontSize: 11 }}
              onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }}
              title="Verschieben"
            >→</button>
            <button
              className="be-delete-btn"
              onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }}
              title="Löschen"
              style={{ width: 24, height: 24, fontSize: 13 }}
            >🗑</button>
          </>
        )}
      </div>
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
        onAssetMultiDrop={paths => handleMoveAssets(paths, folderPath)}
        onUrlDrop={urls => handleUrlDrop(urls, folderPath)}
        noClick
      >
        <div className="asset-folder-header" onClick={() => toggleFolder(folderPath)}>
          <span className={`asset-folder-chevron ${isExpanded ? 'open' : ''}`}>▶</span>
          {renamingFolder === folderPath ? (
            <input
              className="be-input asset-folder-rename-input"
              value={renameFolderName}
              autoFocus
              onClick={e => e.stopPropagation()}
              onChange={e => setRenameFolderName(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') handleRenameFolder(folderPath, renameFolderName);
                if (e.key === 'Escape') { e.preventDefault(); setRenamingFolder(null); }
              }}
              onBlur={() => handleRenameFolder(folderPath, renameFolderName)}
            />
          ) : (
            <span
              className="asset-folder-name"
              onClick={e => { e.stopPropagation(); setRenamingFolder(folderPath); setRenameFolderName(folder.name); }}
              title="Klicken zum Umbenennen"
            >{folder.name}</span>
          )}
          <span className="asset-folder-count">{countLabel}</span>
          {selectionMode && folder.files.length > 0 && (
            <button
              className="be-icon-btn"
              style={{ fontSize: 11 }}
              onClick={e => { e.stopPropagation(); selectAllAtLevel(folderPath); }}
              title="Alle Dateien in diesem Ordner auswählen"
            >Alle</button>
          )}
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
            onClick={e => { e.stopPropagation(); setFolderPrompt({ title: 'Unterordner erstellen', parentPath: folderPath }); }}
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

            {folder.files.length > 0 && currentCat.mediaType === 'image' && (
              <div className="asset-image-grid">
                {sortedFiles(folder.files, folder.fileMeta).map(file => renderImageCard(file, `${folderPath}/${file}`))}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'audio' && (
              <div className="asset-file-list">
                {sortedFiles(folder.files, folder.fileMeta).map(file =>
                  renderAudioItem(file, `${folderPath}/${file}`, `/${activeCategory}/${folderPath}/${file}`)
                )}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'video' && (
              <div className="asset-file-list">
                {sortedFiles(folder.files, folder.fileMeta).map(file =>
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
    <div ref={containerRef} className={selectionMode ? 'asset-selecting' : undefined}>
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
          <span className={`asset-storage-badge ${nasMounted ? 'asset-storage-badge--synced' : 'asset-storage-badge--local'}`}>
            {nasMounted ? '⬡ Lokal + NAS' : '⬡ Nur lokal'}
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
            onAssetMultiDrop={paths => handleMoveAssets(paths)}
            onUrlDrop={urls => handleUrlDrop(urls)}
          >
            <span style={{ fontSize: 24, display: 'block', marginBottom: 6 }}>
              {currentCat.mediaType === 'image' ? '🖼️' : currentCat.mediaType === 'video' ? '🎬' : '🎵'}
            </span>
            Dateien hier ablegen oder klicken zum Auswählen
            {activeCategory === 'images' && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                Cmd+V um Bild aus Zwischenablage einzufügen · Bilder aus anderen Browser-Fenstern können hierher gezogen werden
              </div>
            )}
            {(showYtDownload || isAudioCategory || activeCategory === 'images') && (
              <div className="upload-zone-buttons">
                {showYtDownload && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); setYtModal(true); setYtUrl(''); setYtSubfolder(''); }}
                  >
                    <span className="yt-download-btn-icon">▶</span>
                    YouTube
                  </button>
                )}
                {isAudioCategory && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); openAudioCoverModal(); }}
                  >
                    <svg className="yt-download-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.5"/><path d="M1.5 11l3.5-3.5 2.5 2.5 2-2L14.5 13"/></svg>
                    Cover
                  </button>
                )}
                {activeCategory === 'images' && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); setImgUrlModal(true); setImgUrl(''); setImgUrlSubfolder(''); }}
                  >
                    <span className="yt-download-btn-icon">🔗</span>
                    Von URL
                  </button>
                )}
              </div>
            )}
          </DropZone>

          <div className="asset-search-row">
            <span className="asset-search-icon">🔍</span>
            <input
              className="be-input asset-search-input"
              placeholder="Dateien suchen…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button className="be-icon-btn asset-search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
            <button
              className={`be-icon-btn${selectionMode ? ' asset-select-toggle-active' : ''}`}
              onClick={() => {
                if (selectionMode) { setSelectionMode(false); setSelectedFiles(new Set()); }
                else setSelectionMode(true);
              }}
            >
              {selectionMode ? 'Fertig' : 'Auswählen'}
            </button>
            <button
              className="be-icon-btn"
              style={{ fontSize: 15 }}
              onClick={() => setFolderPrompt({ title: 'Ordner erstellen' })}
              title="Ordner erstellen"
            >📁+</button>
            <div className="asset-sort-wrapper">
              <button
                className={`be-icon-btn${showSort ? ' asset-select-toggle-active' : ''}`}
                onClick={() => setShowSort(s => !s)}
                title="Sortierung"
              >
                {sortBy === 'name' ? 'Name' : sortBy === 'date' ? 'Datum' : sortBy === 'size' ? 'Größe' : 'Typ'}
                {sortReverse ? ' ↑' : ' ↓'}
              </button>
              {showSort && (
                <>
                  <div className="asset-sort-backdrop" onClick={() => setShowSort(false)} />
                  <div className="asset-sort-popover">
                    {([['name', 'Name'], ['date', 'Datum'], ['size', 'Größe'], ['type', 'Typ']] as const).map(([field, label]) => (
                      <button
                        key={field}
                        className={`asset-sort-btn${sortBy === field ? ' active' : ''}`}
                        onClick={() => {
                          if (sortBy === field) setSortReverse(r => !r);
                          else { setSortBy(field); setSortReverse(false); }
                        }}
                      >
                        {label}
                        {sortBy === field && <span className="asset-sort-arrow">{sortReverse ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>


          {selectionMode && (
            <div className="asset-selection-toolbar">
              <button
                className="be-icon-btn asset-selection-close-btn"
                onClick={() => { setSelectionMode(false); setSelectedFiles(new Set()); }}
                title="Auswahlmodus beenden (Esc)"
                aria-label="Auswahlmodus beenden"
              >✕</button>
              <span className="asset-selection-count">
                {selectedFiles.size > 0 ? `${selectedFiles.size} ausgewählt` : 'Dateien auswählen'}
              </span>
              <button className="be-icon-btn" onClick={() => searchQuery ? setSelectedFiles(new Set(getVisibleFilePaths())) : selectAllAtLevel()}>Alle</button>
              <button className="be-icon-btn" onClick={selectNone} disabled={selectedFiles.size === 0}>Keine</button>
              <div style={{ flex: 1 }} />
              <button
                className="be-icon-btn"
                onClick={() => { setBulkMoveTarget(''); setBulkMoveModal(true); }}
                disabled={selectedFiles.size === 0 || bulkOperationInProgress}
              >
                Verschieben ({selectedFiles.size})
              </button>
              <button
                className="be-icon-btn asset-selection-delete-btn"
                onClick={handleBulkDelete}
                disabled={selectedFiles.size === 0 || bulkOperationInProgress}
              >
                Löschen ({selectedFiles.size})
              </button>
            </div>
          )}

          <div>
            {!searchQuery && subfolders.map(folder => renderFolder(folder, folder.name, 0))}
          </div>

          {searchQuery ? (() => {
            const q = searchQuery.toLowerCase();
            const allEntries = collectAllFiles(files, fileMeta, subfolders);
            const filtered = sortFileEntries(allEntries.filter(e => e.file.toLowerCase().includes(q)));
            if (filtered.length === 0) return <div className="be-empty">Keine Treffer für &ldquo;{searchQuery}&rdquo;</div>;
            const resultCount = `${filtered.length} Treffer`;

            if (currentCat.mediaType === 'image') return (
              <>
                <div className="asset-search-result-count">{resultCount}</div>
                <div className="asset-image-grid">
                  {filtered.map(({ file, filePath, folder }) => renderImageCard(file, filePath, folder))}
                </div>
              </>
            );

            return (
              <>
                <div className="asset-search-result-count">{resultCount}</div>
                <div className="asset-file-list">
                  {filtered.map(({ file, filePath, folder }) => (
                    <div key={filePath} className="asset-search-result-item">
                      {folder && <span className="asset-search-folder-badge" title={folder}>📁 {folder}</span>}
                      {currentCat.mediaType === 'audio'
                        ? renderAudioItem(file, filePath, `/${activeCategory}/${filePath}`)
                        : renderVideoItem(file, filePath, `/${activeCategory}/${filePath}`)}
                    </div>
                  ))}
                </div>
              </>
            );
          })() : (
            subfolders.length === 0 ? (
              // No subfolders: flat view, root upload zone at top is the drop target
              <>
                {currentCat.mediaType === 'image' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Bilder vorhanden</div>
                    : (
                      <div className="asset-image-grid">
                        {sortedFiles(files, fileMeta).map(file => renderImageCard(file, file))}
                      </div>
                    )
                )}
                {currentCat.mediaType === 'audio' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Audiodateien vorhanden</div>
                    : <div className="asset-file-list">{sortedFiles(files, fileMeta).map(file => renderAudioItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
                {currentCat.mediaType === 'video' && (
                  files.length === 0
                    ? <div className="be-empty">Keine Videos vorhanden</div>
                    : <div className="asset-file-list">{sortedFiles(files, fileMeta).map(file => renderVideoItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
              </>
            ) : (
              // Has subfolders: show Stammordner as a DropZone so drag-to-root works without scrolling up
              <DropZone
                className="asset-root"
                onFileDrop={filesArg => handleUpload(filesArg)}
                onAssetDrop={assetPath => handleMoveAsset(assetPath)}
                onAssetMultiDrop={paths => handleMoveAssets(paths)}
                onUrlDrop={urls => handleUrlDrop(urls)}
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
                    {sortedFiles(files, fileMeta).map(file => renderImageCard(file, file))}
                  </div>
                )}
                {currentCat.mediaType === 'audio' && files.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{sortedFiles(files, fileMeta).map(file => renderAudioItem(file, file, `/${activeCategory}/${file}`))}</div>
                )}
                {currentCat.mediaType === 'video' && files.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{sortedFiles(files, fileMeta).map(file => renderVideoItem(file, file, `/${activeCategory}/${file}`))}</div>
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
                      <span
                        className={`asset-usage-tag${onNavigateToGame ? ' asset-usage-tag--clickable' : ''}`}
                        onClick={onNavigateToGame ? () => { setAudioPreview(null); onNavigateToGame(u.fileName, u.instance, u.questionIndices?.[0]); } : undefined}
                      >
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
              {(videoInfo?.duration || videoPreviewDuration) > 0 && <span className="image-lightbox-dims">{fmtTime(videoInfo?.duration || videoPreviewDuration)}</span>}
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
              {/* `width: 100%` on the element is set inline rather than in CSS so it only
               *  applies to the DAM preview (not to other `<video>`s that happen to appear
               *  inside the modal). This lets the video scale up to the modal's 1280-px
               *  width for landscape clips while the CSS-level `max-height: 70vh` still
               *  caps portrait or tall aspect ratios. */}
              <video
                ref={videoPreviewRef}
                controls
                disablePictureInPicture
                preload="metadata"
                style={{ width: '100%', height: 'auto' }}
              />
              {videoPreviewLoading && !videoPreviewError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div className="video-loading-spinner" />
                </div>
              )}
              {videoPreviewError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', padding: '1.25rem' }}>
                  <p style={{ color: 'rgba(251,191,36,0.95)', fontSize: '0.9rem', textAlign: 'center', margin: 0, maxWidth: 520, lineHeight: 1.4 }}>
                    ⚠️ {videoPreviewError}
                  </p>
                </div>
              )}
            </div>
            <div className="audio-detail-meta">
              <span className="audio-detail-path">videos/{videoPreview.filePath}</span>
            </div>
            {videoProbeLoading && (
              <div className="audio-detail-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <div className="video-loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                <span>Metadaten werden geladen…</span>
              </div>
            )}
            {videoInfo && (
              <div className="audio-detail-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Auflösung: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{videoInfo.width}×{videoInfo.height}</span>
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Codec: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{videoInfo.codec.toUpperCase()}</span>
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  FPS: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{videoInfo.fps}</span>
                </span>
                {videoInfo.bitrate > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Bitrate: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{fmtBitrate(videoInfo.bitrate)}</span>
                  </span>
                )}
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Größe: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{fmtFileSize(videoInfo.fileSize)}</span>
                </span>
                {videoInfo.isHdr && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                    background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: 'rgba(251,191,36,0.95)',
                  }}>
                    HDR
                  </span>
                )}
              </div>
            )}
            {videoPreviewUsages !== null && (
              <div className="audio-detail-usages">
                <span className="asset-usage-label">Verwendet in:</span>
                {videoPreviewUsages.length === 0
                  ? <span className="asset-usage-none">keinem Spiel</span>
                  : videoPreviewUsages.map((u, i) => (
                    <div key={i} className="audio-detail-usage-row">
                      <span
                        className={`asset-usage-tag${onNavigateToGame ? ' asset-usage-tag--clickable' : ''}`}
                        onClick={onNavigateToGame ? () => { closeVideoPreview(); onNavigateToGame(u.fileName, u.instance, u.questionIndices?.[0]); } : undefined}
                      >
                        {u.title}{u.instance ? ` · ${u.instance}` : ''}
                      </span>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Audio tracks info — read-only chips. The DAM preview plays the raw file and
             *  always uses the default track; there's no per-track picker here because the
             *  marker editor (VideoGuessForm) is where the operator picks the language that
             *  ends up in the gameshow cache. Incompatible codecs are marked so the operator
             *  knows why the preview is silent. */}
            {videoTracks.length > 0 && (
              <div className="audio-detail-usages" style={{ fontSize: 12 }}>
                <span className="asset-usage-label">Audio-Spuren:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {videoTracks.map((t, i) => {
                    const lang = t.language === 'deu' ? 'DE' : t.language === 'eng' ? 'EN' : t.language === 'fra' ? 'FR' : t.language === 'und' ? '?' : t.language.toUpperCase();
                    const isDefault = t.isDefault;
                    const compatible = t.browserCompatible;
                    return (
                      <span
                        key={i}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 11,
                          background: compatible ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                          border: `1px solid ${compatible ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                          color: compatible ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)',
                          fontWeight: isDefault ? 600 : 400,
                        }}
                        title={`${t.codecLong} — ${t.channels}ch ${t.channelLayout}${!compatible ? ' — nicht browserkompatibel, Vorschau ohne Ton' : ''}${isDefault ? ' — Standard-Tonspur' : ''}`}
                      >
                        {lang} · {t.codec.toUpperCase()} · {t.channels}ch{isDefault ? ' ⭐' : ''}{!compatible ? ' ⚠' : ''}
                      </span>
                    );
                  })}
                </div>
                <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                  Die Vorschau spielt immer die Standard-Tonspur (⭐). Zum Auswählen einer
                  anderen Sprache für die Gameshow den Marker-Editor verwenden.
                </div>
              </div>
            )}

            {/* HDR info — no full-file conversion anymore. When a video-guess question uses
             *  an HDR video with time markers, /videos-sdr/ tone-maps the segment on the fly
             *  into the persistent cache, so the pre-baked `-sdr.mp4` variant is obsolete. */}
            {videoInfo?.isHdr && (
              <div style={{ padding: '8px 16px', background: 'rgba(251,191,36,0.1)', borderTop: '1px solid rgba(251,191,36,0.3)', fontSize: 12 }}>
                <div style={{ color: 'rgba(251,191,36,0.9)' }}>
                  HDR-Video — im direkten Browser-Preview sind Farben grau/flach. In der
                  Gameshow wird der markierte Ausschnitt automatisch in SDR tone-gemappt.
                </div>
              </div>
            )}

            {/* Audio-codec hint — preview always plays the raw file, so incompatible codecs
             *  (AC3/DTS/etc.) are silent. The track-cache that the gameshow uses does
             *  transcode audio to AAC, so picking a language still makes sense. */}
            {videoNeedsTranscode && (
              <div style={{ padding: '8px 16px', background: 'rgba(251,191,36,0.1)', borderTop: '1px solid rgba(251,191,36,0.3)', fontSize: 12 }}>
                <div style={{ color: 'rgba(251,191,36,0.9)' }}>
                  ⚠ Keine browserkompatible Tonspur — die Vorschau ist stumm. Die gewählte
                  Sprache wird im Cache für die Gameshow zu AAC konvertiert und spielt dort
                  korrekt ab.
                </div>
              </div>
            )}
            {/* Full-file transcode progress/error panels removed — those jobs no longer exist. */}
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
                    <span
                      key={`${u.fileName}${u.instance ? `-${u.instance}` : ''}`}
                      className={`asset-usage-tag${onNavigateToGame ? ' asset-usage-tag--clickable' : ''}`}
                      onClick={onNavigateToGame ? () => { setPreviewImage(null); onNavigateToGame(u.fileName, u.instance, u.questionIndices?.[0]); } : undefined}
                    >
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

      {/* Bulk move modal */}
      {folderPrompt && (
        <FolderNamePrompt
          title={folderPrompt.title}
          onConfirm={name => {
            setFolderPrompt(null);
            if (folderPrompt.parentPath) {
              createSubfolder(folderPrompt.parentPath, name);
            } else {
              createFolder(name);
            }
          }}
          onCancel={() => setFolderPrompt(null)}
        />
      )}

      {bulkMoveModal && (
        <div className="modal-overlay" onClick={() => setBulkMoveModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>{selectedFiles.size} Datei{selectedFiles.size !== 1 ? 'en' : ''} verschieben</h2>
            <div style={{ maxHeight: 120, overflow: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
              {Array.from(selectedFiles).map(p => <div key={p}>{p}</div>)}
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Zielordner:</div>
            <div className="be-list-row" style={{ marginBottom: 16 }}>
              <input
                className="be-input"
                list="folder-paths-bulk"
                placeholder="Ordnerpfad (leer = Wurzel)"
                value={bulkMoveTarget}
                onChange={e => setBulkMoveTarget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBulkMove()}
                autoFocus
              />
              <datalist id="folder-paths-bulk">
                {allFolderPaths.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="be-list-row">
              <button className="be-btn-primary" onClick={handleBulkMove} disabled={bulkOperationInProgress}>
                {bulkOperationInProgress ? 'Wird verschoben…' : 'Verschieben'}
              </button>
              <button className="be-icon-btn" onClick={() => setBulkMoveModal(false)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* Audio cover fetch modal */}
      {audioCoverModal && (
        <PickerModal
          category={activeCategory}
          multiSelect
          multiSelectLabel="Audio Covers laden"
          hiddenBasenames={existingCovers}
          rateLimitedFiles={lastRateLimitedFiles}
          onSelect={() => {}}
          onMultiSelect={(selectedFiles) => {
            startAudioCoverFetch(selectedFiles, () => {
              load({ showLoading: false, preserveScroll: true });
            });
            setAudioCoverModal(false);
          }}
          onClose={() => setAudioCoverModal(false)}
        />
      )}

      {/* YouTube download modal */}
      {ytModal && (() => {
        const urlIsPlaylist = isAudioCategory && isPlaylistUrl(ytUrl.trim());
        return (
          <div className="modal-overlay" onClick={() => setYtModal(false)}>
            <div className="modal-box yt-modal" onClick={e => e.stopPropagation()}>
              <h2>YouTube Download</h2>
              <input
                className="be-input"
                placeholder="YouTube URL einfügen"
                value={ytUrl}
                onChange={e => setYtUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  if (urlIsPlaylist) return; // must choose playlist or single
                  handleYoutubeDownload();
                }}
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
              {urlIsPlaylist && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: '8px 0 4px' }}>
                  Playlist erkannt — was soll heruntergeladen werden?
                </div>
              )}
              <div className="yt-modal-actions">
                {urlIsPlaylist ? (
                  <>
                    <button className="be-btn-primary" onClick={() => handleYoutubeDownload(true)} disabled={!ytUrl.trim()}>Ganze Playlist</button>
                    <button className="be-btn-primary" onClick={() => handleYoutubeDownload(false)} disabled={!ytUrl.trim()}>Einzelnes Video</button>
                    <button className="be-btn-secondary" onClick={() => setYtModal(false)}>Abbrechen</button>
                  </>
                ) : (
                  <>
                    <button className="be-btn-primary" onClick={() => handleYoutubeDownload()} disabled={!ytUrl.trim()}>Herunterladen</button>
                    <button className="be-btn-secondary" onClick={() => setYtModal(false)}>Abbrechen</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Image URL download modal */}
      {imgUrlModal && (
        <div className="modal-overlay" onClick={() => setImgUrlModal(false)}>
          <div className="modal-box yt-modal" onClick={e => e.stopPropagation()}>
            <h2>Bild von URL herunterladen</h2>
            <input
              className="be-input"
              placeholder="Bild-URL einfügen"
              value={imgUrl}
              onChange={e => setImgUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleImageUrlDownload(); }}
              autoFocus
            />
            {allFolderPaths.length > 0 && (
              <select
                className="be-input"
                value={imgUrlSubfolder}
                onChange={e => setImgUrlSubfolder(e.target.value)}
              >
                <option value="">Stammordner</option>
                {allFolderPaths.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <div className="yt-modal-actions">
              <button className="be-btn-primary" onClick={handleImageUrlDownload} disabled={!imgUrl.trim() || imgUrlLoading}>
                {imgUrlLoading ? 'Lädt…' : 'Herunterladen'}
              </button>
              <button className="be-btn-secondary" onClick={() => setImgUrlModal(false)} disabled={imgUrlLoading}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
