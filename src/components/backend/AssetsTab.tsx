import { useState, useEffect, useMemo, useRef } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import { assetUrl } from '@/utils/assetUrl';
import type { AssetCategory, AssetFolder, AssetFileMeta } from '@/types/config';
import { fetchAssets, fetchVideoCover, deleteAsset, moveAsset, mergeAsset, fetchAssetUsages, fetchAssetCategoryUsages, fetchAssetHashes, createAssetFolder, probeVideo, fetchAudioCoverList, downloadImageFromUrl, faststartVideo, fetchFaststartStatus, undoLastDelete, fetchAudioCoverMeta, overrideAudioCover, setItunesAudioCover, listTrash, fetchImageDimensions, type VideoTrackInfo, type VideoStreamInfo, type AudioCoverMetaMap, type AudioCoverSource, type ItunesCoverCandidate } from '@/services/backendApi';
import TrashView from './TrashView';
import VideoTranscriptionPanel from './VideoTranscriptionPanel';
import { useWsChannel } from '@/services/useBackendSocket';
import { PickerModal, matchesSearchKey, tokenizeSearch, buildSearchKey } from './AssetPicker';
import StatusMessage, { type ToastMessage, type ToastAction } from './StatusMessage';
import FolderNamePrompt from './FolderNamePrompt';
import DeleteConfirmModal, { type DeleteItem } from './DeleteConfirmModal';
import ReplaceImageModal from './ReplaceImageModal';
import ImageSearchUploadModal from './ImageSearchUploadModal';
import YouTubeSearchPanel from './YouTubeSearchPanel';
import type { YouTubeSearchResult } from '@/services/backendApi';
import ReferenceBrowser from './ReferenceBrowser';
import MiniAudioPlayer from './MiniAudioPlayer';
import AudioTrimTimeline from './AudioTrimTimeline';
import { useUpload } from './UploadContext';
import { useVideoPlayback } from '@/services/useVideoPlayback';
import { getBrowserVideoWarning } from '@/services/browserVideoCompat';

// Merge icon — two lines converging into one arrow pointing down. Used in the
// preview modal headers to open the merge-with-another-asset flow.
// Render boxes + folder-path helpers live in ./assetFolders so AssetPicker can
// re-use them without creating an import cycle.
import { RENDER_BOX_QUIZ, RENDER_BOX_IMAGE_GUESS, getAllFolderPaths } from './assetFolders';
export { RENDER_BOX_QUIZ, RENDER_BOX_IMAGE_GUESS };

const mergeIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4 L12 12" />
    <path d="M19 4 L12 12" />
    <path d="M12 12 L12 20" />
    <path d="M8 16 L12 20 L16 16" />
  </svg>
);

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// `fmtEta` was used for transcode-job ETA rendering (a UI we removed alongside the full-
// file transcode mechanic). Keep the one-off formatter out of the file — if an ETA ever
// comes back, it should live next to the caller.

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
 * Derive the audio cover filename from an audio filename (basename + .jpg).
 * Must match audioCoverFilename in server/audio-covers.ts.
 */
function audioCoverFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') + '.jpg';
}

/**
 * Audio cover thumbnail: renders the cover image if present, hides on 404.
 * `version` cache-busts after a new cover is fetched (mirror of VideoThumb).
 */
function AudioCover({ filePath, version, className, onClick }: { filePath: string; version?: number; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (version) setHidden(false); }, [version]);
  if (hidden) return null;
  const basename = filePath.split('/').pop()!;
  const coverName = audioCoverFilename(basename);
  const cacheBust = version ? `?v=${version}` : '';
  return (
    <img
      src={`/images/Audio-Covers/${coverName}${cacheBust}`}
      className={className}
      draggable={false}
      onError={() => setHidden(true)}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    />
  );
}

/**
 * Movie poster thumbnail: renders `/images/Movie Posters/{slug}.jpg`, hides on 404.
 * Used inside the video preview modal so the operator sees the cover next to the player.
 */
function MoviePoster({ filePath, version, className, onClick }: { filePath: string; version?: number; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (version) setHidden(false); }, [version]);
  if (hidden) return null;
  const basename = filePath.split('/').pop()!;
  const slug = videoFilenameToSlug(basename);
  const cacheBust = version ? `?v=${version}` : '';
  return (
    <img
      src={`/images/Movie Posters/${slug}.jpg${cacheBust}`}
      className={className}
      draggable={false}
      onError={() => setHidden(true)}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    />
  );
}

/**
 * Video thumbnail: shows movie poster if available, otherwise a non-black
 * video frame (seeks to 10% of duration, capped at 5 s).
 */
function VideoThumb({ file, src, posterVersion, onPosterClick }: { file: string; src: string; posterVersion?: number; onPosterClick?: (e: React.MouseEvent) => void }) {
  const [showVideo, setShowVideo] = useState(false);
  const slug = videoFilenameToSlug(file);
  const cacheBust = posterVersion ? `?v=${posterVersion}` : '';
  // When a new poster is fetched (posterVersion changes), retry the poster image
  useEffect(() => { if (posterVersion) setShowVideo(false); }, [posterVersion]);
  if (!showVideo) {
    return (
      <img
        src={`/images/Movie Posters/${slug}.jpg${cacheBust}`}
        className="asset-file-video-thumb"
        draggable={false}
        onError={() => setShowVideo(true)}
        onClick={onPosterClick}
        style={onPosterClick ? { cursor: 'pointer' } : undefined}
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

// Cross-category moves are permitted only between audio and background-music. Any drop or
// modal target outside this pair is rejected client-side (the server re-validates).
const CROSS_MOVE_PAIR = new Map<AssetCategory, AssetCategory>([
  ['audio', 'background-music'],
  ['background-music', 'audio'],
]);
const canCrossMove = (c: AssetCategory): boolean => CROSS_MOVE_PAIR.has(c);
const crossCategoryOf = (c: AssetCategory): AssetCategory | undefined => CROSS_MOVE_PAIR.get(c);
function isReservedAudioSubpath(from: string): boolean {
  const first = from.split('/')[0];
  return first === 'bandle' || first === 'backup';
}

interface GameUsage { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[]; questionIndices?: number[]; }
interface PosterModal { fileName: string; status: 'loading' | 'done' | 'error'; logs: string[]; posterPath: string | null; error?: string; }
interface MoveState { filePath: string; name: string; }

// Combobox for picking a destination folder: free-typing plus a dropdown of all known
// folder paths filtered by the current input. Empty value represents the category root.
function FolderCombobox({
  value,
  onChange,
  options,
  onSubmit,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onSubmit?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const filtered = q
    ? options.filter(p => p.toLowerCase().includes(q))
    : options;
  const items: { label: string; value: string }[] = [
    { label: '(Stammordner)', value: '' },
    ...filtered.map(p => ({ label: p, value: p })),
  ];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => { setHighlight(0); }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div ref={wrapRef} className="be-combobox">
      <input
        className="be-input"
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); } }
          else if (e.key === 'Enter') {
            if (open && items[highlight]) { e.preventDefault(); pick(items[highlight].value); }
            else if (onSubmit) { onSubmit(); }
          }
        }}
        autoFocus={autoFocus}
      />
      {open && items.length > 0 && (
        <div ref={listRef} className="be-combobox-menu" role="listbox">
          {items.map((item, i) => (
            <div
              key={item.value || '__root__'}
              role="option"
              aria-selected={highlight === i}
              className={`be-combobox-option${highlight === i ? ' active' : ''}${value === item.value ? ' selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(item.value); }}
              onMouseEnter={() => setHighlight(i)}
            >{item.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function countFolderTotals(folder: AssetFolder): { files: number; folders: number } {
  let files = folder.files.length;
  let folders = folder.subfolders.length;
  for (const sub of folder.subfolders) {
    const sub_ = countFolderTotals(sub);
    files += sub_.files;
    folders += sub_.folders;
  }
  return { files, folders };
}

/** Recursively merge WS-pushed durations into folder tree. Returns new refs only if changed. */
function mergeDurationsIntoFolders(folders: AssetFolder[], durations: Record<string, number>, prefix: string): AssetFolder[] {
  let anyChanged = false;
  const result = folders.map(f => {
    const folderPrefix = prefix ? `${prefix}/${f.name}` : f.name;
    let metaChanged = false;
    const newMeta = f.fileMeta ? { ...f.fileMeta } : {};
    for (const file of f.files) {
      const relPath = `${folderPrefix}/${file}`;
      if (durations[relPath] !== undefined && newMeta[file] && newMeta[file].duration === undefined) {
        newMeta[file] = { ...newMeta[file], duration: durations[relPath] };
        metaChanged = true;
      }
    }
    const newSubs = mergeDurationsIntoFolders(f.subfolders, durations, folderPrefix);
    if (metaChanged || newSubs !== f.subfolders) {
      anyChanged = true;
      return { ...f, fileMeta: metaChanged ? newMeta : f.fileMeta, subfolders: newSubs };
    }
    return f;
  });
  return anyChanged ? result : folders;
}

/** Mirror of mergeDurationsIntoFolders for image dimensions arriving via WS push. */
function mergeDimensionsIntoFolders(folders: AssetFolder[], dimensions: Record<string, { width: number; height: number }>, prefix: string): AssetFolder[] {
  let anyChanged = false;
  const result = folders.map(f => {
    const folderPrefix = prefix ? `${prefix}/${f.name}` : f.name;
    let metaChanged = false;
    const newMeta = f.fileMeta ? { ...f.fileMeta } : {};
    for (const file of f.files) {
      const relPath = `${folderPrefix}/${file}`;
      if (dimensions[relPath] !== undefined && newMeta[file] && newMeta[file].dimensions === undefined) {
        newMeta[file] = { ...newMeta[file], dimensions: dimensions[relPath] };
        metaChanged = true;
      }
    }
    const newSubs = mergeDimensionsIntoFolders(f.subfolders, dimensions, folderPrefix);
    if (metaChanged || newSubs !== f.subfolders) {
      anyChanged = true;
      return { ...f, fileMeta: metaChanged ? newMeta : f.fileMeta, subfolders: newSubs };
    }
    return f;
  });
  return anyChanged ? result : folders;
}

type SortField = 'name' | 'date' | 'size' | 'type' | 'duration' | 'resolution';

function pixelArea(meta: AssetFileMeta | undefined): number {
  if (!meta?.dimensions) return -1;
  return meta.dimensions.width * meta.dimensions.height;
}

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
    } else if (sortBy === 'duration') {
      const da = meta?.[a]?.duration ?? -1;
      const db = meta?.[b]?.duration ?? -1;
      cmp = db - da; // longest first by default
    } else if (sortBy === 'resolution') {
      // Sort by pixel area (width × height). Files without dimensions (SVGs, unprobed)
      // sort to the end on the default direction.
      cmp = pixelArea(meta?.[b]) - pixelArea(meta?.[a]);
    }
    return cmp;
  });
  return sortReverse ? sorted.reverse() : sorted;
}

// Collect all files with their folder paths for search.
// `searchKey` is precomputed (lowercased + separator-normalized) so the per-keystroke
// filter doesn't pay the toLowerCase/replace cost across 100k+ entries.
interface FileEntry { file: string; filePath: string; folder: string | null; meta?: AssetFileMeta; searchKey: string; }
function collectAllFiles(rootFiles: string[], rootMeta: Record<string, AssetFileMeta> | undefined, folders: AssetFolder[], prefix = ''): FileEntry[] {
  const entries: FileEntry[] = rootFiles.map(f => ({ file: f, filePath: f, folder: null, meta: rootMeta?.[f], searchKey: buildSearchKey(f) }));
  const walk = (subs: AssetFolder[], pre: string) => {
    for (const folder of subs) {
      const fp = pre ? `${pre}/${folder.name}` : folder.name;
      for (const file of folder.files) {
        entries.push({ file, filePath: `${fp}/${file}`, folder: fp, meta: folder.fileMeta?.[file], searchKey: buildSearchKey(file) });
      }
      walk(folder.subfolders, fp);
    }
  };
  walk(folders, prefix);
  return entries;
}

// Recursively filter the folder tree by a per-file predicate. Files that fail the
// predicate are dropped; folders with no surviving descendants (files or subfolders)
// disappear. `surviving` is filled with the paths of every folder that remains, so
// the caller can auto-expand them during filtered render.
function filterFolderTree(
  folders: AssetFolder[],
  predicate: (filePath: string) => boolean,
  surviving: Set<string>,
  prefix = '',
): AssetFolder[] {
  const out: AssetFolder[] = [];
  for (const f of folders) {
    const fp = prefix ? `${prefix}/${f.name}` : f.name;
    const filteredFiles = f.files.filter(file => predicate(`${fp}/${file}`));
    const filteredSubs = filterFolderTree(f.subfolders, predicate, surviving, fp);
    if (filteredFiles.length > 0 || filteredSubs.length > 0) {
      surviving.add(fp);
      out.push({ ...f, files: filteredFiles, subfolders: filteredSubs });
    }
  }
  return out;
}

// Module-scoped ref for the current folder drag payload. Populated on a folder header's
// onDragStart and cleared on dragend. Read by DropZone during dragenter/dragover to decide
// whether the drop is valid (self/descendant/same-parent are rejected client-side).
let currentFolderDrag: string[] = [];

function isFolderDropValid(sourcePaths: string[], targetFolderPath: string): boolean {
  for (const src of sourcePaths) {
    if (src === targetFolderPath) return false;                      // onto itself
    if (targetFolderPath.startsWith(src + '/')) return false;        // into a descendant
    const parent = src.includes('/') ? src.substring(0, src.lastIndexOf('/')) : '';
    if (parent === targetFolderPath) return false;                   // no-op (same parent)
  }
  return true;
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
  onFolderDrop,
  onFolderMultiDrop,
  onUrlDrop,
  targetFolderPath,
  className = '',
  noClick = false,
  style,
  children,
}: {
  onFileDrop: (files: File[]) => void;
  onAssetDrop?: (assetPath: string) => void;
  onAssetMultiDrop?: (assetPaths: string[]) => void;
  onFolderDrop?: (folderPath: string) => void;
  onFolderMultiDrop?: (folderPaths: string[]) => void;
  onUrlDrop?: (urls: string[]) => void;
  // Path of the folder this DropZone represents. Undefined / empty = root. Used to
  // validate folder drags (can't drop a folder into itself, a descendant, or its
  // own parent).
  targetFolderPath?: string;
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
  const folderDropRef = useRef(onFolderDrop);
  folderDropRef.current = onFolderDrop;
  const folderMultiDropRef = useRef(onFolderMultiDrop);
  folderMultiDropRef.current = onFolderMultiDrop;
  const urlDropRef = useRef(onUrlDrop);
  urlDropRef.current = onUrlDrop;
  const targetPathRef = useRef(targetFolderPath ?? '');
  targetPathRef.current = targetFolderPath ?? '';
  // Latched per-enter: whether the currently hovering drag is a valid drop here.
  // Read by onOver (to set dropEffect) and onDrop (to short-circuit invalid drops).
  const isValidDragRef = useRef(true);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    const evaluateValidity = (dt: DataTransfer | null): boolean => {
      if (!dt) return true;
      // Folder drags: validate against currentFolderDrag (dataTransfer values aren't
      // readable during dragenter/dragover — only types are). We populate
      // currentFolderDrag in the folder header's onDragStart.
      if (currentFolderDrag.length > 0) {
        return isFolderDropValid(currentFolderDrag, targetPathRef.current);
      }
      return true;
    };

    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      counter.current++;
      if (counter.current === 1) {
        isValidDragRef.current = evaluateValidity(e.dataTransfer);
        if (isValidDragRef.current) setIsDragActive(true);
      }
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      // Stop bubbling so a nested outer DropZone (e.g. the root-drop gutter wrapping
      // the folder list) can't override this zone's dropEffect. Without this, dragging
      // a root folder over another root folder row reads the outer zone's "same parent
      // no-op" verdict and stamps dropEffect=none onto the valid inner drop.
      e.stopPropagation();
      if (!isValidDragRef.current && e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
      }
    };
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
      if (!isValidDragRef.current) return;
      const dt = e.dataTransfer;
      if (!dt) return;

      const files = Array.from(dt.files);
      if (files.length > 0) {
        callbackRef.current(files);
        return;
      }

      let folderPaths: string[] = [];
      const multiFolderRaw = dt.getData('text/asset-folder-paths');
      if (multiFolderRaw) {
        try { folderPaths = JSON.parse(multiFolderRaw) as string[]; } catch { /* ignore */ }
      }
      if (folderPaths.length === 0) {
        const singleFolder = dt.getData('text/asset-folder-path');
        if (singleFolder) folderPaths = [singleFolder];
      }

      let filePaths: string[] = [];
      const multiAssetRaw = dt.getData('text/asset-paths');
      if (multiAssetRaw) {
        try { filePaths = JSON.parse(multiAssetRaw) as string[]; } catch { /* ignore */ }
      }
      if (filePaths.length === 0) {
        const singleAsset = dt.getData('text/asset-path');
        if (singleAsset) filePaths = [singleAsset];
      }

      if (folderPaths.length === 0 && filePaths.length === 0) {
        // External browser window: image/link dragged from another tab
        if (urlDropRef.current) {
          const urls = extractDroppedUrls(dt);
          if (urls.length > 0) urlDropRef.current(urls);
        }
        return;
      }

      if (folderPaths.length > 1 && folderMultiDropRef.current) folderMultiDropRef.current(folderPaths);
      else if (folderPaths.length === 1) {
        if (folderDropRef.current) folderDropRef.current(folderPaths[0]);
        else if (folderMultiDropRef.current) folderMultiDropRef.current(folderPaths);
      }

      if (filePaths.length > 1 && assetMultiDropRef.current) assetMultiDropRef.current(filePaths);
      else if (filePaths.length === 1) {
        if (assetDropRef.current) assetDropRef.current(filePaths[0]);
        else if (assetMultiDropRef.current) assetMultiDropRef.current(filePaths);
      }
    };

    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);

    // dragenter/dragleave bubble, so an ancestor DropZone's counter increments while
    // hovering a descendant DropZone. If the drop lands on the descendant, its onDrop
    // calls stopPropagation — the ancestor never sees drop and stays "dragover" with a
    // stuck dashed outline. Reset on any global terminator in capture phase so we run
    // before stopPropagation can block us.
    const onGlobalEnd = () => {
      counter.current = 0;
      setIsDragActive(false);
    };
    document.addEventListener('drop', onGlobalEnd, true);
    document.addEventListener('dragend', onGlobalEnd, true);

    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
      document.removeEventListener('drop', onGlobalEnd, true);
      document.removeEventListener('dragend', onGlobalEnd, true);
    };
  }, []);  

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
    setSelectedFolders(new Set());
    setInTrashView(false);
    lastClickedFileRef.current = null;
    baseSelectionRef.current = new Set();
    lastClickedFolderRef.current = null;
    baseFolderSelectionRef.current = new Set();
    // Usage cache is per-category; drop it so the next active filter refetches.
    setUsedFiles(null);
    setImageGuessFiles(null);
    setImageDimensions(null);
    // Image-only sort/filter state must reset when leaving the images category.
    if (cat !== 'images') {
      setLowResFilter(false);
      if (sortBy === 'resolution') {
        setSortBy('name');
        setSortReverse(false);
      }
    }
    if (cat === 'images' && sortBy === 'duration') {
      setSortBy('name');
      setSortReverse(false);
    }
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
  // `renamingFile` stores a composite "slot" key — the same file appears in both
  // the list (background) and any open preview modal, and they must not collide.
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState('');
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    items: DeleteItem[];
    onConfirm: () => Promise<void>;
    busy: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);
  const [previewUsages, setPreviewUsages] = useState<GameUsage[] | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  // Per-image-path version map for cache-busting after a replace: appended as `?v=…`.
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const [audioPreview, setAudioPreview] = useState<{ filePath: string; src: string } | null>(null);
  const [audioPreviewUsages, setAudioPreviewUsages] = useState<GameUsage[] | null>(null);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ filePath: string; src: string } | null>(null);
  const [videoPreviewUsages, setVideoPreviewUsages] = useState<GameUsage[] | null>(null);
  const [videoPreviewDuration, setVideoPreviewDuration] = useState(0);
  const [videoTracks, setVideoTracks] = useState<VideoTrackInfo[]>([]);
  const [videoNeedsTranscode, setVideoNeedsTranscode] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoStreamInfo | null>(null);
  // Faststart remux state — decoupled from the HTTP request so a browser reload doesn't
  // lose progress:
  //   - `faststartRunning` = UI flag (button disabled, progress bar visible)
  //   - `faststartProgress` = 0..100, driven by the server's SSE `{ percent }` events
  //   - `faststartError`    = last error message, cleared on next click
  // When the modal opens we probe `fetchFaststartStatus` — if ffmpeg is already running
  // for this file (e.g. the user kicked it off earlier and hit reload), we jump straight
  // back into the subscribed-to-progress state instead of showing a fresh button.
  const [faststartRunning, setFaststartRunning] = useState(false);
  const [faststartProgress, setFaststartProgress] = useState(0);
  const [faststartError, setFaststartError] = useState<string | null>(null);
  // `videoPreviewTrack` was the "selected language" for the DAM preview back when the
  // modal swapped the `<video src>` to `/videos-track/{N}/`. That mechanic is gone (DAM
  // plays the raw file), so the state isn't needed — the language chips under the video
  // are purely informational, and the cache's track is picked in the marker editor.
  // Full-file transcoding (HDR→SDR and audio→AAC whole-file) has also been removed.
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  // Destination category for the move modal. Defaults to the active category; shown in
  // the modal only when `canCrossMove(activeCategory)` (audio ↔ background-music).
  const [moveTargetCategory, setMoveTargetCategory] = useState<AssetCategory>(activeCategory);
  // Merge flow — two phases. `picker`: user is choosing the second asset.
  // `compare`: both assets chosen, user picks which to keep and confirms.
  const [mergeState, setMergeState] = useState<
    | { stage: 'picker'; source: string }
    | { stage: 'compare'; source: string; target: string; sourceUsages: GameUsage[] | null; targetUsages: GameUsage[] | null; keep: 'source' | 'target'; running: boolean }
    | null
  >(null);
  // Image dimensions captured in the merge compare modal (via `<img onLoad>`).
  // Keyed on the panel side so the source/target images don't overwrite each
  // other.
  const [mergeDims, setMergeDims] = useState<{ source: { w: number; h: number } | null; target: { w: number; h: number } | null }>({ source: null, target: null });
  // Whether the two files in the merge compare modal have identical content (same hash).
  const [mergeIdentical, setMergeIdentical] = useState<boolean | null>(null);
  // Reset the captured dimensions when the merge's file pair changes so a
  // second compare doesn't inherit the first compare's numbers.
  const mergePairKey = mergeState?.stage === 'compare' ? `${mergeState.source}|${mergeState.target}` : '';
  useEffect(() => { setMergeDims({ source: null, target: null }); setMergeIdentical(null); }, [mergePairKey]);
  // Multi-file merge (deduplication from selection mode). Groups files by hash,
  // then user picks which file to keep (single winner across all groups).
  const [multiMergeState, setMultiMergeState] = useState<{
    stage: 'loading' | 'compare';
    files: string[];
    hashes: Record<string, string> | null; // filePath → hash
    hashGroups: Map<string, string[]> | null; // hash → filePaths
    keep: string; // single filePath to keep
    usages: Record<string, GameUsage[]> | null; // filePath → usages
    running: boolean;
  } | null>(null);
  // Image dimensions for multi-merge file panes (captured via img onLoad).
  const [multiMergeDims, setMultiMergeDims] = useState<Record<string, { w: number; h: number }>>({});
  const [posterModal, setPosterModal] = useState<PosterModal | null>(null);
  // Per-slug cache-bust counter for the DAM video thumbnail. Bumped after
  // "Filmcover laden" so the newly-regenerated poster replaces the cached
  // image immediately (server caches the JPG for 5 min — see server/index.ts
  // staticOptions).
  const [posterVersions, setPosterVersions] = useState<Record<string, number>>({});
  // Audio-cover cache-busting: keyed by cover filename (basename.jpg) so that when the
  // bulk audio-cover loader finishes, the currently-open audio modal picks up the new file.
  const [coverVersions, setCoverVersions] = useState<Record<string, number>>({});
  // Audio-cover provenance (source pill in the audio preview modal). Fetched on mount
  // and refreshed whenever the images category changes. See specs/audio-cover-override.md.
  const [audioCoverMeta, setAudioCoverMeta] = useState<AudioCoverMetaMap>({});
  // Monotonic fetch counter — drop stale responses so an older in-flight fetch
  // can't clobber a fresher one (e.g. user overrides a cover while the initial
  // mount fetch is still on the wire). Prevents the pill from "jumping back".
  const audioCoverMetaFetchId = useRef(0);
  const refreshAudioCoverMeta = () => {
    const id = ++audioCoverMetaFetchId.current;
    fetchAudioCoverMeta()
      .then(meta => { if (id === audioCoverMetaFetchId.current) setAudioCoverMeta(meta); })
      .catch(() => { /* non-fatal */ });
  };
  // Picker modal state for "Cover überschreiben…"
  const [coverOverrideFor, setCoverOverrideFor] = useState<string | null>(null);
  // iTunes unconfident-match confirmation state
  const [itunesCandidate, setItunesCandidate] = useState<{ audioFileName: string; confirmToken: string; candidate: ItunesCoverCandidate } | null>(null);
  const [itunesBusy, setItunesBusy] = useState(false);
  const [storageMode, setStorageMode] = useState<'local' | null>(null);
  const [nasMounted, setNasMounted] = useState(false);
  const [ytModal, setYtModal] = useState(false);
  const [ytTab, setYtTab] = useState<'url' | 'search'>('search');
  const [ytSearchPick, setYtSearchPick] = useState<YouTubeSearchResult | null>(null);
  const [ytUrl, setYtUrl] = useState('');
  const [ytSubfolder, setYtSubfolder] = useState('');
  const [refBrowserOpen, setRefBrowserOpen] = useState(false);
  const [imgUrlModal, setImgUrlModal] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [imgUrlSubfolder, setImgUrlSubfolder] = useState('');
  const [imgUrlLoading, setImgUrlLoading] = useState(false);
  const [imageSearchModal, setImageSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSort, setShowSort] = useState(false);
  // "Verwendet / Unbenutzt" filter. `null` = show all; the two filter values are mutually
  // exclusive in the popover. Backed by `usedFiles`, which is lazy-fetched per category
  // on first activation and invalidated on category switch + any mutation that changes
  // game refs. See specs/admin-backend.md "Usage filter".
  const [usageFilter, setUsageFilter] = useState<'used' | 'unused' | null>(null);
  const [usedFiles, setUsedFiles] = useState<Set<string> | null>(null);
  const [imageGuessFiles, setImageGuessFiles] = useState<Set<string> | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  // "Niedrige Auflösung" filter — images smaller than the bounding box of the game they
  // appear in (image-guess: 1920×648; everything else / unused: 1920×540). Threshold is
  // applied client-side using `imageGuessFiles` from the usages call.
  const [lowResFilter, setLowResFilter] = useState<boolean>(false);
  // Eager-loaded natural pixel dimensions for every probeable raster image in the
  // active category. Filled by a single synchronous call to
  // `/api/backend/assets/:category/dimensions` (probes anything missing from the
  // server-side cache). Backs the resolution sort and the low-res filter.
  //   - null    → not loaded yet
  //   - Map     → loaded; missing keys are SVGs or unreadable files
  // Reset on category change and after every `load()` so post-mutation paths refetch.
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }> | null>(null);
  const [dimensionsLoading, setDimensionsLoading] = useState(false);
  // Loading + error + decode-recovery are handled by the shared `useVideoPlayback` hook
  // below (same code path the marker editor uses). `videoPreviewLoading` / `videoPreviewError`
  // here are the destructured values from that hook — kept under these names to avoid a
  // larger rename churn in the JSX.
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
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [bulkOperationInProgress, setBulkOperationInProgress] = useState(false);
  const [bulkMoveModal, setBulkMoveModal] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');
  const [bulkMoveTargetCategory, setBulkMoveTargetCategory] = useState<AssetCategory>(activeCategory);
  // Folder listing for the opposite category, fetched lazily when the user picks it as the
  // move destination. Keyed by category so switching tabs doesn't stale the cache.
  const [crossFolderData, setCrossFolderData] = useState<{ category: AssetCategory; paths: string[] } | null>(null);
  const lastClickedFileRef = useRef<string | null>(null);
  const baseSelectionRef = useRef<Set<string>>(new Set());
  const lastClickedFolderRef = useRef<string | null>(null);
  const baseFolderSelectionRef = useRef<Set<string>>(new Set());
  const currentCat = CATEGORIES.find(c => c.id === activeCategory)!;
  // Papierkorb (trash view): pseudo-folder entry + dedicated subview.
  // `trashCount` drives the count badge on the entry-point row and is refreshed via
  // a lightweight listTrash() call after each main load() and on `assets-changed` events.
  const [inTrashView, setInTrashView] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

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
        setSelectedFolders(new Set());
        lastClickedFileRef.current = null;
        baseSelectionRef.current = new Set();
        lastClickedFolderRef.current = null;
        baseFolderSelectionRef.current = new Set();
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

      // Chrome names every pasted image "image.png" — uniquify so repeated
      // pastes don't silently overwrite each other.
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const ext = file.name.includes('.')
              ? file.name.split('.').pop()!.toLowerCase()
              : (file.type.split('/')[1] || 'png');
            const suffix = imageFiles.length > 0 ? `-${imageFiles.length}` : '';
            const renamed = new File([file], `pasted-${ts}${suffix}.${ext}`, { type: file.type });
            imageFiles.push(renamed);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleUpload(imageFiles).then(() => {
          // Scroll to top so the freshly pasted image (uploaded to root) is visible.
          // Delay past load()'s double-RAF preserveScroll restore.
          setTimeout(() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
        });
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

  // Receive DAM mutation notifications via WebSocket and reload when they target the
  // active category. Debounced so bursty events (e.g. per-track playlist downloads, or
  // a YT download that emits `<category>` + `images` back-to-back) collapse into a
  // single fetch.
  //
  // `keepCaches: true` here so an `assets-changed` event triggered by *our own*
  // mutation (e.g. replace, which already patched the caches surgically) doesn't
  // null the filter-backing maps a moment later — which used to flash the
  // unfiltered tree open for ~500ms. Remote-originated mutations may now leave
  // the usage/dimensions caches slightly stale until the user switches category,
  // which is far less jarring than the flicker.
  const assetsChangedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWsChannel<{ category: string }>('assets-changed', (data) => {
    if (data.category === 'images') refreshAudioCoverMeta();
    if (data.category !== activeCategory) return;
    if (assetsChangedTimer.current) clearTimeout(assetsChangedTimer.current);
    assetsChangedTimer.current = setTimeout(() => {
      assetsChangedTimer.current = null;
      load({ showLoading: false, preserveScroll: true, keepCaches: true });
    }, 300);
    // Trash view has its own debounced listener; here we only refresh the
    // pseudo-folder count badge so it stays accurate while the user is in the
    // normal file browser.
    refreshTrashCount();
  });

  useEffect(() => {
    refreshAudioCoverMeta();
     
  }, []);

  // Receive background-probed durations via WebSocket and merge into fileMeta / subfolder meta
  useWsChannel<{ category: string; durations: Record<string, number> }>('asset-duration', (data) => {
    if (data.category !== activeCategory) return;
    const durations = data.durations;
    // Merge root-level durations
    setFileMeta(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [relPath, dur] of Object.entries(durations)) {
        if (!relPath.includes('/') && next[relPath] && next[relPath].duration === undefined) {
          next[relPath] = { ...next[relPath], duration: dur };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Merge subfolder durations
    setSubfolders(prev => {
      const updated = mergeDurationsIntoFolders(prev, durations, '');
      return updated !== prev ? updated : prev;
    });
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
      const h    = rect.height;
      if (h <= 0) return;
      // Cap zones to a third of the scroller so a short scroller (small browser window,
      // devtools open) can never have its top/bottom zones overlap. Without this, when
      // h < TOP_ZONE + BOT_ZONE the scroll-down zone swallows everything past the top
      // 100px, so cursor positions that look "near the top" still scroll down.
      const topZone = Math.min(TOP_ZONE, h / 3);
      const botZone = Math.min(BOT_ZONE, h / 3);
      // Clamp the cursor to the scroller bounds: anything outside the visible scroller
      // top/bottom edge maps to scrolling at MAX_SPEED, not faster.
      const clampedY = Math.max(rect.top, Math.min(rect.bottom, dragY));
      const relY = clampedY - rect.top;
      let speed = 0;
      if (relY < topZone) {
        const t = 1 - relY / topZone;
        speed = -MAX_SPEED * (MIN_FRAC + (1 - MIN_FRAC) * t);
      } else if (relY > h - botZone) {
        const t = (relY - (h - botZone)) / botZone;
        speed = MAX_SPEED * (MIN_FRAC + (1 - MIN_FRAC) * t);
      }
      if (speed !== 0) scroller.scrollBy(0, speed);
    };

    const onPointerMove = (e: PointerEvent) => { dragY = e.clientY; };
    const onDragOver    = (e: DragEvent)    => { e.preventDefault(); if (e.clientY > 0) dragY = e.clientY; };
    const onDrag        = (e: DragEvent)    => { if (e.clientY > 0) dragY = e.clientY; };
    const onStop  = () => { dragY = -1; if (timer) { clearInterval(timer); timer = null; } };
    // Stop any leaked timer before starting a new one — Chrome occasionally drops `dragend`
    // when the drag source is unmounted mid-drag (e.g. dropping a folder into another folder
    // re-renders the tree). Without this guard the scroll loop runs forever; pointerup/mouseup
    // serve as the actual safety net that fires regardless of DnD state.
    const onStart = () => { onStop(); timer = setInterval(tick, 16); };

    document.addEventListener('dragstart',   onStart);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('drag',        onDrag);
    // Capture phase: every inner DropZone stops dragover/drop propagation to keep
    // dropEffect correct against the root-drop gutter. A bubble-phase listener here
    // would miss every dragover the cursor spends over a folder row or the upload
    // zone, leaving dragY stale and making the autoscroll tick stutter near the top.
    document.addEventListener('dragover',    onDragOver, true);
    document.addEventListener('dragend',     onStop);
    document.addEventListener('drop',        onStop,     true);
    document.addEventListener('pointerup',   onStop);
    document.addEventListener('mouseup',     onStop);
    window.addEventListener('blur',          onStop);
    return () => {
      document.removeEventListener('dragstart',   onStart);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('drag',        onDrag);
      document.removeEventListener('dragover',    onDragOver, true);
      document.removeEventListener('dragend',     onStop);
      document.removeEventListener('drop',        onStop,     true);
      document.removeEventListener('pointerup',   onStop);
      document.removeEventListener('mouseup',     onStop);
      window.removeEventListener('blur',          onStop);
      if (timer) clearInterval(timer);
    };
  }, []);


  const load = async (opts?: { showLoading?: boolean; preserveScroll?: boolean; keepCaches?: boolean }) => {
    const { showLoading = true, preserveScroll = false, keepCaches = false } = opts ?? {};
    const scroller = scrollerRef.current;
    const scrollTop = scroller?.scrollTop ?? 0;
    if (showLoading) setLoading(true);
    // Any reload may have changed game refs (post-mutation paths call load()); drop the
    // usage cache so the active filter refetches. Category switches already null this in
    // handleCategoryChange, so this is a no-op for that path.
    //
    // `keepCaches` lets a mutation that only touches a single file's bytes/dimensions
    // (e.g. replace) skip the wholesale reset — nulling these would flash the unfiltered
    // view for ~1-2s while they refetch, which is what the user sees as "another folder
    // appeared briefly". The caller is responsible for surgically patching the affected
    // entry into the existing maps.
    if (!keepCaches) {
      setUsedFiles(null);
      setImageGuessFiles(null);
      setImageDimensions(null);
    }
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
    refreshTrashCount();
  };

  // Lightweight count refresh so the Papierkorb pseudo-folder shows the right total
  // even when we haven't opened the trash view yet. Errors are swallowed — the count
  // is best-effort and the view itself surfaces real failures.
  const refreshTrashCount = async () => {
    try {
      const data = await listTrash(activeCategory);
      const total = data.batches.reduce((a, b) => a + b.entries.length, 0);
      setTrashCount(total);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Eager-load every image's natural pixel dimensions when entering the images category.
  // The server reads from a persistent cache (`local-assets/.image-dimension-cache.json`)
  // and probes anything missing via `sharp` — so the first visit on a fresh install can
  // take a moment; subsequent visits are instant. Once loaded, both the "Auflösung" sort
  // and "Niedrige Auflösung" filter work without waiting.
  useEffect(() => {
    if (activeCategory !== 'images') return;
    if (imageDimensions !== null) return;
    if (dimensionsLoading) return;
    let cancelled = false;
    setDimensionsLoading(true);
    fetchImageDimensions(activeCategory)
      .then(result => {
        if (cancelled) return;
        const dims = result.dimensions;
        // Merge into fileMeta (root) and subfolders so the existing sort/filter
        // predicates that read `meta.dimensions` just see the loaded data.
        setFileMeta(prev => {
          let changed = false;
          const next = { ...prev };
          for (const [relPath, dim] of Object.entries(dims)) {
            if (!relPath.includes('/') && next[relPath] && next[relPath].dimensions === undefined) {
              next[relPath] = { ...next[relPath], dimensions: dim };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setSubfolders(prev => {
          const updated = mergeDimensionsIntoFolders(prev, dims, '');
          return updated !== prev ? updated : prev;
        });
        setImageDimensions(new Map(Object.entries(dims)));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        showMsg('error', `Bildauflösungen konnten nicht geladen werden: ${err.message}`);
      })
      .finally(() => { if (!cancelled) setDimensionsLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, imageDimensions]);

  // Lazy-load category usages when the filter activates and the cache is empty. The cache
  // is invalidated on category change (handleCategoryChange) and after every load() so
  // post-mutation refreshes refetch automatically. usageLoading is intentionally NOT in
  // the deps — including it would cause the in-flight fetch's cleanup to fire on the
  // setUsageLoading(true) render, cancelling its own .then.
  useEffect(() => {
    // The "Verwendet/Unbenutzt" and "Niedrige Auflösung" filters share the same backing
    // call. Fetch when either is active and the cache is empty. `imageGuessFiles` is
    // only meaningful in the images category, but the server emits an empty array for
    // other categories so the type stays uniform.
    const needsUsages = usageFilter !== null || (lowResFilter && activeCategory === 'images');
    if (!needsUsages) return;
    if (usedFiles !== null && imageGuessFiles !== null) return;
    let cancelled = false;
    setUsageLoading(true);
    fetchAssetCategoryUsages(activeCategory)
      .then(result => {
        if (cancelled) return;
        if (result.truncated) {
          setUsageFilter(null);
          setLowResFilter(false);
          showMsg('error', 'Nutzungsprüfung übersprungen — zu viele Dateien');
          return;
        }
        setUsedFiles(new Set(result.usedFiles));
        setImageGuessFiles(new Set(result.imageGuessFiles));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setUsageFilter(null);
        setLowResFilter(false);
        showMsg('error', `Nutzungsprüfung fehlgeschlagen: ${err.message}`);
      })
      .finally(() => { if (!cancelled) setUsageLoading(false); });
    return () => { cancelled = true; };
  }, [activeCategory, usageFilter, lowResFilter, usedFiles, imageGuessFiles]);  

  // Lazily load folder paths for the opposite category when the move modals switch
  // destination. We only need folder *paths* here, not files — the response includes both.
  const ensureCrossFolderPaths = async (category: AssetCategory) => {
    if (crossFolderData?.category === category) return;
    try {
      const data = await fetchAssets(category);
      setCrossFolderData({ category, paths: getAllFolderPaths(data.subfolders ?? []) });
    } catch {
      setCrossFolderData({ category, paths: [] });
    }
  };

  const showMsg = (type: 'success' | 'error', text: string, action?: ToastAction) => {
    setMessage({ type, text, action });
    // Keep the state hot long enough that consecutive setMessage calls with the same
    // text still re-trigger the toast. Extend when an action is present so the undo
    // button stays visible throughout the toast's own 8s display window.
    setTimeout(() => setMessage(null), action ? 9000 : 4000);
  };

  // Reset the move-modal destination category to the active tab every time the modal opens.
  useEffect(() => { if (moveState) setMoveTargetCategory(activeCategory); }, [moveState, activeCategory]);
  useEffect(() => { if (bulkMoveModal) setBulkMoveTargetCategory(activeCategory); }, [bulkMoveModal, activeCategory]);
  // Pre-fetch the cross-category folder list when the user picks the opposite category.
  useEffect(() => {
    if (moveState && moveTargetCategory !== activeCategory) ensureCrossFolderPaths(moveTargetCategory);
  }, [moveState, moveTargetCategory, activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bulkMoveModal && bulkMoveTargetCategory !== activeCategory) ensureCrossFolderPaths(bulkMoveTargetCategory);
  }, [bulkMoveModal, bulkMoveTargetCategory, activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (sortBy === 'duration') {
        const da = a.meta?.duration ?? -1;
        const db = b.meta?.duration ?? -1;
        cmp = db - da;
      } else if (sortBy === 'resolution') {
        cmp = pixelArea(b.meta) - pixelArea(a.meta);
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
  };

  // Download the result picked in the "Suchen" tab — reuses the same yt-dlp
  // download pipeline + progress tracker as the URL tab (no playlist mode).
  const handleYoutubeSearchDownload = () => {
    if (!ytSearchPick) return;
    startYtDownload(activeCategory, ytSearchPick.url, ytSubfolder || undefined, () => {
      load({ showLoading: false, preserveScroll: true });
    });
    setYtModal(false);
    setYtSearchPick(null);
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

  /** Optimistically remove deleted paths from local state so the UI updates instantly. */
  const removeFromState = (deletedPaths: string[]) => {
    const pathSet = new Set(deletedPaths);
    // Remove root-level files
    setFiles(prev => prev.filter(f => !pathSet.has(f)));
    setFileMeta(prev => {
      const next = { ...prev };
      for (const p of deletedPaths) delete next[p];
      return next;
    });
    // Remove files from subfolders (and prune whole folders deleted by path)
    const pruneFolderTree = (folders: AssetFolder[], prefix: string): AssetFolder[] => {
      const result: AssetFolder[] = [];
      for (const folder of folders) {
        const fp = prefix ? `${prefix}/${folder.name}` : folder.name;
        if (pathSet.has(fp)) continue; // whole folder was deleted
        const nextFiles = folder.files.filter(f => !pathSet.has(`${fp}/${f}`));
        let nextFileMeta = folder.fileMeta;
        if (nextFileMeta) {
          nextFileMeta = { ...nextFileMeta };
          for (const f of folder.files) { if (pathSet.has(`${fp}/${f}`)) delete nextFileMeta[f]; }
        }
        const nextSubs = pruneFolderTree(folder.subfolders, fp);
        result.push({ ...folder, files: nextFiles, fileMeta: nextFileMeta, subfolders: nextSubs });
      }
      return result;
    };
    setSubfolders(prev => pruneFolderTree(prev, ''));
    // Surgically patch the filter-backing caches so the caller can pass
    // `keepCaches: true` to load() — otherwise nulling them flips usageFilterActive
    // off for ~500ms and flashes the unfiltered tree.
    const isInDeleted = (p: string): boolean => {
      if (pathSet.has(p)) return true;
      for (const d of deletedPaths) if (p.startsWith(d + '/')) return true;
      return false;
    };
    setUsedFiles(prev => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const p of prev) if (isInDeleted(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });
    setImageGuessFiles(prev => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const p of prev) if (isInDeleted(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });
    setImageDimensions(prev => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const p of prev.keys()) if (isInDeleted(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });
  };

  // ── Delete helpers ────────────────────────────────────────────────────
  // Soft-delete on the server writes to `.trash/<batchId>`. A single batchId per
  // modal confirm groups all the individual DELETE calls into one undoable unit.

  const findFolderByPath = (roots: AssetFolder[], targetPath: string): AssetFolder | null => {
    if (!targetPath) return null;
    const parts = targetPath.split('/');
    let list = roots;
    let found: AssetFolder | null = null;
    for (const part of parts) {
      found = list.find(f => f.name === part) ?? null;
      if (!found) return null;
      list = found.subfolders;
    }
    return found;
  };

  const summarizeFolder = (folder: AssetFolder) => {
    let fileCount = 0;
    let subfolderCount = 0;
    let totalBytes = 0;
    const walk = (f: AssetFolder) => {
      fileCount += f.files.length;
      for (const name of f.files) totalBytes += f.fileMeta?.[name]?.size ?? 0;
      subfolderCount += f.subfolders.length;
      for (const s of f.subfolders) walk(s);
    };
    walk(folder);
    return { fileCount, subfolderCount, totalBytes, sample: folder.files.slice(0, 5) };
  };

  const findFileSize = (filePath: string): number | undefined => {
    if (!filePath.includes('/')) return fileMeta[filePath]?.size;
    const parts = filePath.split('/');
    const name = parts.pop()!;
    const folder = findFolderByPath(subfolders, parts.join('/'));
    return folder?.fileMeta?.[name]?.size;
  };

  const buildDeleteItems = (filePaths: string[], folderPaths: string[]): DeleteItem[] => {
    const folderItems: DeleteItem[] = folderPaths.map(p => {
      const folder = findFolderByPath(subfolders, p);
      const summary = folder
        ? summarizeFolder(folder)
        : { fileCount: 0, subfolderCount: 0, totalBytes: 0, sample: [] as string[] };
      return { kind: 'folder', path: p, ...summary };
    });
    const fileItems: DeleteItem[] = filePaths.map(p => ({ kind: 'file', path: p, size: findFileSize(p) }));
    return [...folderItems, ...fileItems];
  };

  const runDeleteBatch = async (filePaths: string[], folderPaths: string[], label: string): Promise<void> => {
    if (filePaths.length + folderPaths.length === 0) return;
    const batchId = crypto.randomUUID();
    const fileErrors: string[] = [];
    for (const filePath of filePaths) {
      try { await deleteAsset(activeCategory, filePath, batchId); }
      catch (e) { fileErrors.push(`${filePath}: ${(e as Error).message}`); }
    }
    const folderErrors: string[] = [];
    for (const folderPath of folderPaths) {
      try { await deleteAsset(activeCategory, folderPath, batchId); }
      catch (e) { folderErrors.push(`${folderPath}: ${(e as Error).message}`); }
    }
    const succeededFiles = filePaths.filter(p => !fileErrors.some(e => e.startsWith(p + ':')));
    if (succeededFiles.length > 0) removeFromState(succeededFiles);
    const allErrors = [...fileErrors, ...folderErrors];
    const undoAction: ToastAction = {
      label: 'Rückgängig',
      onClick: () => { void handleUndoDelete(); },
    };
    // Only surface the undo button when at least something was actually deleted.
    if (allErrors.length === 0) {
      showMsg('success', `🗑️ ${label} gelöscht`, undoAction);
    } else if (succeededFiles.length + (folderPaths.length - folderErrors.length) > 0) {
      showMsg('error', `❌ ${allErrors.length} Fehler: ${allErrors[0]}`, undoAction);
    } else {
      showMsg('error', `❌ Fehler: ${allErrors[0]}`);
    }
    // Filter-backing caches were surgically patched in removeFromState, so
    // `keepCaches: true` here avoids the unfiltered-tree flash while the
    // backend refresh is in flight.
    load({ showLoading: false, preserveScroll: true, keepCaches: true });
  };

  const handleUndoDelete = async (): Promise<void> => {
    try {
      const result = await undoLastDelete();
      if (result.conflicts.length > 0) {
        showMsg('error', `⚠ ${result.restored} wiederhergestellt, ${result.conflicts.length} Konflikte: ${result.conflicts[0]}`);
      } else {
        showMsg('success', `↩︎ ${result.restored} wiederhergestellt`);
      }
    } catch (e) {
      showMsg('error', `❌ Rückgängig fehlgeschlagen: ${(e as Error).message}`);
    }
    load({ showLoading: false, preserveScroll: true });
  };

  const handleDelete = (filePath: string, label: string, isFolder: boolean = false) => {
    const items = buildDeleteItems(isFolder ? [] : [filePath], isFolder ? [filePath] : []);
    setDeleteConfirm({
      items,
      busy: false,
      onConfirm: async () => {
        setDeleteConfirm(prev => prev ? { ...prev, busy: true } : prev);
        await runDeleteBatch(isFolder ? [] : [filePath], isFolder ? [filePath] : [], `"${label}"`);
        setDeleteConfirm(null);
      },
    });
  };

  // ── Merge (deduplication) ─────────────────────────────────────────────
  // `openMergePicker` is called from the preview modal headers. It closes the
  // preview, remembers the source, and opens the asset picker so the user can
  // pick the second file.
  const openMergePicker = (source: string) => {
    setPreviewImage(null);
    setAudioPreview(null);
    videoPreviewRef.current?.pause();
    setVideoPreview(null);
    setMergeState({ stage: 'picker', source });
  };

  // Picker callback. Strips the /<category>/ prefix from the URL, rejects the
  // source itself, then kicks off a compare-mode load.
  const handleMergeTargetPicked = async (url: string) => {
    if (!mergeState || mergeState.stage !== 'picker') return;
    const prefix = `/${activeCategory}/`;
    const target = url.startsWith(prefix) ? url.slice(prefix.length) : url;
    if (target === mergeState.source) {
      showMsg('error', '❌ Quelle und Ziel müssen unterschiedlich sein');
      return;
    }
    // Default: keep the asset with more usages; tie → shorter filename wins.
    setMergeState({
      stage: 'compare',
      source: mergeState.source,
      target,
      sourceUsages: null,
      targetUsages: null,
      keep: 'source',
      running: false,
    });
    const [sourceUsages, targetUsages, hashes] = await Promise.all([
      fetchAssetUsages(activeCategory, mergeState.source).catch(() => [] as GameUsage[]),
      fetchAssetUsages(activeCategory, target).catch(() => [] as GameUsage[]),
      fetchAssetHashes(activeCategory, [mergeState.source, target]).catch(() => null),
    ]);
    if (hashes) {
      setMergeIdentical(hashes[mergeState.source] === hashes[target]);
    }
    const sourceCount = sourceUsages.length;
    const targetCount = targetUsages.length;
    const keep: 'source' | 'target' = sourceCount !== targetCount
      ? (sourceCount > targetCount ? 'source' : 'target')
      : (mergeState.source.length <= target.length ? 'source' : 'target');
    setMergeState({
      stage: 'compare',
      source: mergeState.source,
      target,
      sourceUsages,
      targetUsages,
      keep,
      running: false,
    });
  };

  const handleConfirmMerge = async () => {
    if (!mergeState || mergeState.stage !== 'compare') return;
    const { source, target, keep } = mergeState;
    const keepPath = keep === 'source' ? source : target;
    const discardPath = keep === 'source' ? target : source;
    setMergeState({ ...mergeState, running: true });
    try {
      const result = await mergeAsset(activeCategory, keepPath, discardPath);
      const parts = [`✅ Zusammengeführt: „${discardPath}" → „${keepPath}"`];
      if (result.rewrittenGames > 0) parts.push(`${result.rewrittenGames} Spiel${result.rewrittenGames === 1 ? '' : 'e'} aktualisiert`);
      if (result.cascadedCover) parts.push(`Cover: „${result.cascadedCover.discard}" → „${result.cascadedCover.keep}"`);
      showMsg('success', parts.join(' · '));
      setMergeState(null);
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      setMergeState({ ...mergeState, running: false });
    }
  };

  // ── Multi-file merge (from selection mode) ──────────────────────────
  const handleMultiMerge = async () => {
    const filePaths = [...selectedFiles];
    if (filePaths.length < 2) {
      showMsg('error', '❌ Mindestens 2 Dateien auswählen');
      return;
    }
    setMultiMergeState({ stage: 'loading', files: filePaths, hashes: null, hashGroups: null, keep: '', usages: null, running: false });
    setMultiMergeDims({});
    try {
      const hashes = await fetchAssetHashes(activeCategory, filePaths);
      // Group files by hash
      const hashGroups = new Map<string, string[]>();
      for (const f of filePaths) {
        const h = hashes[f];
        if (!hashGroups.has(h)) hashGroups.set(h, []);
        hashGroups.get(h)!.push(f);
      }
      const uniqueHashes = hashGroups.size;
      if (uniqueHashes > 4) {
        showMsg('error', `❌ Zu viele unterschiedliche Dateien (${uniqueHashes}). Maximal 4 verschiedene Hashes erlaubt.`);
        setMultiMergeState(null);
        return;
      }
      // Fetch usages for all files
      const usagesMap: Record<string, GameUsage[]> = {};
      await Promise.all(filePaths.map(async (f) => {
        usagesMap[f] = await fetchAssetUsages(activeCategory, f).catch(() => [] as GameUsage[]);
      }));
      // Default keep = file with most usages overall, tie-break by shorter filename
      const sorted = [...filePaths].sort((a, b) => {
        const diff = (usagesMap[b]?.length ?? 0) - (usagesMap[a]?.length ?? 0);
        if (diff !== 0) return diff;
        return a.length - b.length;
      });
      const keep = sorted[0];
      setMultiMergeState({ stage: 'compare', files: filePaths, hashes, hashGroups, keep, usages: usagesMap, running: false });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      setMultiMergeState(null);
    }
  };

  const handleConfirmMultiMerge = async () => {
    if (!multiMergeState || multiMergeState.stage !== 'compare' || !multiMergeState.hashGroups) return;
    const { keep, files: mergeFiles } = multiMergeState;
    setMultiMergeState({ ...multiMergeState, running: true });
    let totalRewritten = 0;
    const cascades: string[] = [];
    const errors: string[] = [];
    try {
      // Merge all non-kept files into the single winner
      const discards = mergeFiles.filter(f => f !== keep);
      for (const discardPath of discards) {
        try {
          const result = await mergeAsset(activeCategory, keep, discardPath);
          totalRewritten += result.rewrittenGames;
          if (result.cascadedCover) cascades.push(`${result.cascadedCover.discard} → ${result.cascadedCover.keep}`);
        } catch (e) {
          errors.push(`${discardPath}: ${(e as Error).message}`);
        }
      }
      const parts: string[] = [];
      const discardCount = discards.length;
      parts.push(`✅ ${discardCount} Datei${discardCount !== 1 ? 'en' : ''} zusammengeführt`);
      if (totalRewritten > 0) parts.push(`${totalRewritten} Spiel${totalRewritten === 1 ? '' : 'e'} aktualisiert`);
      if (cascades.length > 0) parts.push(`Cover: ${cascades.join(', ')}`);
      if (errors.length > 0) parts.push(`${errors.length} Fehler`);
      showMsg(errors.length > 0 ? 'error' : 'success', parts.join(' · '));
      setMultiMergeState(null);
      selectNone();
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      setMultiMergeState({ ...multiMergeState, running: false });
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

  const handleRenameFile = async (oldPath: string, newBaseName: string) => {
    const oldName = oldPath.split('/').pop()!;
    const extMatch = oldName.match(/\.[^.]+$/);
    const oldExt = extMatch ? extMatch[0] : '';
    // Keep the original extension — users edit the base name only
    const trimmed = newBaseName.trim().replace(/\.[^.]+$/, '');
    if (!trimmed || `${trimmed}${oldExt}` === oldName) { setRenamingFile(null); return; }
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newName = `${trimmed}${oldExt}`;
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    try {
      await moveAsset(activeCategory, oldPath, newPath);
      showMsg('success', `✅ "${oldName}" → "${newName}"`);
      setRenamingFile(null);
      // Keep any open preview pointing at the renamed file
      setPreviewImage(p => p === oldPath ? newPath : p);
      setAudioPreview(p => p && p.filePath === oldPath ? { filePath: newPath, src: assetUrl(activeCategory, newPath) } : p);
      setVideoPreview(p => p && p.filePath === oldPath ? { filePath: newPath, src: assetUrl(activeCategory, newPath) } : p);
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
    const crossMove = moveTargetCategory !== activeCategory;
    if (crossMove && activeCategory === 'audio' && isReservedAudioSubpath(moveState.filePath)) {
      showMsg('error', '❌ Reservierte Ordner (bandle, backup) können nicht verschoben werden');
      return;
    }
    try {
      await moveAsset(activeCategory, moveState.filePath, targetPath, moveTargetCategory);
      const destLabel = CATEGORIES.find(c => c.id === moveTargetCategory)?.label ?? moveTargetCategory;
      showMsg('success', crossMove
        ? `✅ "${moveState.name}" nach ${destLabel} verschoben`
        : `✅ "${moveState.name}" verschoben`);
      setMoveState(null);
      setMoveTarget('');
      // Reset cross-category folder cache so re-opening the modal re-fetches if stale.
      setCrossFolderData(null);
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
      if (result.posterPath) {
        load({ showLoading: false, preserveScroll: true });
        const slug = videoFilenameToSlug(fileName);
        setPosterVersions(prev => ({ ...prev, [slug]: Date.now() }));
      }
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
    setVideoProbeLoading(true);
    setFaststartRunning(false);
    setFaststartProgress(0);
    setFaststartError(null);
    const [usages, probe, faststartStatus] = await Promise.all([
      fetchAssetUsages(activeCategory, filePath).catch(() => []),
      probeVideo(filePath).catch(() => null),
      // If a faststart remux is already running on the server (e.g. the operator kicked
      // one off earlier and reloaded the tab), pick up the progress stream right away
      // instead of showing an idle banner with a fresh button. The status call is a
      // cheap peek at the in-flight map; the real subscription happens via the POST.
      fetchFaststartStatus(filePath).catch(() => ({ running: false, percent: null } as const)),
    ]);
    setVideoProbeLoading(false);
    setVideoPreviewUsages(usages);
    if (probe) {
      setVideoTracks(probe.tracks);
      setVideoNeedsTranscode(probe.needsTranscode);
      setVideoInfo(probe.videoInfo ?? null);
    }
    if (faststartStatus.running) {
      setFaststartRunning(true);
      setFaststartProgress(faststartStatus.percent ?? 0);
      // Re-subscribe: server dedup's on filePath so this joins the running ffmpeg rather
      // than starting a second one. Progress events catch us up immediately (the server
      // sends the last-known percent as the first event on join).
      faststartVideo(filePath, (ev) => {
        if (typeof ev.percent === 'number') setFaststartProgress(ev.percent);
      }).then(async () => {
        const probe2 = await probeVideo(filePath).catch(() => null);
        if (probe2) setVideoInfo(probe2.videoInfo ?? null);
      }).catch((err: Error) => {
        setFaststartError(err.message);
      }).finally(() => {
        setFaststartRunning(false);
      });
    }
  };

  const closeVideoPreview = () => {
    videoPreviewRef.current?.pause();
    // `videoPreviewLoading` / `videoPreviewError` are owned by `useVideoPlayback`; they
    // reset automatically when `videoPreview?.filePath` changes (including to null).
    setVideoPreview(null);
  };

  // DAM preview plays the raw file directly — no cache involved. This gives full scrubbing
  // and fast start at the cost of browser-codec compatibility: HDR files render grey/flat,
  // non-AAC audio is silent, and exotic containers may not play at all. The warning banners
  // below (`videoInfo?.isHdr`, `videoNeedsTranscode`) tell the operator what to expect, and
  // the selected audio track still drives the *gameshow cache* (see the track-selector
  // label). For a tone-mapped, audio-fixed preview the operator uses the marker editor.
  //
  // The `src` is set via a `<source>` child in the JSX (see the `<video>` below) rather
  // than imperatively here — Firefox + `preload="metadata"` without an explicit src was
  // triggering "Load of media resource /admin failed" because the element would fall back
  // to the current page URL. The `loadedmetadata` listener just captures duration.
  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !videoPreview?.src) return;
    const onReady = () => setVideoPreviewDuration(video.duration);
    video.addEventListener('loadedmetadata', onReady, { once: true });
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, [videoPreview?.src]);

  // Close the top-most asset preview (audio/video/image/poster) on Escape. Other modals
  // (move, bulk-move, folder prompt, poster fetch, audio-cover fetch) are left alone —
  // they have their own UX flows and either already handle Escape or shouldn't close on it.
  // preventDefault + capture-phase listener stop macOS browsers from also using the same
  // Escape press to exit OS-level fullscreen mode.
  useEffect(() => {
    if (!audioPreview && !videoPreview && !previewImage && !posterPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (posterPreview) { setPosterPreview(null); return; }
      if (previewImage) { setPreviewImage(null); return; }
      if (videoPreview) { closeVideoPreview(); return; }
      if (audioPreview) { setAudioPreview(null); return; }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [audioPreview, videoPreview, previewImage, posterPreview]);

  // Shared loading/error/decode-recovery logic (identical to the marker editor's behaviour
  // — both surfaces stream the raw file and share the same Browser-decoder limits).
  // `reloadKey` is a remount trigger: if the AppleVT decoder gets permanently stuck, the
  // hook bumps it and we pass it as `key` on the `<video>` so React destroys the element
  // and creates a fresh one (new decoder instance). The hook preserves currentTime
  // across the remount and re-seeks there.
  const { loading: videoPreviewLoading, error: videoPreviewError } = useVideoPlayback(
    videoPreviewRef,
    videoPreview?.filePath ?? '',
  );

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

  // Apply the active usage filter to a path. Returns true when the path is visible.
  // No-op when no filter is active (or usages haven't loaded yet).
  const passesUsageFilter = (filePath: string): boolean => {
    if (usageFilter === null || usedFiles === null) return true;
    return usageFilter === 'used' ? usedFiles.has(filePath) : !usedFiles.has(filePath);
  };

  const getVisibleFilePaths = (): string[] => {
    if (searchQuery) {
      const tokens = tokenizeSearch(searchQuery);
      return sortFileEntries(
        collectAllFiles(files, fileMeta, subfolders)
          .filter(e => matchesSearchKey(e.searchKey, tokens) && passesUsageFilter(e.filePath))
      ).map(e => e.filePath);
    }
    // Match actual display order: expanded subfolders first (files sorted within each), then root files sorted.
    // When the usage filter is active, the bulk "Alle" still needs to reach files in folders the user
    // hasn't expanded — otherwise selecting "Alle" would miss filtered files inside collapsed folders.
    const usageActive = usageFilter !== null && usedFiles !== null;
    const paths: string[] = [];
    const walkExpanded = (folders: AssetFolder[], prefix: string) => {
      for (const folder of folders) {
        const fp = prefix ? `${prefix}/${folder.name}` : folder.name;
        if (expandedFolders.has(fp) || usageActive) {
          walkExpanded(folder.subfolders, fp);
          for (const file of sortFiles(folder.files, folder.fileMeta, sortBy, sortReverse)) {
            const p = `${fp}/${file}`;
            if (passesUsageFilter(p)) paths.push(p);
          }
        }
      }
    };
    walkExpanded(subfolders, '');
    for (const file of sortFiles(files, fileMeta, sortBy, sortReverse)) {
      if (passesUsageFilter(file)) paths.push(file);
    }
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
        for (const file of folder.files) {
          const p = `${folderPath}/${file}`;
          if (passesUsageFilter(p)) next.add(p);
        }
        baseSelectionRef.current = new Set(next);
        return next;
      });
    } else {
      // Select root-level files only
      setSelectedFiles(prev => {
        const next = new Set(prev);
        for (const file of files) {
          if (passesUsageFilter(file)) next.add(file);
        }
        baseSelectionRef.current = new Set(next);
        return next;
      });
    }
  };

  const selectNone = () => {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    lastClickedFileRef.current = null;
    baseSelectionRef.current = new Set();
    lastClickedFolderRef.current = null;
    baseFolderSelectionRef.current = new Set();
  };

  const handleFileClick = (filePath: string, e: React.MouseEvent, openPreviewFn: () => void) => {
    const isMod = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    // Outside selection mode: plain click opens preview
    if (!selectionMode && !isMod && !isShift) {
      openPreviewFn();
      return;
    }

    // Cmd/Shift+click outside selection mode: enter selection mode
    if (!selectionMode) {
      setSelectionMode(true);
      const initial = new Set([filePath]);
      setSelectedFiles(initial);
      lastClickedFileRef.current = filePath;
      baseSelectionRef.current = new Set(initial);
      return;
    }

    // In selection mode
    if (isShift && lastClickedFileRef.current) {
      // Shift+click: replace selection with baseSelection ∪ range(anchor, current)
      // This mimics OS behavior: the shift-extended range is recalculated each time
      const allPaths = getVisibleFilePaths();
      const anchorIdx = allPaths.indexOf(lastClickedFileRef.current);
      const curIdx = allPaths.indexOf(filePath);
      if (anchorIdx >= 0 && curIdx >= 0) {
        const [from, to] = anchorIdx < curIdx ? [anchorIdx, curIdx] : [curIdx, anchorIdx];
        const next = new Set(baseSelectionRef.current);
        for (let i = from; i <= to; i++) next.add(allPaths[i]);
        setSelectedFiles(next);
      }
      // Do NOT update anchor or baseSelection on shift+click
    } else {
      // Plain click or Cmd+click: toggle single file
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        // Update anchor and base selection for future shift+clicks
        lastClickedFileRef.current = filePath;
        baseSelectionRef.current = new Set(next);
        return next;
      });
    }
  };

  const getVisibleFolderPaths = (): string[] => {
    const paths: string[] = [];
    const walk = (folders: AssetFolder[], prefix: string) => {
      for (const folder of folders) {
        const fp = prefix ? `${prefix}/${folder.name}` : folder.name;
        paths.push(fp);
        if (expandedFolders.has(fp)) walk(folder.subfolders, fp);
      }
    };
    walk(subfolders, '');
    return paths;
  };

  const handleFolderClick = (folderPath: string, e: React.MouseEvent) => {
    const isShift = e.shiftKey;

    // Cmd/Shift+click outside select mode: enter selection mode
    if (!selectionMode) {
      setSelectionMode(true);
      const initial = new Set([folderPath]);
      setSelectedFolders(initial);
      lastClickedFolderRef.current = folderPath;
      baseFolderSelectionRef.current = new Set(initial);
      return;
    }

    if (isShift && lastClickedFolderRef.current) {
      const allPaths = getVisibleFolderPaths();
      const anchorIdx = allPaths.indexOf(lastClickedFolderRef.current);
      const curIdx = allPaths.indexOf(folderPath);
      if (anchorIdx >= 0 && curIdx >= 0) {
        const [from, to] = anchorIdx < curIdx ? [anchorIdx, curIdx] : [curIdx, anchorIdx];
        const next = new Set(baseFolderSelectionRef.current);
        for (let i = from; i <= to; i++) next.add(allPaths[i]);
        setSelectedFolders(next);
      }
    } else {
      setSelectedFolders(prev => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        lastClickedFolderRef.current = folderPath;
        baseFolderSelectionRef.current = new Set(next);
        return next;
      });
    }
  };

  const handleMoveFolder = async (fromPath: string, toParentPath?: string) => {
    const folderName = fromPath.split('/').pop()!;
    const parent = toParentPath ?? '';
    const targetPath = parent ? `${parent}/${folderName}` : folderName;
    if (targetPath === fromPath) return;
    if (targetPath.startsWith(fromPath + '/')) {
      showMsg('error', '❌ Ordner kann nicht in sich selbst verschoben werden');
      return;
    }
    try {
      await moveAsset(activeCategory, fromPath, targetPath);
      showMsg('success', `✅ "${folderName}" verschoben`);
      // Rewrite any expanded paths under the moved folder to their new prefix.
      setExpandedFolders(prev => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === fromPath) next.add(targetPath);
          else if (p.startsWith(fromPath + '/')) next.add(targetPath + p.substring(fromPath.length));
          else next.add(p);
        }
        if (parent) next.add(parent);
        return next;
      });
      load({ showLoading: false, preserveScroll: true });
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
    }
  };

  const handleMoveFolders = async (fromPaths: string[], toParentPath?: string) => {
    // Skip descendants: if "A" and "A/B" are both selected, moving "A" already moves "A/B".
    const sorted = [...fromPaths].sort();
    const filtered = sorted.filter(p => !sorted.some(other => other !== p && p.startsWith(other + '/')));
    const parent = toParentPath ?? '';
    setBulkOperationInProgress(true);
    const errors: string[] = [];
    for (const fromPath of filtered) {
      const folderName = fromPath.split('/').pop()!;
      const targetPath = parent ? `${parent}/${folderName}` : folderName;
      if (targetPath === fromPath) continue;
      if (targetPath.startsWith(fromPath + '/')) continue;
      try {
        await moveAsset(activeCategory, fromPath, targetPath);
      } catch (e) {
        errors.push(`${fromPath}: ${(e as Error).message}`);
      }
    }
    setBulkOperationInProgress(false);
    const successCount = filtered.length - errors.length;
    if (successCount > 0) showMsg('success', `✅ ${successCount} Ordner verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFolders(new Set());
    lastClickedFolderRef.current = null;
    baseFolderSelectionRef.current = new Set();
    load({ showLoading: false, preserveScroll: true });
  };

  const handleBulkDelete = () => {
    const filePaths = Array.from(selectedFiles);
    const folderPathsRaw = Array.from(selectedFolders).sort();
    // Skip descendants: deleting a parent folder already wipes its children.
    const folderPaths = folderPathsRaw.filter(p => !folderPathsRaw.some(other => other !== p && p.startsWith(other + '/')));
    const total = filePaths.length + folderPaths.length;
    if (total === 0) return;
    const label = folderPaths.length === 0
      ? `${filePaths.length} Datei${filePaths.length !== 1 ? 'en' : ''}`
      : filePaths.length === 0
        ? `${folderPaths.length} Ordner`
        : `${filePaths.length} Datei${filePaths.length !== 1 ? 'en' : ''} + ${folderPaths.length} Ordner`;

    setDeleteConfirm({
      items: buildDeleteItems(filePaths, folderPaths),
      busy: false,
      onConfirm: async () => {
        setDeleteConfirm(prev => prev ? { ...prev, busy: true } : prev);
        setBulkOperationInProgress(true);
        await runDeleteBatch(filePaths, folderPaths, label);
        setBulkOperationInProgress(false);
        setSelectedFiles(new Set());
        setSelectedFolders(new Set());
        setDeleteConfirm(null);
      },
    });
  };

  const handleBulkMove = async () => {
    const filePaths = Array.from(selectedFiles);
    const folderPathsRaw = Array.from(selectedFolders).sort();
    // Skip descendants: moving a parent folder already moves its children.
    const folderPaths = folderPathsRaw.filter(p => !folderPathsRaw.some(other => other !== p && p.startsWith(other + '/')));
    if (filePaths.length + folderPaths.length === 0) return;
    const parent = bulkMoveTarget.trim();
    const destCategory = bulkMoveTargetCategory;
    const crossMove = destCategory !== activeCategory;
    setBulkOperationInProgress(true);
    const errors: string[] = [];
    let fileSuccess = 0;
    for (const fromPath of filePaths) {
      const fileName = fromPath.split('/').pop()!;
      const targetPath = parent ? `${parent}/${fileName}` : fileName;
      if (!crossMove && fromPath === targetPath) continue;
      if (crossMove && activeCategory === 'audio' && isReservedAudioSubpath(fromPath)) {
        errors.push(`${fromPath}: Reservierte Ordner können nicht verschoben werden`);
        continue;
      }
      try { await moveAsset(activeCategory, fromPath, targetPath, destCategory); fileSuccess++; }
      catch (e) { errors.push(`${fromPath}: ${(e as Error).message}`); }
    }
    let folderSuccess = 0;
    for (const fromPath of folderPaths) {
      const folderName = fromPath.split('/').pop()!;
      const targetPath = parent ? `${parent}/${folderName}` : folderName;
      if (!crossMove && fromPath === targetPath) continue;
      if (!crossMove && targetPath.startsWith(fromPath + '/')) { errors.push(`${fromPath}: Ordner kann nicht in sich selbst verschoben werden`); continue; }
      if (crossMove && activeCategory === 'audio' && isReservedAudioSubpath(fromPath)) {
        errors.push(`${fromPath}: Reservierte Ordner können nicht verschoben werden`);
        continue;
      }
      try { await moveAsset(activeCategory, fromPath, targetPath, destCategory); folderSuccess++; }
      catch (e) { errors.push(`${fromPath}: ${(e as Error).message}`); }
    }
    setBulkOperationInProgress(false);
    const destLabel = CATEGORIES.find(c => c.id === destCategory)?.label ?? destCategory;
    const destSuffix = crossMove ? ` nach ${destLabel}` : '';
    if (fileSuccess > 0) showMsg('success', `✅ ${fileSuccess} Datei${fileSuccess !== 1 ? 'en' : ''}${destSuffix} verschoben`);
    if (folderSuccess > 0) showMsg('success', `✅ ${folderSuccess} Ordner${destSuffix} verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    setBulkMoveModal(false);
    setBulkMoveTarget('');
    setCrossFolderData(null);
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
    const movedCount = fromPaths.filter(fp => {
      const fn = fp.split('/').pop()!;
      const tp = toFolderPath ? `${toFolderPath}/${fn}` : fn;
      return fp !== tp;
    }).length;
    if (movedCount === 0) return; // Dropped in same place — keep selection
    const successCount = movedCount - errors.length;
    if (successCount > 0) showMsg('success', `✅ ${successCount} Datei${successCount !== 1 ? 'en' : ''} verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    load({ showLoading: false, preserveScroll: true });
  };

  const renderFileNameEditable = (file: string, filePath: string, className: string, slot: 'list' | 'preview' = 'list') => {
    const slotKey = `${slot}:${filePath}`;
    if (renamingFile === slotKey) {
      return (
        <input
          className="be-input asset-folder-rename-input"
          value={renameFileName}
          autoFocus
          onClick={e => e.stopPropagation()}
          onChange={e => setRenameFileName(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') handleRenameFile(filePath, renameFileName);
            if (e.key === 'Escape') { e.preventDefault(); setRenamingFile(null); }
          }}
          onBlur={() => handleRenameFile(filePath, renameFileName)}
        />
      );
    }
    const baseName = file.replace(/\.[^.]+$/, '');
    return (
      <span className={className}>
        <span
          className="asset-file-name-text"
          title="Klicken zum Umbenennen"
          onClick={e => {
            if (selectionMode) return;
            e.stopPropagation();
            setRenamingFile(slotKey);
            setRenameFileName(baseName);
          }}
        >{file}</span>
      </span>
    );
  };

  const renderAudioItem = (file: string, filePath: string, src: string) => (
    <div
      key={filePath}
      className={`asset-file-item${selectionMode && selectedFiles.has(filePath) ? ' asset-file-item--selected' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath) || selectedFiles.size === 0}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.setData('text/asset-source-category', activeCategory);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => openAudioPreview(filePath, src))}
    >
      <span className="asset-file-icon">🎵</span>
      {renderFileNameEditable(file, filePath, 'asset-file-name')}
      {!selectionMode && <MiniAudioPlayer src={src} className="asset-file-audio" />}
      {!selectionMode && (
        <>
          <button className="be-icon-btn" style={{ fontSize: 'var(--admin-sz-11, 11px)' }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
          <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
        </>
      )}
    </div>
  );

  /** Walk top-level fileMeta + subfolder tree to find the reference meta for a given relPath.
   *  filePath is the slash-joined relative path inside the category (e.g. "Movies/Matrix.mp4"). */
  const getReferenceMeta = (filePath: string): { sourcePath: string; online: boolean } | undefined => {
    if (!filePath.includes('/')) {
      return fileMeta[filePath]?.reference;
    }
    const parts = filePath.split('/');
    let folders = subfolders;
    for (let i = 0; i < parts.length - 1; i++) {
      const folder = folders.find(f => f.name === parts[i]);
      if (!folder) return undefined;
      if (i === parts.length - 2) {
        return folder.fileMeta?.[parts[parts.length - 1]]?.reference;
      }
      folders = folder.subfolders;
    }
    return undefined;
  };

  const renderVideoItem = (file: string, filePath: string, src: string) => {
    const refMeta = getReferenceMeta(filePath);
    return (
    <div
      key={filePath}
      className={`asset-file-item${selectionMode && selectedFiles.has(filePath) ? ' asset-file-item--selected' : ''}${refMeta && !refMeta.online ? ' asset-file-item--offline' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath) || selectedFiles.size === 0}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.setData('text/asset-source-category', activeCategory);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => {
        if (refMeta && !refMeta.online) {
          showMsg('error', 'Quelldatei nicht erreichbar — Referenz ist offline');
          return;
        }
        openVideoPreview(filePath, src);
      })}
    >
      <span className="asset-file-icon">🎬</span>
      {renderFileNameEditable(file, filePath, 'asset-file-name')}
      {refMeta && (
        <span
          className={`asset-ref-badge asset-ref-badge--${refMeta.online ? 'online' : 'offline'}`}
          title={refMeta.online ? `Referenz → ${refMeta.sourcePath}` : `Quelle nicht erreichbar: ${refMeta.sourcePath}`}
        >
          {refMeta.online ? '🔗 Ref' : '⚠ Offline'}
        </span>
      )}
      <VideoThumb file={file} src={src} posterVersion={posterVersions[videoFilenameToSlug(file)]} onPosterClick={e => { e.stopPropagation(); setPosterPreview(`/images/Movie Posters/${videoFilenameToSlug(file)}.jpg`); }} />
      {!selectionMode && (
        <>
          <button className="be-icon-btn" style={{ fontSize: 'var(--admin-sz-11, 11px)' }} onClick={e => handleFetchCover(e, file)} title="Filmcover laden"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.5"/><path d="M1.5 11l3.5-3.5 2.5 2.5 2-2L14.5 13"/></svg></button>
          <button className="be-icon-btn" style={{ fontSize: 'var(--admin-sz-11, 11px)' }} onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }} title="Verschieben">→</button>
          <button className="be-delete-btn" onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }} title="Löschen">🗑</button>
        </>
      )}
    </div>
    );
  };

  const renderImageCard = (file: string, filePath: string, folder?: string | null) => (
    <div
      key={filePath}
      className={`asset-image-card${selectionMode && selectedFiles.has(filePath) ? ' asset-image-card--selected' : ''}`}
      draggable={!selectionMode || selectedFiles.has(filePath) || selectedFiles.size === 0}
      onDragStart={e => {
        if (selectionMode && selectedFiles.has(filePath)) {
          e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
        } else {
          e.dataTransfer.setData('text/asset-path', filePath);
        }
        e.dataTransfer.setData('text/asset-source-category', activeCategory);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={e => handleFileClick(filePath, e, () => openPreview(filePath))}
    >
      <img src={`${assetUrl(activeCategory, filePath)}${imageVersions[filePath] ? `?v=${imageVersions[filePath]}` : ''}`} alt={file} loading="lazy" draggable={false} />
      <div className="asset-image-card-footer">
        {folder && <span className="asset-search-folder-badge" title={folder}>📁 {folder}</span>}
        {renderFileNameEditable(file, filePath, 'asset-image-card-name')}
        {!selectionMode && (
          <>
            <button
              className="be-icon-btn"
              style={{ width: 24, height: 24, fontSize: 'var(--admin-sz-11, 11px)' }}
              onClick={e => { e.stopPropagation(); setMoveState({ filePath, name: file }); setMoveTarget(''); }}
              title="Verschieben"
            >→</button>
            <button
              className="be-delete-btn"
              onClick={e => { e.stopPropagation(); handleDelete(filePath, file); }}
              title="Löschen"
              style={{ width: 24, height: 24, fontSize: 'var(--admin-sz-13, 13px)' }}
            >🗑</button>
          </>
        )}
      </div>
    </div>
  );

  const renderFolder = (folder: AssetFolder, folderPath: string, depth: number) => {
    const isExpanded = expandedFolders.has(folderPath);
    const hasContent = folder.files.length > 0 || folder.subfolders.length > 0;
    const totals = countFolderTotals(folder);
    const countLabel = [
      totals.files > 0 ? `${totals.files} Datei${totals.files !== 1 ? 'en' : ''}` : '',
      totals.folders > 0 ? `${totals.folders} Ordner` : '',
    ].filter(Boolean).join(' · ') || 'leer';

    return (
      <DropZone
        key={folderPath}
        className="asset-folder"
        style={depth > 0 ? { marginLeft: 20, marginBottom: 4 } : undefined}
        targetFolderPath={folderPath}
        onFileDrop={files => handleUpload(files, folderPath)}
        onAssetDrop={assetPath => handleMoveAsset(assetPath, folderPath)}
        onAssetMultiDrop={paths => handleMoveAssets(paths, folderPath)}
        onFolderDrop={fromPath => handleMoveFolder(fromPath, folderPath)}
        onFolderMultiDrop={paths => handleMoveFolders(paths, folderPath)}
        onUrlDrop={urls => handleUrlDrop(urls, folderPath)}
        noClick
      >
        <div
          className={`asset-folder-header${selectionMode && selectedFolders.has(folderPath) ? ' asset-folder-header--selected' : ''}`}
          onClick={e => {
            // In select mode (or with a modifier outside select mode), clicking anywhere
            // on the header — except the chevron — toggles folder selection. Otherwise,
            // a plain click expands/collapses the folder.
            if (selectionMode || e.shiftKey || e.metaKey || e.ctrlKey) {
              handleFolderClick(folderPath, e);
            } else {
              toggleFolder(folderPath);
            }
          }}
          draggable={renamingFolder !== folderPath}
          onDragStart={e => {
            const isSelected = selectionMode && selectedFolders.has(folderPath);
            const folderPaths = isSelected ? Array.from(selectedFolders) : [folderPath];
            if (folderPaths.length > 1) {
              e.dataTransfer.setData('text/asset-folder-paths', JSON.stringify(folderPaths));
            } else {
              e.dataTransfer.setData('text/asset-folder-path', folderPaths[0]);
            }
            // Mixed drag: when a selected folder is dragged and files are also selected,
            // bring the files along. Dropping files into an ancestor/descendant of a
            // dragged folder is still handled case-by-case by the file move; the folder
            // validity check only blocks folder-level cycles.
            if (isSelected && selectedFiles.size > 0) {
              e.dataTransfer.setData('text/asset-paths', JSON.stringify(Array.from(selectedFiles)));
            }
            e.dataTransfer.setData('text/asset-source-category', activeCategory);
            e.dataTransfer.effectAllowed = 'move';
            currentFolderDrag = folderPaths;
          }}
          onDragEnd={() => { currentFolderDrag = []; }}
        >
          <span
            className={`asset-folder-chevron ${isExpanded ? 'open' : ''}`}
            onClick={e => { e.stopPropagation(); toggleFolder(folderPath); }}
            title={isExpanded ? 'Zuklappen' : 'Aufklappen'}
          >▶</span>
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
              onClick={e => {
                // In select mode or with a modifier key, let the click bubble to the
                // header so selection is handled uniformly there. Otherwise, intercept
                // and start inline rename.
                if (selectionMode || e.shiftKey || e.metaKey || e.ctrlKey) return;
                e.stopPropagation();
                setRenamingFolder(folderPath);
                setRenameFolderName(folder.name);
              }}
              title={selectionMode ? 'Klicken zum Auswählen' : 'Klicken zum Umbenennen'}
            >{folder.name}</span>
          )}
          <span className="asset-folder-count">{countLabel}</span>
          {selectionMode && folder.files.length > 0 && (
            <button
              className="be-icon-btn"
              style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
              onClick={e => { e.stopPropagation(); selectAllAtLevel(folderPath); }}
              title="Alle Dateien in diesem Ordner auswählen"
            >Alle</button>
          )}
          <label className="be-icon-btn" style={{ cursor: 'pointer', fontSize: 'var(--admin-sz-12, 12px)' }} title="Datei hochladen" onClick={e => e.stopPropagation()}>
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
            onClick={e => { e.stopPropagation(); handleDelete(folderPath, folder.name, true); }}
            title="Ordner löschen"
          >🗑</button>
        </div>

        {isExpanded && (
          <div className="asset-folder-files">

            {folder.subfolders.map(sub => renderFolder(sub, `${folderPath}/${sub.name}`, depth + 1))}

            {folder.files.length > 0 && currentCat.mediaType === 'image' && (
              <div className="asset-image-grid">
                {sortedFiles(folder.files, folder.fileMeta).map(file => renderImageCard(file, `${folderPath}/${file}`))}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'audio' && (
              <div className="asset-file-list">
                {sortedFiles(folder.files, folder.fileMeta).map(file =>
                  renderAudioItem(file, `${folderPath}/${file}`, assetUrl(activeCategory, `${folderPath}/${file}`))
                )}
              </div>
            )}

            {folder.files.length > 0 && currentCat.mediaType === 'video' && (
              <div className="asset-file-list">
                {sortedFiles(folder.files, folder.fileMeta).map(file =>
                  renderVideoItem(file, `${folderPath}/${file}`, assetUrl(activeCategory, `${folderPath}/${file}`))
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
          </div>
        )}
      </DropZone>
    );
  };

  const allFolderPaths = getAllFolderPaths(subfolders);

  // Catch-all folder-drop: dragging a nested folder anywhere in the DAM panel that
  // isn't captured by a more specific DropZone (folder row, upload zone, Stammordner,
  // or the root-drop gutter) moves it to the category root. Inner DropZones call
  // native stopPropagation on drop, so React's delegated synthetic drop here only
  // fires when the drop missed them all.
  const onContainerDragOver = (e: React.DragEvent) => {
    // Defer to the per-tab drop handler when the drag is over a category button.
    if ((e.target as HTMLElement).closest('.asset-category-btn')) return;
    if (currentFolderDrag.length > 0) e.preventDefault();
  };
  const onContainerDrop = (e: React.DragEvent) => {
    if ((e.target as HTMLElement).closest('.asset-category-btn')) return;
    if (currentFolderDrag.length === 0) return;
    e.preventDefault();
    const nested = currentFolderDrag.filter(p => p.includes('/'));
    if (nested.length === 0) return;
    if (nested.length === 1) handleMoveFolder(nested[0]);
    else handleMoveFolders(nested);
  };

  // Cross-category drop onto the opposite category tab: moves files and folders to the
  // destination category's root. Source category travels via `text/asset-source-category`.
  const [dragOverTabId, setDragOverTabId] = useState<AssetCategory | null>(null);
  const handleTabCrossDrop = async (destCategory: AssetCategory, dt: DataTransfer) => {
    const sourceRaw = dt.getData('text/asset-source-category');
    if (!sourceRaw) return;
    const sourceCategory = sourceRaw as AssetCategory;
    if (sourceCategory === destCategory) return;
    if (!canCrossMove(sourceCategory) || !canCrossMove(destCategory)) return;

    let folderPaths: string[] = [];
    const multiFolderRaw = dt.getData('text/asset-folder-paths');
    if (multiFolderRaw) { try { folderPaths = JSON.parse(multiFolderRaw) as string[]; } catch { /* ignore */ } }
    if (folderPaths.length === 0) {
      const single = dt.getData('text/asset-folder-path');
      if (single) folderPaths = [single];
    }
    let filePaths: string[] = [];
    const multiAssetRaw = dt.getData('text/asset-paths');
    if (multiAssetRaw) { try { filePaths = JSON.parse(multiAssetRaw) as string[]; } catch { /* ignore */ } }
    if (filePaths.length === 0) {
      const single = dt.getData('text/asset-path');
      if (single) filePaths = [single];
    }
    if (folderPaths.length === 0 && filePaths.length === 0) return;

    // Skip descendants (same logic the bulk handler uses).
    const sortedFolders = [...folderPaths].sort();
    const dedupedFolders = sortedFolders.filter(p => !sortedFolders.some(o => o !== p && p.startsWith(o + '/')));

    setBulkOperationInProgress(true);
    const errors: string[] = [];
    let fileSuccess = 0;
    let folderSuccess = 0;
    for (const from of filePaths) {
      if (sourceCategory === 'audio' && isReservedAudioSubpath(from)) {
        errors.push(`${from}: Reservierte Ordner können nicht verschoben werden`);
        continue;
      }
      const name = from.split('/').pop()!;
      try { await moveAsset(sourceCategory, from, name, destCategory); fileSuccess++; }
      catch (e) { errors.push(`${from}: ${(e as Error).message}`); }
    }
    for (const from of dedupedFolders) {
      if (sourceCategory === 'audio' && isReservedAudioSubpath(from)) {
        errors.push(`${from}: Reservierte Ordner können nicht verschoben werden`);
        continue;
      }
      const name = from.split('/').pop()!;
      try { await moveAsset(sourceCategory, from, name, destCategory); folderSuccess++; }
      catch (e) { errors.push(`${from}: ${(e as Error).message}`); }
    }
    setBulkOperationInProgress(false);
    const destLabel = CATEGORIES.find(c => c.id === destCategory)?.label ?? destCategory;
    if (fileSuccess > 0) showMsg('success', `✅ ${fileSuccess} Datei${fileSuccess !== 1 ? 'en' : ''} nach ${destLabel} verschoben`);
    if (folderSuccess > 0) showMsg('success', `✅ ${folderSuccess} Ordner nach ${destLabel} verschoben`);
    if (errors.length > 0) showMsg('error', `❌ ${errors.length} Fehler: ${errors[0]}`);
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    setCrossFolderData(null);
    load({ showLoading: false, preserveScroll: true });
  };

  // ── Usage + low-resolution filters — derived display state ──────────────
  // Both filters share `filterFolderTree`. Files survive only if they pass every active
  // filter; folders with no surviving descendants disappear. Surviving folders keep
  // their user-controlled expansion state.
  //
  // Low-resolution check: an image is flagged when its natural dimensions are smaller,
  // in BOTH axes, than the bounding box of the game it appears in. With
  // `object-fit: contain`, an image is upscaled iff both dimensions sit inside the box.
  //   - Used in any image-guess game → box 1920 × 648 px (.image-guess-image, 60vh)
  //   - Otherwise (used in another game, OR unused)   → box 1920 × 540 px (.quiz-image, 50vh)
  // SVGs and unprobed files have no `.dimensions` → never flagged.
  // RENDER_BOX_QUIZ / RENDER_BOX_IMAGE_GUESS are module-level (see top of file).
  const usageFilterActive = usageFilter !== null && usedFiles !== null;
  const lowResActive = lowResFilter && imageGuessFiles !== null && imageDimensions !== null && activeCategory === 'images';
  const filteredTree = useMemo(() => {
    if (!usageFilterActive && !lowResActive) return { files, subfolders };
    const metaByPath = new Map(collectAllFiles(files, fileMeta, subfolders).map(e => [e.filePath, e.meta]));
    const isLowResImage = (p: string): boolean => {
      const meta = metaByPath.get(p);
      if (!meta?.dimensions) return false;
      const box = imageGuessFiles!.has(p) ? RENDER_BOX_IMAGE_GUESS : RENDER_BOX_QUIZ;
      return meta.dimensions.width < box.w && meta.dimensions.height < box.h;
    };
    const predicate = (p: string): boolean => {
      if (usageFilterActive) {
        const used = usedFiles!.has(p);
        if (usageFilter === 'used' && !used) return false;
        if (usageFilter === 'unused' && used) return false;
      }
      if (lowResActive && !isLowResImage(p)) return false;
      return true;
    };
    const filteredSubs = filterFolderTree(subfolders, predicate, new Set<string>());
    const filteredRoot = files.filter(predicate);
    return { files: filteredRoot, subfolders: filteredSubs };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageFilterActive, usageFilter, usedFiles, lowResActive, lowResFilter, imageGuessFiles, files, subfolders, fileMeta]);
  const displayFiles = filteredTree.files;
  const displaySubfolders = filteredTree.subfolders;

  // Flat searchable index — walks the visible tree once when files/meta/subfolders change.
  // With 100k+ DAM entries this was being rebuilt on every search keystroke.
  const searchableEntries = useMemo(
    () => collectAllFiles(displayFiles, fileMeta, displaySubfolders),
    [displayFiles, fileMeta, displaySubfolders],
  );

  // Filter + sort result memoized on the search query + sort state. Uses the
  // precomputed `searchKey` so the inner loop is just `string.includes`.
  const filteredSearchEntries = useMemo(() => {
    if (!searchQuery) return [];
    const tokens = tokenizeSearch(searchQuery);
    const filtered = searchableEntries.filter(e => matchesSearchKey(e.searchKey, tokens));
    return sortFileEntries(filtered);
    // sortFileEntries closes over sortBy/sortReverse — list them so the memo refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchableEntries, searchQuery, sortBy, sortReverse]);

  // Cap rendered search results to avoid layout-thrashing the browser on broad queries
  // (e.g. "logo" against 120k entries). Hidden matches are still selectable via "Alle".
  const SEARCH_RESULT_CAP = 500;

  return (
    <div
      ref={containerRef}
      className={selectionMode ? 'asset-selecting' : undefined}
      onDragOver={onContainerDragOver}
      onDrop={onContainerDrop}
    >
      <StatusMessage message={message} />

      <div className="asset-category-tabs">
        {CATEGORIES.map(cat => {
          const isCrossDropTarget = canCrossMove(cat.id);
          const dropProps = isCrossDropTarget ? {
            onDragEnter: (e: React.DragEvent) => {
              if (activeCategory === cat.id) return;
              if (!canCrossMove(activeCategory)) return;
              e.preventDefault();
              setDragOverTabId(cat.id);
            },
            onDragOver: (e: React.DragEvent) => {
              if (activeCategory === cat.id) return;
              if (!canCrossMove(activeCategory)) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            },
            onDragLeave: () => setDragOverTabId(t => (t === cat.id ? null : t)),
            onDrop: (e: React.DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverTabId(null);
              if (e.dataTransfer) handleTabCrossDrop(cat.id, e.dataTransfer);
            },
          } : {};
          const dropTargetClass = dragOverTabId === cat.id ? ' asset-category-btn--drop-target' : '';
          return (
            <button
              key={cat.id}
              className={`asset-category-btn ${activeCategory === cat.id ? 'active' : ''}${dropTargetClass}`}
              onClick={() => handleCategoryChange(cat.id)}
              {...dropProps}
            >
              {cat.label}
            </button>
          );
        })}
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
            onFolderDrop={fromPath => handleMoveFolder(fromPath)}
            onFolderMultiDrop={paths => handleMoveFolders(paths)}
            onUrlDrop={urls => handleUrlDrop(urls)}
          >
            <span style={{ fontSize: 'var(--admin-sz-24, 24px)', display: 'block', marginBottom: 6 }}>
              {currentCat.mediaType === 'image' ? '🖼️' : currentCat.mediaType === 'video' ? '🎬' : '🎵'}
            </span>
            Dateien hier ablegen oder klicken zum Auswählen
            {activeCategory === 'images' && (
              <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.55)', marginTop: 4 }}>
                Cmd+V um Bild aus Zwischenablage einzufügen · Bilder aus anderen Browser-Fenstern können hierher gezogen werden
              </div>
            )}
            {(showYtDownload || isAudioCategory || activeCategory === 'images') && (
              <div className="upload-zone-buttons">
                {showYtDownload && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); setYtModal(true); setYtTab('search'); setYtSearchPick(null); setYtUrl(''); if (ytSubfolder && !allFolderPaths.includes(ytSubfolder)) setYtSubfolder(''); }}
                  >
                    <span className="yt-download-btn-icon">▶</span>
                    YouTube
                  </button>
                )}
                {activeCategory === 'videos' && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); setRefBrowserOpen(true); }}
                    title="Video als Referenz ohne lokale Kopie hinzufügen"
                  >
                    <span className="yt-download-btn-icon">🔗</span>
                    Referenz
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
                    onClick={e => { e.stopPropagation(); setImgUrlModal(true); setImgUrl(''); if (imgUrlSubfolder && !allFolderPaths.includes(imgUrlSubfolder)) setImgUrlSubfolder(''); }}
                  >
                    <span className="yt-download-btn-icon">🔗</span>
                    Von URL
                  </button>
                )}
                {activeCategory === 'images' && (
                  <button
                    className="yt-download-btn"
                    onClick={e => { e.stopPropagation(); setImageSearchModal(true); }}
                  >
                    <span className="yt-download-btn-icon">🌐</span>
                    Online suchen
                  </button>
                )}
              </div>
            )}
          </DropZone>

          {inTrashView ? (
            <TrashView
              category={activeCategory}
              onClose={() => { setInTrashView(false); refreshTrashCount(); load({ showLoading: false, preserveScroll: true }); }}
              onChanged={() => { setMessage(null); refreshTrashCount(); load({ showLoading: false, preserveScroll: true }); }}
              showMessage={(type, text) => showMsg(type, text)}
            />
          ) : (
          <>
          <div className="asset-search-row">
            <span className="asset-search-icon">🔍</span>
            <input
              className="be-input asset-search-input"
              placeholder="Dateien suchen…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus={!isTouchDevice()}
            />
            {searchQuery && (
              <button className="be-icon-btn asset-search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
            <button
              className={`be-icon-btn${selectionMode ? ' asset-select-toggle-active' : ''}`}
              onClick={() => {
                if (selectionMode) { setSelectionMode(false); selectNone(); }
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
                {sortBy === 'name' ? 'Name' : sortBy === 'date' ? 'Datum' : sortBy === 'size' ? 'Größe' : sortBy === 'duration' ? 'Länge' : sortBy === 'resolution' ? 'Auflösung' : 'Typ'}
                {sortReverse ? ' ↑' : ' ↓'}
                {(usageFilter !== null || lowResFilter) && <span className="asset-sort-filter-dot" aria-hidden />}
              </button>
              {showSort && (
                <>
                  <div className="asset-sort-backdrop" onClick={() => setShowSort(false)} />
                  <div className="asset-sort-popover">
                    {([
                      ['name', 'Name'],
                      ['date', 'Datum'],
                      ['size', 'Größe'],
                      ['type', 'Typ'],
                      ...(activeCategory !== 'images' ? [['duration', 'Länge'] as const] : []),
                      ...(activeCategory === 'images' ? [['resolution', 'Auflösung'] as const] : []),
                    ] as [SortField, string][]).map(([field, label]) => {
                      const resolutionDisabled = field === 'resolution' && imageDimensions === null;
                      return (
                        <button
                          key={field}
                          className={`asset-sort-btn${sortBy === field ? ' active' : ''}`}
                          onClick={() => {
                            if (sortBy === field) setSortReverse(r => !r);
                            else { setSortBy(field); setSortReverse(false); }
                          }}
                          disabled={resolutionDisabled}
                          title={resolutionDisabled ? 'Bildauflösungen werden geladen…' : undefined}
                        >
                          {label}{resolutionDisabled ? ' (Lädt…)' : ''}
                          {sortBy === field && <span className="asset-sort-arrow">{sortReverse ? ' ↑' : ' ↓'}</span>}
                        </button>
                      );
                    })}
                    <div className="asset-sort-divider" />
                    <div className="asset-sort-section-label">Verwendung</div>
                    {([['used', 'Verwendet'], ['unused', 'Unbenutzt']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        className={`asset-sort-btn${usageFilter === value ? ' active' : ''}`}
                        onClick={() => setUsageFilter(prev => (prev === value ? null : value))}
                        disabled={usageLoading && usageFilter !== value}
                      >
                        {label}
                        {usageFilter === value && <span className="asset-sort-arrow">✓</span>}
                      </button>
                    ))}
                    {activeCategory === 'images' && (
                      <>
                        <div className="asset-sort-divider" />
                        <div className="asset-sort-section-label">
                          Bilder{dimensionsLoading ? ' (Lädt Auflösungen…)' : ''}
                        </div>
                        <button
                          className={`asset-sort-btn${lowResFilter ? ' active' : ''}`}
                          onClick={() => setLowResFilter(v => !v)}
                          disabled={imageDimensions === null || (usageLoading && !lowResFilter)}
                          title="Bilder, die kleiner sind als der Rahmen, in dem sie angezeigt werden (werden beim Rendern hochskaliert)"
                        >
                          Niedrige Auflösung
                          {lowResFilter && <span className="asset-sort-arrow">✓</span>}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>


          {selectionMode && (
            <div className="asset-selection-toolbar">
              <button
                className="be-icon-btn asset-selection-close-btn"
                onClick={() => { setSelectionMode(false); selectNone(); }}
                title="Auswahlmodus beenden (Esc)"
                aria-label="Auswahlmodus beenden"
              >✕</button>
              <span className="asset-selection-count">
                {(() => {
                  const total = selectedFiles.size + selectedFolders.size;
                  if (total === 0) return 'Dateien oder Ordner auswählen';
                  if (selectedFolders.size === 0) return `${selectedFiles.size} Datei${selectedFiles.size !== 1 ? 'en' : ''} ausgewählt`;
                  if (selectedFiles.size === 0) return `${selectedFolders.size} Ordner ausgewählt`;
                  return `${selectedFiles.size} Datei${selectedFiles.size !== 1 ? 'en' : ''} + ${selectedFolders.size} Ordner ausgewählt`;
                })()}
              </span>
              <button className="be-icon-btn" onClick={() => (searchQuery || usageFilterActive || lowResActive) ? setSelectedFiles(new Set(getVisibleFilePaths())) : selectAllAtLevel()}>Alle</button>
              <button className="be-icon-btn" onClick={selectNone} disabled={selectedFiles.size === 0 && selectedFolders.size === 0}>Keine</button>
              <div style={{ flex: 1 }} />
              <button
                className="be-icon-btn"
                onClick={handleMultiMerge}
                disabled={selectedFiles.size < 2 || selectedFolders.size > 0 || bulkOperationInProgress}
                title="Ausgewählte Dateien zusammenführen (Duplikate entfernen)"
              >
                {mergeIcon} Zusammenführen ({selectedFiles.size})
              </button>
              <button
                className="be-icon-btn"
                onClick={() => { setBulkMoveTarget(''); setBulkMoveModal(true); }}
                disabled={(selectedFiles.size === 0 && selectedFolders.size === 0) || bulkOperationInProgress}
              >
                Verschieben ({selectedFiles.size + selectedFolders.size})
              </button>
              <button
                className="be-icon-btn asset-selection-delete-btn"
                onClick={handleBulkDelete}
                disabled={(selectedFiles.size === 0 && selectedFolders.size === 0) || bulkOperationInProgress}
              >
                Löschen ({selectedFiles.size + selectedFolders.size})
              </button>
            </div>
          )}

          {!searchQuery ? (
            <DropZone
              className="asset-folders-root-zone"
              onFileDrop={filesArg => handleUpload(filesArg)}
              onAssetDrop={assetPath => handleMoveAsset(assetPath)}
              onAssetMultiDrop={paths => handleMoveAssets(paths)}
              onFolderDrop={fromPath => handleMoveFolder(fromPath)}
              onFolderMultiDrop={paths => handleMoveFolders(paths)}
              onUrlDrop={urls => handleUrlDrop(urls)}
              noClick
            >
              <div
                className="asset-trash-folder"
                onClick={() => setInTrashView(true)}
                title="Papierkorb öffnen"
              >
                <div className="asset-trash-folder-header">
                  <span className="asset-trash-folder-icon" aria-hidden>🗑</span>
                  <span className="asset-trash-folder-name">Papierkorb</span>
                  <span className="asset-trash-folder-count">
                    {trashCount > 0 ? `${trashCount} Eintr${trashCount === 1 ? 'ag' : 'äge'}` : 'leer'}
                  </span>
                </div>
              </div>
              {displaySubfolders.map(folder => renderFolder(folder, folder.name, 0))}
              {(usageFilterActive || lowResActive) && displaySubfolders.length === 0 && displayFiles.length === 0 && (
                <div className="be-empty">
                  {lowResActive && !usageFilterActive
                    ? 'Keine niedrig auflösenden Bilder gefunden'
                    : usageFilter === 'used'
                      ? 'Keine verwendeten Dateien in dieser Kategorie'
                      : 'Keine unbenutzten Dateien in dieser Kategorie'}
                </div>
              )}
            </DropZone>
          ) : <div />}

          {searchQuery ? (() => {
            const filtered = filteredSearchEntries;
            if (filtered.length === 0) return <div className="be-empty">Keine Treffer für &ldquo;{searchQuery}&rdquo;</div>;
            const visible = filtered.length > SEARCH_RESULT_CAP ? filtered.slice(0, SEARCH_RESULT_CAP) : filtered;
            const resultCount = filtered.length > SEARCH_RESULT_CAP
              ? `${visible.length} von ${filtered.length} Treffern — Suche verfeinern, um mehr zu sehen`
              : `${filtered.length} Treffer`;

            if (currentCat.mediaType === 'image') return (
              <>
                <div className="asset-search-result-count">{resultCount}</div>
                <div className="asset-image-grid">
                  {visible.map(({ file, filePath, folder }) => renderImageCard(file, filePath, folder))}
                </div>
              </>
            );

            return (
              <>
                <div className="asset-search-result-count">{resultCount}</div>
                <div className="asset-file-list">
                  {visible.map(({ file, filePath, folder }) => (
                    <div key={filePath} className="asset-search-result-item">
                      {folder && <span className="asset-search-folder-badge" title={folder}>📁 {folder}</span>}
                      {currentCat.mediaType === 'audio'
                        ? renderAudioItem(file, filePath, assetUrl(activeCategory, filePath))
                        : renderVideoItem(file, filePath, assetUrl(activeCategory, filePath))}
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
                  displayFiles.length === 0
                    ? <div className="be-empty">{usageFilterActive ? (usageFilter === 'used' ? 'Keine verwendeten Bilder' : 'Keine unbenutzten Bilder') : 'Keine Bilder vorhanden'}</div>
                    : (
                      <div className="asset-image-grid">
                        {sortedFiles(displayFiles, fileMeta).map(file => renderImageCard(file, file))}
                      </div>
                    )
                )}
                {currentCat.mediaType === 'audio' && (
                  displayFiles.length === 0
                    ? <div className="be-empty">{usageFilterActive ? (usageFilter === 'used' ? 'Keine verwendeten Audiodateien' : 'Keine unbenutzten Audiodateien') : 'Keine Audiodateien vorhanden'}</div>
                    : <div className="asset-file-list">{sortedFiles(displayFiles, fileMeta).map(file => renderAudioItem(file, file, assetUrl(activeCategory, file)))}</div>
                )}
                {currentCat.mediaType === 'video' && (
                  displayFiles.length === 0
                    ? <div className="be-empty">{usageFilterActive ? (usageFilter === 'used' ? 'Keine verwendeten Videos' : 'Keine unbenutzten Videos') : 'Keine Videos vorhanden'}</div>
                    : <div className="asset-file-list">{sortedFiles(displayFiles, fileMeta).map(file => renderVideoItem(file, file, assetUrl(activeCategory, file)))}</div>
                )}
              </>
            ) : (
              // Has subfolders: show Stammordner as a DropZone so drag-to-root works without scrolling up
              <DropZone
                className="asset-root"
                onFileDrop={filesArg => handleUpload(filesArg)}
                onAssetDrop={assetPath => handleMoveAsset(assetPath)}
                onAssetMultiDrop={paths => handleMoveAssets(paths)}
                onFolderDrop={fromPath => handleMoveFolder(fromPath)}
                onFolderMultiDrop={paths => handleMoveFolders(paths)}
                onUrlDrop={urls => handleUrlDrop(urls)}
                noClick
              >
                <div className="asset-root-header">
                  <span className="asset-root-count">
                    {displayFiles.length > 0 ? `${displayFiles.length} Datei${displayFiles.length !== 1 ? 'en' : ''} im Root` : ''}
                  </span>
                  <label className="be-icon-btn" style={{ cursor: 'pointer', fontSize: 'var(--admin-sz-12, 12px)' }} title="Datei hochladen" onClick={e => e.stopPropagation()}>
                    Upload
                    <input type="file" accept={currentCat.accept} multiple style={{ display: 'none' }} onChange={e => { handleUpload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                  </label>
                </div>
                {currentCat.mediaType === 'image' && displayFiles.length > 0 && (
                  <div className="asset-image-grid" style={{ marginTop: 8 }}>
                    {sortedFiles(displayFiles, fileMeta).map(file => renderImageCard(file, file))}
                  </div>
                )}
                {currentCat.mediaType === 'audio' && displayFiles.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{sortedFiles(displayFiles, fileMeta).map(file => renderAudioItem(file, file, assetUrl(activeCategory, file)))}</div>
                )}
                {currentCat.mediaType === 'video' && displayFiles.length > 0 && (
                  <div className="asset-file-list" style={{ marginTop: 8 }}>{sortedFiles(displayFiles, fileMeta).map(file => renderVideoItem(file, file, assetUrl(activeCategory, file)))}</div>
                )}
              </DropZone>
            )
          )}
          </>
          )}
        </>
      )}

      {/* Audio detail modal */}
      {audioPreview && (
        <div className="modal-overlay" onClick={() => setAudioPreview(null)}>
          <div className="audio-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name image-lightbox-name--media"><span className="image-lightbox-icon">🎵</span>{renderFileNameEditable(audioPreview.filePath.split('/').pop()!, audioPreview.filePath, 'image-lightbox-filename', 'preview')}</span>
              {audioPreviewDuration > 0 && <span className="image-lightbox-dims">{fmtTime(audioPreviewDuration)}</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => { setMoveState({ filePath: audioPreview.filePath, name: audioPreview.filePath.split('/').pop()! }); setMoveTarget(''); setAudioPreview(null); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button
                className="be-icon-btn asset-merge-btn"
                onClick={() => openMergePicker(audioPreview.filePath)}
                title="Mit anderem Asset zusammenführen"
                aria-label="Zusammenführen"
              >{mergeIcon}</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(audioPreview.filePath, audioPreview.filePath); setAudioPreview(null); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={() => setAudioPreview(null)}>✕</button>
            </div>
            <div className="audio-detail-body">
              <div className="audio-detail-cover-column">
                <AudioCover
                  filePath={audioPreview.filePath}
                  version={(() => {
                    const n = audioCoverFilename(audioPreview.filePath.split('/').pop()!);
                    return audioCoverMeta[n]?.setAt ?? coverVersions[n];
                  })()}
                  className="audio-detail-cover"
                  onClick={() => setPosterPreview(`/images/Audio-Covers/${audioCoverFilename(audioPreview.filePath.split('/').pop()!)}`)}
                />
                {(() => {
                  const coverName = audioCoverFilename(audioPreview.filePath.split('/').pop()!);
                  const entry = audioCoverMeta[coverName];
                  if (!entry || entry.source === 'auto') return null;
                  const LABELS: Record<Exclude<AudioCoverSource, 'auto'>, string> = {
                    youtube: 'YouTube',
                    itunes: 'iTunes',
                    musicbrainz: 'MusicBrainz',
                    manual: 'Manuell',
                  };
                  const label = LABELS[entry.source as Exclude<AudioCoverSource, 'auto'>];
                  return (
                    <span
                      className={`audio-detail-cover-source audio-detail-cover-source--${entry.source}`}
                      title={`Quelle: ${label}`}
                    >
                      {label}
                    </span>
                  );
                })()}
                <div className="audio-detail-cover-actions">
                  <button
                    type="button"
                    className="be-icon-btn"
                    onClick={() => setCoverOverrideFor(audioPreview.filePath)}
                    title="Cover durch ein Bild aus dem DAM ersetzen"
                  >Cover wechseln</button>
                  {(() => {
                    const coverName = audioCoverFilename(audioPreview.filePath.split('/').pop()!);
                    const alreadyItunes = audioCoverMeta[coverName]?.source === 'itunes';
                    return (
                  <button
                    type="button"
                    className="be-icon-btn"
                    disabled={itunesBusy || alreadyItunes}
                    onClick={async () => {
                      if (itunesBusy) return;
                      const fp = audioPreview.filePath;
                      setItunesBusy(true);
                      try {
                        const result = await setItunesAudioCover(fp);
                        if ('success' in result) {
                          const coverName = audioCoverFilename(fp.split('/').pop()!);
                          setCoverVersions(prev => ({ ...prev, [coverName]: result.version }));
                          setAudioCoverMeta(prev => ({ ...prev, [coverName]: { source: 'itunes', setAt: Date.now() } }));
                        } else {
                          setItunesCandidate({ audioFileName: fp, confirmToken: result.confirmToken, candidate: result.candidate });
                        }
                      } catch (err) {
                        const e = err as Error & { status?: number };
                        const msg = e.status === 429
                          ? 'iTunes-Abruf aktuell limitiert — später erneut versuchen'
                          : e.status === 404
                            ? 'Kein iTunes-Treffer gefunden'
                            : `iTunes-Abruf fehlgeschlagen: ${e.message}`;
                        showMsg('error', msg);
                      } finally {
                        setItunesBusy(false);
                      }
                    }}
                    title={alreadyItunes ? 'Cover stammt bereits von iTunes' : 'Cover durch iTunes-Albumcover ersetzen'}
                  >Cover laden</button>
                    );
                  })()}
                </div>
              </div>
              <div className="audio-detail-waveform">
                <AudioTrimTimeline
                  src={audioPreview.src}
                  readOnly
                  onChange={() => {}}
                  onLoaded={setAudioPreviewDuration}
                />
              </div>
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
              <span className="image-lightbox-name image-lightbox-name--media"><span className="image-lightbox-icon">🎬</span>{renderFileNameEditable(videoPreview.filePath.split('/').pop()!, videoPreview.filePath, 'image-lightbox-filename', 'preview')}</span>
              {(videoInfo?.duration || videoPreviewDuration) > 0 && <span className="image-lightbox-dims">{fmtTime(videoInfo?.duration || videoPreviewDuration)}</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => { setMoveState({ filePath: videoPreview.filePath, name: videoPreview.filePath.split('/').pop()! }); setMoveTarget(''); closeVideoPreview(); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button
                className="be-icon-btn asset-merge-btn"
                onClick={() => openMergePicker(videoPreview.filePath)}
                title="Mit anderem Asset zusammenführen"
                aria-label="Zusammenführen"
              >{mergeIcon}</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(videoPreview.filePath, videoPreview.filePath); closeVideoPreview(); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={closeVideoPreview}>✕</button>
            </div>
            <div className="video-detail-player" style={{ position: 'relative' }}>
              {/* `width: 100%` is set inline so it only applies to the DAM preview (not to
               *  other `<video>`s that happen to appear inside the modal). This lets the
               *  video scale up to the modal's 1280-px width for landscape clips while the
               *  CSS-level `max-height: 70vh` still caps portrait or tall aspect ratios.
               *
               *  The `<source>` child is the key: without it (or an inline `src` attribute)
               *  Firefox with `preload="metadata"` tries to load the current page URL as
               *  media and errors with "HTTP Content-Type of 'text/html' is not supported".
               *  Matches the in-game player's pattern (VideoGuess.tsx). */}
              <video
                ref={videoPreviewRef}
                controls
                disablePictureInPicture
                preload="metadata"
                style={{ width: '100%', height: 'auto' }}
              >
                {videoPreview?.src && <source src={videoPreview.src} type="video/mp4" />}
              </video>
              {/* Custom loading overlay — Firefox's native `<video controls>` indicator is
               *  too subtle for most users to notice while a large file is buffering. The
               *  earlier "two spinners" bug came from an extra warmup overlay that has since
               *  been removed, so only this one renders. */}
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
            <div className="audio-detail-meta video-detail-meta-row">
              <MoviePoster
                filePath={videoPreview.filePath}
                version={posterVersions[videoFilenameToSlug(videoPreview.filePath.split('/').pop()!)]}
                className="video-detail-poster"
                onClick={e => { e.stopPropagation(); setPosterPreview(`/images/Movie Posters/${videoFilenameToSlug(videoPreview.filePath.split('/').pop()!)}.jpg`); }}
              />
              <span className="audio-detail-path">videos/{videoPreview.filePath}</span>
            </div>
            {videoProbeLoading && (
              <div className="audio-detail-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(255,255,255,0.5)' }}>
                <div className="video-loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                <span>Metadaten werden geladen…</span>
              </div>
            )}
            {videoInfo && (
              <div className="audio-detail-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 'var(--admin-sz-12, 12px)', alignItems: 'center' }}>
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
                    padding: '1px 6px', borderRadius: 4, fontSize: 'var(--admin-sz-10, 10px)', fontWeight: 700, letterSpacing: 0.5,
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
              <div className="audio-detail-usages" style={{ fontSize: 'var(--admin-sz-12, 12px)' }}>
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
                          padding: '3px 8px', borderRadius: 4, fontSize: 'var(--admin-sz-11, 11px)',
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
                <div style={{ marginTop: 4, fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                  Die Vorschau spielt immer die Standard-Tonspur (⭐). Zum Auswählen einer
                  anderen Sprache für die Gameshow den Marker-Editor verwenden.
                </div>
              </div>
            )}

            {/* Faststart warning + one-click fix. Many camera-origin clips (iPhone, GoPro,
             *  DSLR) and raw editor exports have `moov` at the end of the file, which makes
             *  the browser refuse to seek until it has downloaded the entire clip. The remux
             *  below is stream-copy (no re-encode), a few seconds for most files. */}
            {videoInfo && videoInfo.faststart === false && (
              <div style={{ padding: '8px 16px', background: 'rgba(248,113,113,0.1)', borderTop: '1px solid rgba(248,113,113,0.3)', fontSize: 'var(--admin-sz-12, 12px)' }}>
                <div style={{ color: 'rgba(248,113,113,0.95)', marginBottom: 6 }}>
                  ⚠ Datei ist nicht „faststart"-fähig: das <code>moov</code>-Atom liegt am
                  Ende der Datei. Browser können dadurch beim Springen erst weiterspielen,
                  wenn die komplette Datei geladen wurde — deshalb „Video hängt nach Sprung".
                  Ein einmaliger Remux (ohne Neukodierung, wenige Sekunden) verschiebt das
                  <code> moov</code> an den Anfang und macht die Datei seek-fähig.
                </div>
                {faststartError && (
                  <div style={{ color: 'rgba(248,113,113,0.95)', marginBottom: 6 }}>Fehler: {faststartError}</div>
                )}
                {faststartRunning && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(248,113,113,0.9)', marginBottom: 2 }}>
                      <span>⏳ Remux läuft… (läuft weiter, auch wenn der Tab neu geladen wird)</span>
                      <span style={{ fontFamily: 'monospace' }}>{faststartProgress}%</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${faststartProgress}%`, background: 'linear-gradient(90deg, var(--error-light), #fb923c)', borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-12, 12px)' }}
                  disabled={faststartRunning}
                  onClick={async () => {
                    if (!videoPreview) return;
                    setFaststartRunning(true);
                    setFaststartError(null);
                    setFaststartProgress(0);
                    try {
                      await faststartVideo(videoPreview.filePath, (ev) => {
                        if (typeof ev.percent === 'number') setFaststartProgress(ev.percent);
                      });
                      // Remux done (or server reported `alreadyFaststart`). Re-probe to
                      // flip the flag and let the banner disappear.
                      const probe = await probeVideo(videoPreview.filePath);
                      setVideoInfo(probe.videoInfo ?? null);
                    } catch (err) {
                      setFaststartError((err as Error).message);
                    } finally {
                      setFaststartRunning(false);
                    }
                  }}
                >
                  {faststartRunning ? '⏳ Remux läuft…' : '🚀 Faststart-Fix anwenden'}
                </button>
              </div>
            )}

            {/* HDR info — no full-file conversion anymore. When a video-guess question uses
             *  an HDR video with time markers, /videos-sdr/ tone-maps the segment on the fly
             *  into the persistent cache, so the pre-baked `-sdr.mp4` variant is obsolete. */}
            {videoInfo?.isHdr && (
              <div style={{ padding: '8px 16px', background: 'rgba(251,191,36,0.1)', borderTop: '1px solid rgba(251,191,36,0.3)', fontSize: 'var(--admin-sz-12, 12px)' }}>
                <div style={{ color: 'rgba(251,191,36,0.9)' }}>
                  HDR-Video — im direkten Browser-Preview sind Farben grau/flach. In der
                  Gameshow wird der markierte Ausschnitt automatisch in SDR tone-gemappt.
                </div>
              </div>
            )}

            {/* Browser-specific compat warning — only shown when the file+current browser
             *  combo hits a known bug (e.g. Firefox AppleVT HEVC-HDR decode crash on
             *  seek). Rendered in red so it stands out from the general HDR hint above;
             *  it describes an actual playback failure, not a cosmetic issue. */}
            {(() => {
              const warning = getBrowserVideoWarning(videoInfo);
              if (!warning) return null;
              return (
                <div style={{ padding: '8px 16px', background: 'rgba(248,113,113,0.1)', borderTop: '1px solid rgba(248,113,113,0.3)', fontSize: 'var(--admin-sz-12, 12px)' }}>
                  <div style={{ color: 'rgba(248,113,113,0.95)' }}>
                    ⚠ {warning}
                  </div>
                </div>
              );
            })()}

            {/* Audio-codec hint — preview always plays the raw file, so incompatible codecs
             *  (AC3/DTS/etc.) are silent. The segment cache that the gameshow uses re-encodes
             *  the selected audio track to AAC, so picking a language still makes sense. */}
            {videoNeedsTranscode && (
              <div style={{ padding: '8px 16px', background: 'rgba(251,191,36,0.1)', borderTop: '1px solid rgba(251,191,36,0.3)', fontSize: 'var(--admin-sz-12, 12px)' }}>
                <div style={{ color: 'rgba(251,191,36,0.9)' }}>
                  ⚠ Keine browserkompatible Tonspur — die Vorschau ist stumm. Die gewählte
                  Sprache wird im Cache für die Gameshow zu AAC konvertiert und spielt dort
                  korrekt ab.
                </div>
              </div>
            )}
            {/* Full-file transcode progress/error panels removed — those jobs no longer exist. */}

            {/* Per-video Whisper transcription controls. Self-contained component handles
             *  initial fetch, WebSocket progress subscription, and the start/pause/resume/stop
             *  lifecycle. State is server-authoritative so this survives modal close +
             *  re-open and Node restarts. */}
            <VideoTranscriptionPanel videoRelPath={videoPreview.filePath} />
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {previewImage && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className={`image-lightbox${previewImage.toLowerCase().endsWith('.svg') ? ' image-lightbox--svg' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              {renderFileNameEditable(previewImage.split('/').pop()!, previewImage, 'image-lightbox-name', 'preview')}
              {previewDims && !previewImage.toLowerCase().endsWith('.svg') && <span className="image-lightbox-dims">{previewDims.w} × {previewDims.h}px</span>}
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => { setMoveState({ filePath: previewImage, name: previewImage.split('/').pop()! }); setMoveTarget(''); setPreviewImage(null); }}
                title="Verschieben"
              >→ Verschieben</button>
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => setReplaceTarget(previewImage)}
                title="Ersetzen — höherauflösendes oder passendes Bild suchen"
                aria-label="Ersetzen"
              >↻ Ersetzen</button>
              <button
                className="be-icon-btn asset-merge-btn"
                onClick={() => openMergePicker(previewImage)}
                title="Mit anderem Asset zusammenführen"
                aria-label="Zusammenführen"
              >{mergeIcon}</button>
              <button className="be-delete-btn" onClick={() => { handleDelete(previewImage, previewImage); setPreviewImage(null); }} title="Löschen">🗑</button>
              <button className="be-icon-btn" onClick={() => setPreviewImage(null)}>✕</button>
            </div>
            <div className="image-lightbox-body">
              <img
                src={`${assetUrl(activeCategory, previewImage)}${imageVersions[previewImage] ? `?v=${imageVersions[previewImage]}` : ''}`}
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

      {/* Image replace modal — opened from the image lightbox header. The
          renderBox tells the modal which container the image will be displayed
          in so its resolution filter uses the SAME predicate as the DAM's
          "Niedrige Auflösung" filter (1920×648 for image-guess, 1920×540
          otherwise). */}
      {replaceTarget && (
        <ReplaceImageModal
          target={replaceTarget}
          currentDims={replaceTarget === previewImage ? previewDims : null}
          renderBox={imageGuessFiles?.has(replaceTarget) ? RENDER_BOX_IMAGE_GUESS : RENDER_BOX_QUIZ}
          onCancel={() => setReplaceTarget(null)}
          onReplaced={(result) => {
            // Bump cache-bust counters for the old and new paths.
            setImageVersions(v => ({
              ...v,
              [result.target]: result.version,
              [result.newFilename]: result.version,
            }));
            // Swap the lightbox to the new filename when the extension changed.
            if (result.extensionChanged && result.newFilename !== result.target) {
              setPreviewImage(result.newFilename);
              setPreviewDims(result.newDims);
            } else {
              setPreviewDims(result.newDims);
            }
            // Patch the local imageDimensions map so the resolution sort and
            // "Niedrige Auflösung" filter see the new dims immediately. Without
            // this we'd have to null + refetch the map, which flashes the
            // unfiltered view for 1-2s while it loads.
            setImageDimensions(prev => {
              if (!prev) return prev;
              const next = new Map(prev);
              if (result.extensionChanged && result.newFilename !== result.target) {
                next.delete(result.target);
              }
              next.set(result.newFilename, { width: result.newDims.w, height: result.newDims.h });
              return next;
            });
            // Same patch for usedFiles + imageGuessFiles when extension changed
            // (so the new filename inherits the old's game-ref membership and
            // the old key is dropped). For same-extension replaces these caches
            // don't change at all.
            if (result.extensionChanged && result.newFilename !== result.target) {
              const renameInSet = (s: Set<string> | null): Set<string> | null => {
                if (!s || !s.has(result.target)) return s;
                const next = new Set(s);
                next.delete(result.target);
                next.add(result.newFilename);
                return next;
              };
              setUsedFiles(renameInSet);
              setImageGuessFiles(renameInSet);
            }
            setReplaceTarget(null);
            showMsg('success', result.extensionChanged && result.rewrittenGames > 0
              ? `Bild ersetzt — ${result.newDims.w} × ${result.newDims.h}px. ${result.rewrittenGames} Spielreferenz(en) aktualisiert.`
              : `Bild ersetzt — ${result.newDims.w} × ${result.newDims.h}px.`);
            // Refresh the asset list so the (possibly renamed) file shows
            // correctly. `keepCaches: true` avoids the 1-2s filter flicker —
            // we patched the entries above.
            load({ showLoading: false, preserveScroll: true, keepCaches: true });
          }}
        />
      )}

      {/* Upload progress overlay is rendered in AdminScreen via UploadContext */}

      {/* Poster preview lightbox */}
      {posterPreview && (
        <div className="modal-overlay" onClick={() => setPosterPreview(null)}>
          <div className="image-lightbox" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">🖼 {posterPreview.split('/').pop()}</span>
              <button className="be-icon-btn" onClick={() => setPosterPreview(null)}>✕</button>
            </div>
            <div className="image-lightbox-body">
              <img src={posterPreview} alt="Filmcover" />
            </div>
          </div>
        </div>
      )}

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
              <img src={`${posterModal.posterPath}?v=${Date.now()}`} className="poster-modal-img" />
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
      {moveState && (() => {
        const crossCat = crossCategoryOf(activeCategory);
        const crossActive = moveTargetCategory !== activeCategory;
        const targetFolderPaths = crossActive && crossFolderData?.category === moveTargetCategory
          ? crossFolderData.paths : allFolderPaths;
        return (
        <div className="modal-overlay" onClick={() => setMoveState(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>Datei verschieben</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--admin-sz-13, 13px)', marginBottom: 12 }}>
              {moveState.filePath}
            </p>
            {canCrossMove(activeCategory) && crossCat && (
              <>
                <div style={{ marginBottom: 8, fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(255,255,255,0.5)' }}>Zielkategorie:</div>
                <div className="be-segmented" style={{ marginBottom: 16 }}>
                  {[activeCategory, crossCat].map(cat => {
                    const label = CATEGORIES.find(c => c.id === cat)?.label ?? cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`be-segmented-btn${moveTargetCategory === cat ? ' active' : ''}`}
                        onClick={() => setMoveTargetCategory(cat)}
                      >{label}</button>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ marginBottom: 8, fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(255,255,255,0.5)' }}>Zielordner:</div>
            <div className="be-list-row" style={{ marginBottom: 16 }}>
              <FolderCombobox
                value={moveTarget}
                onChange={setMoveTarget}
                options={targetFolderPaths}
                onSubmit={handleMove}
                placeholder="Ordnerpfad (leer = Wurzel)"
                autoFocus
              />
            </div>
            <div className="be-list-row">
              <button className="be-btn-primary" onClick={handleMove}>Verschieben</button>
              <button className="be-icon-btn" onClick={() => setMoveState(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
        );
      })()}

      {deleteConfirm && (
        <DeleteConfirmModal
          category={activeCategory}
          items={deleteConfirm.items}
          busy={deleteConfirm.busy}
          onConfirm={() => { void deleteConfirm.onConfirm(); }}
          onCancel={() => setDeleteConfirm(null)}
        />
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

      {bulkMoveModal && (() => {
        const crossCat = crossCategoryOf(activeCategory);
        const crossActive = bulkMoveTargetCategory !== activeCategory;
        const bulkTargetFolderPaths = crossActive && crossFolderData?.category === bulkMoveTargetCategory
          ? crossFolderData.paths : allFolderPaths;
        return (
        <div className="modal-overlay" onClick={() => setBulkMoveModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>
              {(() => {
                if (selectedFolders.size === 0) return `${selectedFiles.size} Datei${selectedFiles.size !== 1 ? 'en' : ''} verschieben`;
                if (selectedFiles.size === 0) return `${selectedFolders.size} Ordner verschieben`;
                return `${selectedFiles.size} Datei${selectedFiles.size !== 1 ? 'en' : ''} + ${selectedFolders.size} Ordner verschieben`;
              })()}
            </h2>
            <div style={{ maxHeight: 120, overflow: 'auto', fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
              {Array.from(selectedFolders).map(p => <div key={`folder:${p}`}>📁 {p}</div>)}
              {Array.from(selectedFiles).map(p => <div key={`file:${p}`}>{p}</div>)}
            </div>
            {canCrossMove(activeCategory) && crossCat && (
              <>
                <div style={{ marginBottom: 8, fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(255,255,255,0.5)' }}>Zielkategorie:</div>
                <div className="be-segmented" style={{ marginBottom: 16 }}>
                  {[activeCategory, crossCat].map(cat => {
                    const label = CATEGORIES.find(c => c.id === cat)?.label ?? cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`be-segmented-btn${bulkMoveTargetCategory === cat ? ' active' : ''}`}
                        onClick={() => setBulkMoveTargetCategory(cat)}
                      >{label}</button>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ marginBottom: 8, fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(255,255,255,0.5)' }}>Zielordner:</div>
            <div className="be-list-row" style={{ marginBottom: 16 }}>
              <FolderCombobox
                value={bulkMoveTarget}
                onChange={setBulkMoveTarget}
                options={bulkTargetFolderPaths}
                onSubmit={handleBulkMove}
                placeholder="Ordnerpfad (leer = Wurzel)"
                autoFocus
              />
            </div>
            <div className="be-list-row">
              <button className="be-btn-primary" onClick={handleBulkMove} disabled={bulkOperationInProgress}>
                {bulkOperationInProgress ? 'Wird verschoben…' : 'Verschieben'}
              </button>
              <button className="be-icon-btn" onClick={() => setBulkMoveModal(false)}>Abbrechen</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Merge picker — pick the second asset to merge with `mergeState.source` */}
      {mergeState?.stage === 'picker' && (
        <PickerModal
          category={activeCategory}
          onSelect={handleMergeTargetPicked}
          onClose={() => setMergeState(null)}
          disabledFilePath={mergeState.source}
        />
      )}

      {/* Audio cover override picker — pick any image from the DAM to use as cover */}
      {coverOverrideFor && (
        <PickerModal
          category="images"
          onSelect={async (sourceImageUrl) => {
            const audioFileName = coverOverrideFor;
            setCoverOverrideFor(null);
            try {
              const result = await overrideAudioCover(audioFileName, sourceImageUrl);
              const coverName = audioCoverFilename(audioFileName.split('/').pop()!);
              setCoverVersions(prev => ({ ...prev, [coverName]: result.version }));
              setAudioCoverMeta(prev => ({
                ...prev,
                [coverName]: { source: 'manual', setAt: Date.now(), origin: { pickedFrom: sourceImageUrl } },
              }));
              showMsg('success', 'Cover aktualisiert');
            } catch (err) {
              showMsg('error', `Cover konnte nicht aktualisiert werden: ${(err as Error).message}`);
            }
          }}
          onClose={() => setCoverOverrideFor(null)}
        />
      )}

      {/* iTunes unconfident-match confirmation modal */}
      {itunesCandidate && (
        <div className="modal-overlay" onClick={() => setItunesCandidate(null)}>
          <div className="itunes-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>iTunes-Treffer bestätigen?</h3>
            <div className="itunes-confirm-candidate">
              <img src={itunesCandidate.candidate.url} alt="iTunes-Cover" />
              <div className="itunes-confirm-meta">
                <strong>{itunesCandidate.candidate.track || '—'}</strong>
                <span>{itunesCandidate.candidate.artist || '—'}</span>
              </div>
            </div>
            <div className="itunes-confirm-actions">
              <button className="be-icon-btn" onClick={() => setItunesCandidate(null)} disabled={itunesBusy}>Abbrechen</button>
              <button
                className="be-btn-primary"
                disabled={itunesBusy}
                onClick={async () => {
                  setItunesBusy(true);
                  const { audioFileName, confirmToken } = itunesCandidate;
                  try {
                    const result = await setItunesAudioCover(audioFileName, confirmToken);
                    if ('success' in result) {
                      const coverName = audioCoverFilename(audioFileName.split('/').pop()!);
                      setCoverVersions(prev => ({ ...prev, [coverName]: result.version }));
                      setAudioCoverMeta(prev => ({ ...prev, [coverName]: { source: 'itunes', setAt: Date.now() } }));
                      setItunesCandidate(null);
                      showMsg('success', 'iTunes-Cover übernommen');
                    }
                  } catch (err) {
                    showMsg('error', `Cover konnte nicht übernommen werden: ${(err as Error).message}`);
                  } finally {
                    setItunesBusy(false);
                  }
                }}
              >Übernehmen</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge compare — side-by-side, choose which file to keep */}
      {mergeState?.stage === 'compare' && (() => {
        const { source, target, sourceUsages, targetUsages, keep, running } = mergeState;
        const keepPath = keep === 'source' ? source : target;
        const discardPath = keep === 'source' ? target : source;
        // Flat meta lookup across root + all subfolders for the active category.
        const allEntries = collectAllFiles(files, fileMeta, subfolders);
        const metaByPath = new Map(allEntries.map(e => [e.filePath, e.meta]));
        const fmtMtime = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const renderPane = (which: 'source' | 'target', filePath: string, usages: GameUsage[] | null) => {
          const isImage = currentCat.mediaType === 'image';
          const isVideo = currentCat.mediaType === 'video';
          const isSelected = keep === which;
          const url = assetUrl(activeCategory, filePath);
          const meta = metaByPath.get(filePath);
          const dims = mergeDims[which];
          // Stats line — size · (dims for images | duration for audio/video) · modified date.
          const statsParts: string[] = [];
          if (meta?.size !== undefined) statsParts.push(fmtFileSize(meta.size));
          if (isImage && dims && !filePath.toLowerCase().endsWith('.svg')) statsParts.push(`${dims.w} × ${dims.h}px`);
          if (!isImage && typeof meta?.duration === 'number' && meta.duration > 0) statsParts.push(fmtTime(meta.duration));
          if (meta?.mtime) statsParts.push(fmtMtime(meta.mtime));
          return (
            <label className={`asset-merge-pane${isSelected ? ' asset-merge-pane--keep' : ''}`} htmlFor={`merge-keep-${which}`}>
              <input
                id={`merge-keep-${which}`}
                type="radio"
                name="merge-keep"
                className="asset-merge-radio"
                checked={isSelected}
                disabled={running}
                onChange={() => setMergeState({ ...mergeState, keep: which })}
              />
              <div className="asset-merge-pane-label">{isSelected ? '✓ Behalten' : 'Verwerfen'}</div>
              <div className="asset-merge-pane-preview">
                {isImage && (
                  <img
                    src={url}
                    alt={filePath}
                    onLoad={e => {
                      const img = e.currentTarget;
                      setMergeDims(prev => ({ ...prev, [which]: { w: img.naturalWidth, h: img.naturalHeight } }));
                    }}
                  />
                )}
                {currentCat.mediaType === 'audio' && <MiniAudioPlayer src={url} />}
                {isVideo && (
                  <video src={url} controls preload="metadata" />
                )}
              </div>
              <div className="asset-merge-pane-meta">
                <div className="asset-merge-pane-name" title={filePath}>{filePath}</div>
                {statsParts.length > 0 && (
                  <div className="asset-merge-pane-stats">{statsParts.join(' · ')}</div>
                )}
                <div className="asset-merge-pane-usage">
                  {usages === null ? (
                    'Lädt Verwendungen…'
                  ) : usages.length === 0 ? (
                    'In keinem Spiel verwendet'
                  ) : (
                    <>
                      <div>Verwendet in {usages.length} Spiel{usages.length === 1 ? '' : 'en'}:</div>
                      <div className="asset-merge-pane-usage-tags">
                        {usages.map(u => (
                          <span
                            key={`${u.fileName}${u.instance ? `-${u.instance}` : ''}`}
                            className="asset-usage-tag"
                          >
                            {u.title}{u.instance ? ` · ${u.instance}` : ''}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </label>
          );
        };
        return (
          <div className="modal-overlay" onClick={() => !running && setMergeState(null)}>
            <div className="modal-box asset-merge-modal" onClick={e => e.stopPropagation()}>
              <h2>Assets zusammenführen</h2>
              <p className="asset-merge-intro">
                Wähle, welche Datei erhalten bleiben soll. Die andere wird gelöscht und alle
                Spiel-Referenzen werden auf die erhaltene Datei umgeschrieben.
              </p>
              {mergeIdentical === true && (
                <div className="asset-merge-identical-banner">
                  ✅ Identischer Inhalt — beide Dateien haben denselben Hash.
                </div>
              )}
              {mergeIdentical === false && (
                <div className="asset-merge-different-banner">
                  ⚠️ Unterschiedlicher Inhalt — die Dateien haben verschiedene Hashes.
                </div>
              )}
              <div className="asset-merge-panes">
                {renderPane('source', source, sourceUsages)}
                {renderPane('target', target, targetUsages)}
              </div>
              <div className="asset-merge-summary">
                <strong>Behalten:</strong> <code>{keepPath}</code><br />
                <strong>Löschen:</strong> <code>{discardPath}</code>
              </div>
              <div className="yt-modal-actions">
                <button className="be-btn-primary" onClick={handleConfirmMerge} disabled={running}>
                  {running ? 'Wird zusammengeführt…' : 'Zusammenführen'}
                </button>
                <button className="be-btn-secondary" onClick={() => setMergeState(null)} disabled={running}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Multi-file merge modal (from selection mode) */}
      {multiMergeState && (() => {
        if (multiMergeState.stage === 'loading') {
          return (
            <div className="modal-overlay">
              <div className="modal-box asset-merge-modal" onClick={e => e.stopPropagation()}>
                <h2>Dateien vergleichen…</h2>
                <p className="asset-merge-intro">Hashes werden berechnet und Verwendungen geladen…</p>
              </div>
            </div>
          );
        }
        const { hashGroups, keep, usages, running, files: mergeFiles, hashes } = multiMergeState;
        if (!hashGroups || !usages || !hashes) return null;
        const allIdentical = hashGroups.size === 1;
        const allEntries = collectAllFiles(files, fileMeta, subfolders);
        const metaByPath = new Map(allEntries.map(e => [e.filePath, e.meta]));
        const totalDiscards = mergeFiles.length - 1;
        const fmtMtime = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
        // When hashes differ, show one representative per hash for comparison.
        // When all identical, show all files so user can pick which name to keep.
        const displayFiles = allIdentical
          ? mergeFiles
          : [...hashGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([, group]) => {
              // Pick the best representative per group (most usages, shortest name)
              return [...group].sort((a, b) => {
                const diff = (usages[b]?.length ?? 0) - (usages[a]?.length ?? 0);
                if (diff !== 0) return diff;
                return a.length - b.length;
              })[0];
            });
        return (
          <div className="modal-overlay" onClick={() => !running && setMultiMergeState(null)}>
            <div className="modal-box asset-merge-modal asset-multi-merge-modal" onClick={e => e.stopPropagation()}>
              <h2>Mehrfach-Zusammenführung ({mergeFiles.length} Dateien)</h2>
              {allIdentical ? (
                <div className="asset-merge-identical-banner">
                  ✅ Alle {mergeFiles.length} Dateien sind identisch (gleicher Hash). Wähle die Datei, die behalten werden soll.
                </div>
              ) : (
                <p className="asset-merge-intro">
                  {hashGroups.size} verschiedene Inhalte erkannt. Wähle eine Datei als Gewinner —
                  alle anderen {totalDiscards} werden gelöscht und ihre Referenzen umgeschrieben.
                </p>
              )}
              <div className="asset-merge-panes asset-multi-merge-panes">
                {displayFiles.map(filePath => {
                  const isImage = currentCat.mediaType === 'image';
                  const isVideo = currentCat.mediaType === 'video';
                  const isKept = keep === filePath;
                  const url = assetUrl(activeCategory, filePath);
                  const meta = metaByPath.get(filePath);
                  const fileUsages = usages[filePath] ?? [];
                  const dims = multiMergeDims[filePath];
                  const fileHash = hashes[filePath];
                  const hashGroup = hashGroups.get(fileHash);
                  const statsParts: string[] = [];
                  if (meta?.size !== undefined) statsParts.push(fmtFileSize(meta.size));
                  if (isImage && dims && !filePath.toLowerCase().endsWith('.svg')) statsParts.push(`${dims.w} × ${dims.h}px`);
                  if (!isImage && typeof meta?.duration === 'number' && meta.duration > 0) statsParts.push(fmtTime(meta.duration));
                  if (meta?.mtime) statsParts.push(fmtMtime(meta.mtime));
                  return (
                    <label
                      key={filePath}
                      className={`asset-merge-pane${isKept ? ' asset-merge-pane--keep' : ''}`}
                      htmlFor={`multi-merge-${filePath}`}
                    >
                      <input
                        id={`multi-merge-${filePath}`}
                        type="radio"
                        name="multi-merge-keep"
                        className="asset-merge-radio"
                        checked={isKept}
                        disabled={running}
                        onChange={() => setMultiMergeState({ ...multiMergeState, keep: filePath })}
                      />
                      <div className="asset-merge-pane-label">{isKept ? '✓ Behalten' : 'Verwerfen'}</div>
                      <div className="asset-merge-pane-preview">
                        {isImage && (
                          <img
                            src={url}
                            alt={filePath}
                            onLoad={e => {
                              const img = e.currentTarget;
                              setMultiMergeDims(prev => ({ ...prev, [filePath]: { w: img.naturalWidth, h: img.naturalHeight } }));
                            }}
                          />
                        )}
                        {currentCat.mediaType === 'audio' && <MiniAudioPlayer src={url} />}
                        {isVideo && <video src={url} controls preload="metadata" />}
                      </div>
                      <div className="asset-merge-pane-meta">
                        <div className="asset-merge-pane-name" title={filePath}>{filePath}</div>
                        {statsParts.length > 0 && (
                          <div className="asset-merge-pane-stats">{statsParts.join(' · ')}</div>
                        )}
                        {!allIdentical && hashGroup && hashGroup.length > 1 && (
                          <div className="asset-merge-pane-stats">+ {hashGroup.length - 1} identische Datei{hashGroup.length - 1 !== 1 ? 'en' : ''}</div>
                        )}
                        <div className="asset-merge-pane-usage">
                          {fileUsages.length === 0 ? (
                            'In keinem Spiel verwendet'
                          ) : (
                            <>
                              <div>Verwendet in {fileUsages.length} Spiel{fileUsages.length === 1 ? '' : 'en'}:</div>
                              <div className="asset-merge-pane-usage-tags">
                                {fileUsages.map(u => (
                                  <span
                                    key={`${u.fileName}${u.instance ? `-${u.instance}` : ''}`}
                                    className="asset-usage-tag"
                                  >
                                    {u.title}{u.instance ? ` · ${u.instance}` : ''}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="asset-merge-summary">
                <strong>Behalten:</strong> <code>{keep}</code><br />
                <strong>Löschen:</strong> {totalDiscards} Datei{totalDiscards !== 1 ? 'en' : ''}
              </div>
              <div className="yt-modal-actions">
                <button className="be-btn-primary" onClick={handleConfirmMultiMerge} disabled={running || totalDiscards === 0}>
                  {running ? 'Wird zusammengeführt…' : `${mergeFiles.length} Datei${mergeFiles.length !== 1 ? 'en' : ''} zusammenführen`}
                </button>
                <button className="be-btn-secondary" onClick={() => setMultiMergeState(null)} disabled={running}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              const now = Date.now();
              setCoverVersions(prev => {
                const next = { ...prev };
                for (const f of selectedFiles) next[audioCoverFilename(f.split('/').pop()!)] = now;
                return next;
              });
            });
            setAudioCoverModal(false);
          }}
          onClose={() => setAudioCoverModal(false)}
        />
      )}

      {/* YouTube download modal */}
      {refBrowserOpen && activeCategory === 'videos' && (
        <ReferenceBrowser
          initialSubfolder=""
          availableSubfolders={allFolderPaths}
          onClose={() => setRefBrowserOpen(false)}
          onAdded={(_relPath, fileName) => {
            setRefBrowserOpen(false);
            showMsg('success', `🔗 Referenz hinzugefügt: ${fileName}`);
            load({ showLoading: false, preserveScroll: true });
          }}
        />
      )}

      {ytModal && (() => {
        const urlIsPlaylist = isAudioCategory && isPlaylistUrl(ytUrl.trim());
        return (
          <div className="modal-overlay" onClick={() => setYtModal(false)}>
            <div className={`modal-box yt-modal${ytTab === 'search' ? ' yt-modal--search' : ''}`} onClick={e => e.stopPropagation()}>
              <h2>YouTube Download</h2>
              <div className="yt-modal-tabs" role="tablist" aria-label="YouTube-Quelle">
                <button
                  type="button"
                  role="tab"
                  aria-selected={ytTab === 'search'}
                  className={`yt-modal-tab${ytTab === 'search' ? ' is-active' : ''}`}
                  onClick={() => setYtTab('search')}
                >
                  🔍 Suchen
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={ytTab === 'url'}
                  className={`yt-modal-tab${ytTab === 'url' ? ' is-active' : ''}`}
                  onClick={() => setYtTab('url')}
                >
                  🔗 URL
                </button>
              </div>
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
              {ytTab === 'url' ? (
                <>
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
                  {urlIsPlaylist && (
                    <div style={{ fontSize: 'var(--admin-sz-13, 13px)', color: 'rgba(255,255,255,0.6)', margin: '8px 0 4px' }}>
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
                </>
              ) : (
                <>
                  <div className="yt-search-body">
                    <YouTubeSearchPanel
                      selectedUrl={ytSearchPick?.url}
                      onSelect={(r) => setYtSearchPick(prev => (prev?.url === r.url ? null : r))}
                      onSearch={() => setYtSearchPick(null)}
                    />
                  </div>
                  <div className="yt-modal-actions">
                    {ytSearchPick && (
                      <button className="be-btn-primary" onClick={handleYoutubeSearchDownload}>✓ Herunterladen</button>
                    )}
                    <button className="be-btn-secondary" onClick={() => setYtModal(false)}>Abbrechen</button>
                  </div>
                </>
              )}
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

      {/* Online-Suche modal — opens from the "Online suchen" button in the
          upload zone. Reuses the shared <ImageSearchPanel> + the existing
          downloadImageFromUrl helper. */}
      {imageSearchModal && (
        <ImageSearchUploadModal
          allFolderPaths={allFolderPaths}
          defaultSubfolder={imgUrlSubfolder && allFolderPaths.includes(imgUrlSubfolder) ? imgUrlSubfolder : ''}
          renderBox={RENDER_BOX_IMAGE_GUESS}
          onCancel={() => setImageSearchModal(false)}
          onUploaded={(fileName, subfolder) => {
            setImageSearchModal(false);
            showMsg('success', `✅ ${fileName} heruntergeladen${subfolder ? ` (in ${subfolder})` : ''}`);
            load({ showLoading: false, preserveScroll: true });
          }}
        />
      )}
    </div>
  );
}
