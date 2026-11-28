import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AssetCategory, AssetFolder, AssetFileMeta } from '@/types/config';
import { fetchAssets, uploadAsset, createAssetFolder, downloadImageFromUrl, type ImageSearchResult, type ImageSearchProvider, type YouTubeSearchResult } from '@/services/backendApi';
import { useCoverUrl } from '@/context/AudioCoverMetaContext';
import { pastedImageFile, pasteTimestamp, toTitleCaseName } from '@/utils/filename';
import { readPastedImage } from '@/utils/clipboardImage';
import { toMediaSrc } from '@/utils/assetUrl';
import { isTouchDevice } from '@/utils/isTouchDevice';
import { parseYouTubeVideoId, youTubeWatchUrl } from '@/utils/youtube';
import MiniAudioPlayer from './MiniAudioPlayer';
import FolderNamePrompt from './FolderNamePrompt';
import AssetImageLightbox from './AssetImageLightbox';
import { resolveReplacedImage, useImageSrc } from './replacedImages';
import ImageSearchPanel, { ImageSearchFilterToggle } from './ImageSearchPanel';
import YouTubeSearchPanel, { YouTubePreview } from './YouTubeSearchPanel';
import { useUpload } from './UploadContext';
import { getAllFolderPaths, RENDER_BOX_QUIZ } from './assetFolders';

const IMAGE_CATEGORIES: AssetCategory[] = ['images'];
const VIDEO_CATEGORIES: AssetCategory[] = ['videos'];

const ONLINE_SOURCE_LABEL: Record<ImageSearchProvider, string> = {
  ddg: 'DuckDuckGo',
  commons: 'Wikimedia',
  'github-svg': 'Logos',
};

/**
 * Token-based search match. Splits the query on whitespace and requires every
 * token to appear in the filename. Separators (`-`, `_`, `.`) are normalized to
 * spaces first, so "my video" matches "my-video.mp4".
 */
export function matchesSearch(file: string, query: string): boolean {
  const tokens = tokenizeSearch(query);
  return matchesSearchKey(buildSearchKey(file), tokens);
}

/** Tokenize a search query once per keystroke — reuse the result across N files. */
export function tokenizeSearch(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * Precompute the lowercased + separator-normalized form used by matchesSearchKey.
 * Concatenates the raw lowercase ("my-video.mp4") with the normalized form
 * ("my video mp4"), so a query that targets either form still matches. Build
 * once per file at collection time, then reuse for every keystroke.
 */
export function buildSearchKey(file: string): string {
  const lower = file.toLowerCase();
  return `${lower} ${lower.replace(/[-_.]+/g, ' ')}`;
}

/** Performance-optimized matcher for large file lists. Tokens must come from tokenizeSearch. */
export function matchesSearchKey(searchKey: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  for (const t of tokens) if (!searchKey.includes(t)) return false;
  return true;
}

/** Recursively collect all file paths from folder tree as relative paths */
function collectFolderFiles(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [...f.files.map(file => `${p}/${file}`), ...collectFolderFiles(f.subfolders ?? [], p)];
  });
}

/** Recursively collect metadata from folder tree, keyed by relative path */
function collectFolderMeta(folders: AssetFolder[], prefix = ''): Record<string, AssetFileMeta> {
  const result: Record<string, AssetFileMeta> = {};
  for (const f of folders) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.fileMeta) {
      for (const [name, meta] of Object.entries(f.fileMeta)) {
        result[`${p}/${name}`] = meta;
      }
    }
    Object.assign(result, collectFolderMeta(f.subfolders ?? [], p));
  }
  return result;
}

type SortField = 'name' | 'date' | 'size' | 'type' | 'duration';

function sortFiles(
  files: string[],
  meta: Record<string, AssetFileMeta> | undefined,
  sortBy: SortField,
  sortReverse: boolean,
): string[] {
  const sorted = [...files].sort((a, b) => {
    const nameA = a.split('/').pop()!;
    const nameB = b.split('/').pop()!;
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = nameA.localeCompare(nameB, 'de', { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'date') {
      const ma = meta?.[a]?.mtime ?? 0;
      const mb = meta?.[b]?.mtime ?? 0;
      cmp = mb - ma;
    } else if (sortBy === 'size') {
      const sa = meta?.[a]?.size ?? 0;
      const sb = meta?.[b]?.size ?? 0;
      cmp = sb - sa;
    } else if (sortBy === 'type') {
      const extA = nameA.includes('.') ? nameA.split('.').pop()!.toLowerCase() : '';
      const extB = nameB.includes('.') ? nameB.split('.').pop()!.toLowerCase() : '';
      cmp = extA.localeCompare(extB, 'de', { sensitivity: 'base' });
      if (cmp === 0) cmp = nameA.localeCompare(nameB, 'de', { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'duration') {
      const da = meta?.[a]?.duration ?? -1;
      const db = meta?.[b]?.duration ?? -1;
      cmp = db - da; // longest first by default
    }
    return cmp;
  });
  return sortReverse ? sorted.reverse() : sorted;
}

/** Find the AssetFolder node at the given path segments */
function findFolder(folders: AssetFolder[], segments: string[]): AssetFolder | null {
  if (!segments.length) return null;
  const found = folders.find(f => f.name === segments[0]);
  if (!found) return null;
  return segments.length === 1 ? found : findFolder(found.subfolders, segments.slice(1));
}

function isImageCategory(cat: AssetCategory) {
  return IMAGE_CATEGORIES.includes(cat);
}

/** Categories whose picker offers the "▶ YouTube" download mode. */
function isYouTubeCategory(cat: AssetCategory) {
  return cat === 'audio' || cat === 'videos';
}

function isVideoCategory(cat: AssetCategory) {
  return VIDEO_CATEGORIES.includes(cat);
}

/** Build the public URL for an asset given its category and relative path.
 *  Returns the **raw** logical path — this value is stored into game config via
 *  `onSelect`, and asset rename/move rewrites config refs by matching raw disk
 *  paths, so it must NOT be percent-encoded here. URL-encoding for `#`/`?`/etc.
 *  happens at the DOM `src` boundary in the consumers (DAM preview, game render). */
function assetUrl(category: AssetCategory, filePath: string): string {
  return `/${category}/${filePath}`;
}

/** An image pasted into the picker, waiting for "✓ Übernehmen". */
type PastedCandidate =
  | { kind: 'file'; file: File; previewUrl: string }
  | { kind: 'url'; url: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pastedMetaSource(p: PastedCandidate): string {
  if (p.kind === 'file') {
    const type = p.file.type.split('/')[1]?.split('+')[0]?.toUpperCase() || 'Bild';
    return `${type} · ${formatBytes(p.file.size)}`;
  }
  try {
    return `Quelle: ${new URL(p.url).hostname}`;
  } catch {
    return 'Quelle: URL';
  }
}

// ── Picker Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  category: AssetCategory;
  onSelect: (url: string) => void;
  onClose: () => void;
  /** Multi-select mode: show checkboxes + confirm button instead of click-to-select */
  multiSelect?: boolean;
  /** In multi-select mode: callback with selected filenames (basenames) when confirmed */
  onMultiSelect?: (files: string[]) => void;
  /** Basenames (no extension) to hide from the list */
  hiddenBasenames?: Set<string>;
  /** Label for the confirm button in multi-select mode */
  multiSelectLabel?: string;
  /** Filenames (basenames) that were rate-limited in the last cover fetch */
  rateLimitedFiles?: Set<string>;
  /**
   * Relative path of a file that should be shown but not selectable (greyed
   * out). Used by the DAM merge flow to mark the source asset so the operator
   * can see it in the results but can't pick it as its own merge target.
   */
  disabledFilePath?: string;
  /**
   * Render box used by the online image-search low-resolution filter. Forwarded
   * to <ImageSearchPanel>. Only meaningful when `category === 'images'`; the
   * game form passes its game-specific box (e.g. `RENDER_BOX_IMAGE_GUESS`),
   * everything else defaults to `RENDER_BOX_QUIZ` (1920 × 540).
   */
  renderBox?: { w: number; h: number };
  /**
   * Pre-fills the 🌐 Online search field. The search itself waits for the
   * user's Suchen / Enter. Game forms pass the question text for a question
   * image and the answer for an answer image.
   */
  searchQuery?: string;
}

export function PickerModal({ category, onSelect, onClose, multiSelect, onMultiSelect, hiddenBasenames, multiSelectLabel, rateLimitedFiles, disabledFilePath, renderBox, searchQuery }: ModalProps) {
  const coverUrl = useCoverUrl();
  const [files, setFiles] = useState<string[]>([]);
  const [fileMeta, setFileMeta] = useState<Record<string, AssetFileMeta>>({});
  const [subfolders, setSubfolders] = useState<AssetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Empty string = root; 'Folder' or 'Folder/Sub' = inside that path
  const [currentPath, setCurrentPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortReverse, setSortReverse] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Online image-search mode (image category only, single-select only) and
  // YouTube mode (audio/video categories only, single-select only).
  const [mode, setMode] = useState<'dam' | 'online' | 'youtube'>('dam');
  const [onlineSubfolder, setOnlineSubfolder] = useState('');
  const [onlineCandidate, setOnlineCandidate] = useState<ImageSearchResult | null>(null);
  const [onlineCandidateQuery, setOnlineCandidateQuery] = useState('');
  const [onlineDownloading, setOnlineDownloading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [onlineEnlarged, setOnlineEnlarged] = useState<{ src: string; name: string } | null>(null);
  const [hideSmallerResults, setHideSmallerResults] = useState(true);
  const [onlineHiddenCount, setOnlineHiddenCount] = useState(0);

  // Clipboard paste (image category, single-select only): an image or image
  // URL pasted anywhere in the picker becomes a preview that "✓ Übernehmen"
  // saves to the DAM.
  const [pasted, setPasted] = useState<PastedCandidate | null>(null);
  const [pastedSaving, setPastedSaving] = useState(false);
  const [pastedError, setPastedError] = useState<string | null>(null);
  const [pastedDims, setPastedDims] = useState<{ w: number; h: number } | null>(null);
  const [pastedPreviewFailed, setPastedPreviewFailed] = useState(false);

  // YouTube mode. The download runs in UploadContext (shared progress overlay),
  // so it outlives the picker; `mountedRef` makes a late result a no-op once the
  // picker is closed, and `onSelectRef` always calls the latest onSelect.
  // `useUpload()` is null outside an UploadProvider (unit tests render the
  // picker bare); the YouTube toggle is hidden then.
  const startYtDownload = useUpload()?.startYtDownload;
  const [ytCandidate, setYtCandidate] = useState<YouTubeSearchResult | null>(null);
  const [ytUrl, setYtUrl] = useState('');
  const [ytUrlError, setYtUrlError] = useState<string | null>(null);
  const [ytDownloading, setYtDownloading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchAssets(category)
      .then(data => {
        setFiles(data.files ?? []);
        setFileMeta(data.fileMeta ?? {});
        setSubfolders(data.subfolders ?? []);
      })
      .finally(() => setLoading(false));
  }, [category]);

  // Single Esc handler with priority: close lightbox → discard pasted image →
  // deselect online candidate → close the picker. Each branch calls
  // preventDefault + stopPropagation so the browser doesn't also act on the
  // key (e.g. exit fullscreen). While a paste is being saved or an online
  // download is in flight we don't allow discard/deselect/close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (onlineEnlarged) {
        e.preventDefault();
        e.stopPropagation();
        setOnlineEnlarged(null);
        return;
      }
      if (pastedSaving) return;
      if (pasted) {
        e.preventDefault();
        e.stopPropagation();
        setPasted(null);
        return;
      }
      if (onlineDownloading) return;
      if (onlineCandidate) {
        e.preventDefault();
        e.stopPropagation();
        setOnlineCandidate(null);
        return;
      }
      // A running YouTube download keeps going after the picker closes, so Esc
      // skips the deselect step and closes directly.
      if (ytCandidate && !ytDownloading) {
        e.preventDefault();
        e.stopPropagation();
        setYtCandidate(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onlineEnlarged, pasted, pastedSaving, onlineCandidate, onlineDownloading, ytCandidate, ytDownloading, onClose]);

  const isImage = isImageCategory(category);
  const isSearching = search.trim().length > 0;
  const allFolderPaths = useMemo(() => getAllFolderPaths(subfolders), [subfolders]);
  // Show the DAM/Online toggle for image picks and the DAM/YouTube toggle for
  // audio/video picks, never in the multi-select (cover-loading) flow.
  const showYouTubeToggle = isYouTubeCategory(category) && !multiSelect && !!startYtDownload;
  const showModeToggle = (isImage && !multiSelect) || showYouTubeToggle;
  const pasteEnabled = isImage && !multiSelect;
  const anyDownloading = onlineDownloading || ytDownloading || pastedSaving;

  // Capture phase + stopImmediatePropagation, so the DAM tab's own
  // paste-to-upload listener on `document` doesn't also upload the image.
  // Text that isn't an image URL passes through to the focused input.
  useEffect(() => {
    if (!pasteEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const img = readPastedImage(e.clipboardData);
      if (!img) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (anyDownloading) return;
      setPastedError(null);
      setPastedDims(null);
      setPastedPreviewFailed(false);
      setPasted(img.kind === 'file'
        ? { kind: 'file', file: img.file, previewUrl: URL.createObjectURL(img.file) }
        : img);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [pasteEnabled, anyDownloading]);

  // Revoke a file preview's object URL once it is replaced, discarded or the
  // picker unmounts.
  useEffect(() => {
    if (pasted?.kind !== 'file') return;
    const url = pasted.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [pasted]);

  const switchMode = (next: typeof mode) => {
    setPasted(null);
    setPastedError(null);
    setMode(next);
  };

  const handlePastedConfirm = useCallback(async () => {
    if (!pasted) return;
    const subfolder = onlineSubfolder;
    setPastedSaving(true);
    setPastedError(null);
    try {
      const fileName = pasted.kind === 'file'
        ? await uploadAsset(category, pastedImageFile(pasted.file, pasteTimestamp()), subfolder || undefined)
        : await downloadImageFromUrl(category, pasted.url, subfolder || undefined);
      onSelect(assetUrl(category, subfolder ? `${subfolder}/${fileName}` : fileName));
    } catch (err) {
      setPastedError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
      setPastedSaving(false);
    }
  }, [pasted, onlineSubfolder, category, onSelect]);

  // Follow the user's DAM navigation into the online subfolder field, until
  // they switch to online mode and explicitly pick a different folder. After
  // a successful online download we also reset it so the next picker open
  // starts in the freshly-browsed folder.
  useEffect(() => {
    if (mode === 'dam') setOnlineSubfolder(currentPath);
  }, [currentPath, mode]);

  // Clicking a candidate toggle-selects it; the actual download is gated
  // behind the "✓ Herunterladen" confirm button below so the user can review
  // the larger preview before committing.
  const handleOnlineSelect = useCallback((r: ImageSearchResult, query: string) => {
    setOnlineError(null);
    setOnlineCandidate(prev => (prev?.url === r.url ? null : r));
    setOnlineCandidateQuery(query);
  }, []);

  const handleOnlineSearchSubmit = useCallback(() => {
    setOnlineCandidate(null);
    setOnlineError(null);
  }, []);

  const handleOnlineConfirm = useCallback(async () => {
    if (!onlineCandidate) return;
    setOnlineDownloading(true);
    setOnlineError(null);
    try {
      const desiredName = toTitleCaseName(onlineCandidateQuery) || undefined;
      const fileName = await downloadImageFromUrl('images', onlineCandidate.url, onlineSubfolder || undefined, desiredName);
      const relativePath = onlineSubfolder ? `${onlineSubfolder}/${fileName}` : fileName;
      onSelect(assetUrl(category, relativePath));
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : 'Download fehlgeschlagen');
      setOnlineDownloading(false);
    }
  }, [onlineCandidate, onlineCandidateQuery, onlineSubfolder, category, onSelect]);

  // Clicking a YouTube result toggle-selects it and opens the preview player;
  // the download is gated behind "✓ Herunterladen", as for images.
  const handleYtSelect = useCallback((r: YouTubeSearchResult) => {
    setYtError(null);
    setYtUrlError(null);
    setYtCandidate(prev => (prev?.url === r.url ? null : r));
  }, []);

  const handleYtSearchSubmit = useCallback(() => {
    setYtCandidate(null);
    setYtError(null);
  }, []);

  // A pasted link becomes a candidate with the canonical watch URL, which also
  // drops `&list=` / `&t=` so only that one video is downloaded.
  const handleYtUrlPreview = useCallback(() => {
    setYtError(null);
    const id = parseYouTubeVideoId(ytUrl);
    if (!id) {
      setYtUrlError('Keine gültige YouTube-URL');
      return;
    }
    setYtUrlError(null);
    setYtCandidate({ id, url: youTubeWatchUrl(id), title: 'Video aus Link' });
  }, [ytUrl]);

  const handleYtConfirm = useCallback(() => {
    if (!ytCandidate || !startYtDownload) return;
    const subfolder = onlineSubfolder;
    setYtDownloading(true);
    setYtError(null);
    const fail = (message: string) => {
      if (!mountedRef.current) return;
      setYtError(message);
      setYtDownloading(false);
    };
    startYtDownload(category, ytCandidate.url, subfolder || undefined, fileName => {
      if (!mountedRef.current) return;
      // The stream ends without a file name when the job was cancelled from
      // the progress overlay.
      if (!fileName) { fail('Download abgebrochen'); return; }
      onSelectRef.current(assetUrl(category, subfolder ? `${subfolder}/${fileName}` : fileName));
    }, undefined, message => fail(message || 'Download fehlgeschlagen'));
  }, [ytCandidate, startYtDownload, onlineSubfolder, category]);


  // Merged metadata map + flat list of all files. Memoized so the recursive walk
  // doesn't re-run on every keystroke (with 100k+ DAM files it costs ~hundreds of ms).
  const { allFiles, allMeta, fileSearchKeys } = useMemo(() => {
    const meta: Record<string, AssetFileMeta> = { ...fileMeta, ...collectFolderMeta(subfolders) };
    const flat = [...files, ...collectFolderFiles(subfolders)];
    const keys = new Map<string, string>();
    for (const f of flat) keys.set(f, buildSearchKey(f));
    return { allFiles: flat, allMeta: meta, fileSearchKeys: keys };
  }, [files, fileMeta, subfolders]);

  const filteredFiles = useMemo(() => {
    const tokens = tokenizeSearch(search);
    if (tokens.length === 0) return allFiles;
    return allFiles.filter(f => matchesSearchKey(fileSearchKeys.get(f) ?? buildSearchKey(f), tokens));
  }, [allFiles, fileSearchKeys, search]);

  // Browse mode: resolve the current folder node
  const pathSegments = currentPath ? currentPath.split('/') : [];
  const currentNode = currentPath ? findFolder(subfolders, pathSegments) : null;

  const viewFiles: string[] = currentPath === ''
    ? files
    : (currentNode?.files.map(f => `${currentPath}/${f}`) ?? []);
  const viewSubfolders: AssetFolder[] = currentPath === ''
    ? subfolders
    : (currentNode?.subfolders ?? []);

  const rawDisplayFiles = isSearching ? filteredFiles : viewFiles;
  // In multi-select mode, hide files whose basename (without ext) is in hiddenBasenames (unless showAll toggled)
  const sortedDisplayFiles = sortFiles(
    (hiddenBasenames && !showAll)
      ? rawDisplayFiles.filter(f => {
          const basename = f.split('/').pop()!.replace(/\.[^.]+$/, '');
          return !hiddenBasenames.has(basename);
        })
      : rawDisplayFiles,
    allMeta,
    sortBy,
    sortReverse,
  );
  const displayFiles = sortedDisplayFiles;
  const hiddenCount = hiddenBasenames
    ? rawDisplayFiles.length - rawDisplayFiles.filter(f => {
        const basename = f.split('/').pop()!.replace(/\.[^.]+$/, '');
        return !hiddenBasenames.has(basename);
      }).length
    : 0;
  const displayFolders = isSearching ? [] : viewSubfolders;
  const isEmpty = displayFiles.length === 0 && displayFolders.length === 0;

  const enterFolder = (sf: AssetFolder) =>
    setCurrentPath(currentPath ? `${currentPath}/${sf.name}` : sf.name);

  const goUp = () =>
    setCurrentPath(pathSegments.slice(0, -1).join('/'));

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      // Upload EVERY selected file, then select the last one. The loop used to
      // `return` after the first iteration, so with the picker's `multiple`
      // input the operator dropped five files, saw one appear, and silently
      // lost the other four.
      let lastUrl: string | null = null;
      for (const file of Array.from(fileList)) {
        const fileName = await uploadAsset(category, file, currentPath || undefined);
        const relativePath = currentPath ? `${currentPath}/${fileName}` : fileName;
        lastUrl = assetUrl(category, relativePath);
      }
      if (lastUrl) onSelect(lastUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
      setUploading(false);
    }
  };

  const handleCreateFolder = async (name: string) => {
    setUploadError('');
    try {
      const folderPath = currentPath ? `${currentPath}/${name}` : name;
      await createAssetFolder(category, folderPath);
      const data = await fetchAssets(category);
      setFiles(data.files ?? []);
      setFileMeta(data.fileMeta ?? {});
      setSubfolders(data.subfolders ?? []);
      setCurrentPath(folderPath);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Ordner erstellen fehlgeschlagen');
    }
  };

  // Target folder for Online / YouTube downloads; omitted when the category has
  // no subfolders (downloads then land at the category root).
  const subfolderSelect = allFolderPaths.length > 0 ? (
    <label>
      Speichern in:
      <select
        value={onlineSubfolder}
        onChange={e => setOnlineSubfolder(e.target.value)}
        disabled={anyDownloading}
      >
        <option value="">— (Hauptordner)</option>
        {allFolderPaths.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </label>
  ) : (
    <span />
  );

  const acceptTypes = isImageCategory(category) ? 'image/*'
    : category === 'videos' ? 'video/*'
    : 'audio/*';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>{multiSelect ? (multiSelectLabel ?? 'Auswählen') : category}</h3>
          {/* Filters the DAM listing only; Online / YouTube bring their own search field. */}
          {mode === 'dam' && (
            <input
              className="be-input picker-header-search"
              placeholder="Suchen..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus={!isTouchDevice()}
            />
          )}
          {showModeToggle && (
            <div className="picker-mode-toggle">
              <button
                type="button"
                className={`be-icon-btn${mode === 'dam' ? ' asset-select-toggle-active' : ''}`}
                onClick={() => switchMode('dam')}
                disabled={anyDownloading}
              >
                DAM
              </button>
              {showYouTubeToggle ? (
                <button
                  type="button"
                  className={`be-icon-btn${mode === 'youtube' ? ' asset-select-toggle-active' : ''}`}
                  onClick={() => switchMode('youtube')}
                  disabled={anyDownloading}
                >
                  ▶ YouTube
                </button>
              ) : (
                <button
                  type="button"
                  className={`be-icon-btn${mode === 'online' ? ' asset-select-toggle-active' : ''}`}
                  onClick={() => switchMode('online')}
                  disabled={anyDownloading}
                >
                  🌐 Online
                </button>
              )}
            </div>
          )}
          {mode === 'dam' && !multiSelect && (
            <>
              <button
                className="be-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Lädt…' : 'Hochladen'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptTypes}
                multiple
                style={{ display: 'none' }}
                onChange={e => handleUpload(e.target.files)}
              />
              <button
                className="be-icon-btn"
                onClick={() => setShowFolderPrompt(true)}
              >
                📁+
              </button>
            </>
          )}
          {multiSelect && hiddenBasenames && hiddenCount > 0 && (
            <label className="be-toggle" style={{ margin: 0, marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={() => setShowAll(v => !v)}
              />
              <span className="be-toggle-track" />
              <span className="be-toggle-label">Alle anzeigen</span>
            </label>
          )}
          {multiSelect && (
            <button
              className="be-icon-btn"
              style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
              onClick={() => {
                if (selected.size === displayFiles.length) {
                  setSelected(new Set());
                } else {
                  setSelected(new Set(displayFiles.map(f => f.split('/').pop()!)));
                }
              }}
            >
              {selected.size === displayFiles.length && displayFiles.length > 0 ? 'Keine' : 'Alle auswählen'}
            </button>
          )}
          {mode === 'dam' && (
          <div className="asset-sort-wrapper">
            <button
              className={`be-icon-btn${showSort ? ' asset-select-toggle-active' : ''}`}
              onClick={() => setShowSort(s => !s)}
              title="Sortierung"
            >
              {sortBy === 'name' ? 'Name' : sortBy === 'date' ? 'Datum' : sortBy === 'size' ? 'Größe' : sortBy === 'duration' ? 'Länge' : 'Typ'}
              {sortReverse ? ' ↑' : ' ↓'}
            </button>
            {showSort && (
              <>
                <div className="asset-sort-backdrop" onClick={() => setShowSort(false)} />
                <div className="asset-sort-popover">
                  {([['name', 'Name'], ['date', 'Datum'], ['size', 'Größe'], ['type', 'Typ'], ...(!IMAGE_CATEGORIES.includes(category) ? [['duration', 'Länge'] as const] : [])] as [SortField, string][]).map(([field, label]) => (
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
          )}
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

        {uploadError && (
          <div style={{ margin: '0 16px 8px', padding: '6px 10px', fontSize: 'var(--admin-sz-13, 13px)', color: 'var(--error-lighter)', background: 'rgba(var(--error-deep-rgb), 0.1)', borderRadius: 4 }}>
            {uploadError}
          </div>
        )}

        {showFolderPrompt && (
          <FolderNamePrompt
            title="Ordner erstellen"
            onConfirm={name => { setShowFolderPrompt(false); handleCreateFolder(name); }}
            onCancel={() => setShowFolderPrompt(false)}
          />
        )}

        {pasteEnabled && !pasted && (
          <div className="picker-paste-hint">Strg+V / ⌘V: Bild oder Bild-URL einfügen</div>
        )}

        {mode === 'dam' && !pasted && !isSearching && currentPath && (
          <div className="picker-nav">
            <button className="be-icon-btn" onClick={goUp}>← Zurück</button>
            <span className="picker-nav-folder">{currentPath}</span>
          </div>
        )}

        {onlineEnlarged && createPortal(
          <div className="modal-overlay" onClick={() => setOnlineEnlarged(null)}>
            <div className="image-lightbox" onClick={e => e.stopPropagation()}>
              <div className="image-lightbox-header">
                <span className="image-lightbox-name">🖼 {onlineEnlarged.name}</span>
                <button className="be-icon-btn" onClick={() => setOnlineEnlarged(null)} aria-label="Schließen">✕</button>
              </div>
              <div className="image-lightbox-body">
                <img src={onlineEnlarged.src} alt={onlineEnlarged.name} referrerPolicy="no-referrer" />
              </div>
            </div>
          </div>,
          document.body,
        )}

        {pasted ? (() => {
          const src = pasted.kind === 'file' ? pasted.previewUrl : pasted.url;
          const name = pasted.kind === 'file'
            ? 'Eingefügtes Bild'
            : (decodeURIComponentSafe(pasted.url.split(/[?#]/)[0]?.split('/').pop() ?? '') || 'Bild-URL');
          const dims = pastedDims ? `${pastedDims.w} × ${pastedDims.h}px` : '—';
          return (
            <>
              <div className="picker-online-subfolder">
                {subfolderSelect}
              </div>
              <div className="replace-compare replace-compare--single picker-paste-preview">
                <div className="replace-compare-pane">
                  <div className="replace-compare-label">Eingefügt</div>
                  {pastedPreviewFailed ? (
                    <div className="picker-paste-unavailable">Vorschau nicht verfügbar — Übernehmen trotzdem möglich</div>
                  ) : (
                    <img
                      key={src}
                      src={src}
                      alt={name}
                      referrerPolicy="no-referrer"
                      className="replace-compare-img"
                      onLoad={e => setPastedDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                      onError={() => setPastedPreviewFailed(true)}
                      onClick={() => setOnlineEnlarged({ src, name })}
                      title="Größer anzeigen"
                    />
                  )}
                  <div className="replace-compare-meta">
                    {dims} · {pastedMetaSource(pasted)}
                    {pasted.kind === 'url' ? ` · ${name}` : ''}
                  </div>
                </div>
              </div>
              {pastedError && <div className="replace-error">{pastedError}</div>}
              <div className="picker-footer">
                <button
                  className="be-btn-secondary"
                  onClick={() => { setPasted(null); setPastedError(null); }}
                  disabled={pastedSaving}
                >
                  Verwerfen
                </button>
                <button
                  className="be-btn-primary"
                  onClick={handlePastedConfirm}
                  disabled={pastedSaving}
                >
                  {pastedSaving ? 'Lade…' : '✓ Übernehmen'}
                </button>
              </div>
            </>
          );
        })() : mode === 'youtube' ? (
          <>
            <div className="picker-online-subfolder">
              {subfolderSelect}
            </div>
            <form
              className="picker-yt-url"
              onSubmit={e => { e.preventDefault(); handleYtUrlPreview(); }}
            >
              <label htmlFor="picker-yt-url-input">URL einfügen:</label>
              <input
                id="picker-yt-url-input"
                type="url"
                className="replace-search-input"
                placeholder="https://www.youtube.com/watch?v=…"
                value={ytUrl}
                onChange={e => { setYtUrl(e.target.value); setYtUrlError(null); }}
                disabled={ytDownloading}
              />
              <button type="submit" className="be-btn-secondary" disabled={ytDownloading || !ytUrl.trim()}>
                Vorschau
              </button>
              {ytUrlError && <span className="picker-yt-url-error" role="alert">{ytUrlError}</span>}
            </form>
            <div className="picker-online-body">
              <YouTubeSearchPanel
                selectedUrl={ytCandidate?.url}
                busyUrl={ytDownloading ? ytCandidate?.url : undefined}
                onSelect={handleYtSelect}
                onSearch={handleYtSearchSubmit}
              />
            </div>
            {ytCandidate && !ytDownloading && (
              <YouTubePreview key={ytCandidate.id} video={ytCandidate} onClose={() => setYtCandidate(null)} />
            )}
            {ytError && <div className="replace-error">{ytError}</div>}
            {ytCandidate && (
              <div className="picker-footer">
                <button
                  className="be-btn-primary"
                  onClick={handleYtConfirm}
                  disabled={ytDownloading}
                >
                  {ytDownloading ? 'Lädt…' : '✓ Herunterladen'}
                </button>
              </div>
            )}
          </>
        ) : mode === 'online' ? (
          <>
            <div className="picker-online-subfolder">
              {subfolderSelect}
              {(renderBox ?? RENDER_BOX_QUIZ) && (
                <ImageSearchFilterToggle
                  checked={hideSmallerResults}
                  onChange={setHideSmallerResults}
                  hiddenCount={onlineHiddenCount}
                />
              )}
            </div>
            <div className="picker-online-body">
              <ImageSearchPanel
                defaultQuery={searchQuery?.trim() ?? ''}
                autoSearch={false}
                renderBox={renderBox ?? RENDER_BOX_QUIZ}
                selectedUrl={onlineCandidate?.url}
                busyUrl={onlineDownloading ? onlineCandidate?.url : undefined}
                onSelect={handleOnlineSelect}
                onSearch={handleOnlineSearchSubmit}
                hideSmallerResults={hideSmallerResults}
                onHideSmallerResultsChange={setHideSmallerResults}
                renderFilterToggle={false}
                onHiddenCountChange={setOnlineHiddenCount}
              />
            </div>
            {onlineCandidate && (() => {
              const previewName = onlineCandidate.title || onlineCandidate.url.split('/').pop() || 'Neues Bild';
              const previewDims = onlineCandidate.width && onlineCandidate.height
                ? `${onlineCandidate.width} × ${onlineCandidate.height}px`
                : '—';
              const previewSource = ONLINE_SOURCE_LABEL[onlineCandidate.source];
              return (
                <div className="replace-compare replace-compare--single">
                  <div className="replace-compare-pane">
                    <div className="replace-compare-label">Vorschau</div>
                    <img
                      src={onlineCandidate.url}
                      alt={previewName}
                      referrerPolicy="no-referrer"
                      className="replace-compare-img"
                      onClick={() => setOnlineEnlarged({ src: onlineCandidate.url, name: previewName })}
                      title="Größer anzeigen"
                    />
                    <div className="replace-compare-meta">
                      {previewDims} · Quelle: {previewSource}
                      {onlineCandidate.title ? ` · ${onlineCandidate.title}` : ''}
                    </div>
                  </div>
                </div>
              );
            })()}
            {onlineError && <div className="replace-error">{onlineError}</div>}
            {onlineCandidate && (
              <div className="picker-footer">
                <button
                  className="be-btn-primary"
                  onClick={handleOnlineConfirm}
                  disabled={onlineDownloading}
                >
                  {onlineDownloading ? 'Lade…' : '✓ Herunterladen'}
                </button>
              </div>
            )}
          </>
        ) : loading ? (
          <div className="be-loading">Lade Assets...</div>
        ) : isImage ? (
          <>
            <div className="picker-folder-section">
              {displayFolders.map(sf => (
                <button key={sf.name} className="picker-folder-item" onClick={() => enterFolder(sf)}>
                  <span className="picker-folder-icon">📁</span>
                  <span className="picker-file-name">{sf.name}</span>
                </button>
              ))}
            </div>
            <div className="picker-image-grid">
              {isEmpty ? (
                <div className="be-empty">Keine Bilder</div>
              ) : (
                displayFiles.map(file => {
                  const url = assetUrl(category, file);
                  const fileName = file.split('/').pop()!;
                  const folderPath = file.includes('/') ? file.split('/').slice(0, -1).join('/') : null;
                  const isDisabled = disabledFilePath === file;
                  return (
                    <button
                      key={file}
                      className={`picker-image-item${isDisabled ? ' picker-item-disabled' : ''}`}
                      onClick={() => !isDisabled && onSelect(url)}
                      disabled={isDisabled}
                      title={isDisabled ? `${file} — Quelle der Zusammenführung` : file}
                    >
                      <div className="picker-thumb-wrap">
                        <img src={coverUrl(url)} alt={file} className="picker-thumbnail" />
                        {folderPath && <span className="picker-thumb-folder">{folderPath}</span>}
                      </div>
                      <span className="picker-file-name">{fileName}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="picker-list">
            {isEmpty ? (
              <div className="be-empty">Keine Dateien</div>
            ) : (
              <>
                {displayFolders.map(sf => (
                  <button key={sf.name} className="picker-audio-item" onClick={() => enterFolder(sf)}>
                    <span className="picker-audio-icon">📁</span>
                    <span className="picker-file-name">{sf.name}</span>
                  </button>
                ))}
                {displayFiles.map(file => {
                  const url = assetUrl(category, file);
                  const fileName = file.split('/').pop()!;
                  const folderPath = file.includes('/') ? file.split('/').slice(0, -1).join('/') : null;
                  if (multiSelect) {
                    const isChecked = selected.has(fileName);
                    return (
                      <button
                        key={file}
                        className={`picker-audio-item${isChecked ? ' picker-selected' : ''}`}
                        onClick={() => {
                          const next = new Set(selected);
                          isChecked ? next.delete(fileName) : next.add(fileName);
                          setSelected(next);
                        }}
                      >
                        <span className="picker-audio-icon">🎵</span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span className="picker-file-name" style={{ flex: 'none' }}>{fileName}</span>
                          {isSearching && folderPath && (
                            <span className="picker-file-folder">{folderPath}</span>
                          )}
                        </span>
                      </button>
                    );
                  }
                  const isDisabled = disabledFilePath === file;
                  return (
                    <button
                      key={file}
                      className={`picker-audio-item${isDisabled ? ' picker-item-disabled' : ''}`}
                      onClick={() => !isDisabled && onSelect(url)}
                      disabled={isDisabled}
                      title={isDisabled ? `${file} — Quelle der Zusammenführung` : undefined}
                    >
                      <span className="picker-audio-icon">🎵</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span className="picker-file-name" style={{ flex: 'none' }}>{fileName}</span>
                        {isSearching && folderPath && (
                          <span className="picker-file-folder">{folderPath}</span>
                        )}
                      </span>
                      <MiniAudioPlayer src={toMediaSrc(url) ?? url} style={{ flexShrink: 0 }} />
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
        {multiSelect && (() => {
          const rateLimitedCount = rateLimitedFiles
            ? [...selected].filter(f => rateLimitedFiles.has(f)).length
            : 0;
          return (
          <div className="picker-footer">
            {rateLimitedCount > 0 && (
              <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'var(--gold-warm)' }}>
                {rateLimitedCount} davon beim letzten Mal rate-limited
              </span>
            )}
            <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))' }}>{selected.size} ausgewählt</span>
            <button
              className="be-btn-primary"
              disabled={selected.size === 0}
              onClick={() => onMultiSelect?.([...selected])}
            >
              Cover laden ({selected.size})
            </button>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Asset Field ───────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string | undefined;
  category: AssetCategory;
  onChange: (value: string | undefined) => void;
  /** When true, hide the Ändern / ✕ buttons and suppress the picker. */
  readOnly?: boolean;
  /**
   * Optional extra content rendered inside the field — next to the Ändern/✕
   * actions when a value is set, and below the empty button otherwise.
   * Used for contextual shortcuts (e.g. "use the cover of the paired audio").
   */
  extras?: ReactNode;
  /** Audio pool scope forwarded to the inner MiniAudioPlayer. Pass distinct scopes
   * for sibling audio fields that point at the same file but should play
   * independently (e.g. question/answer audio). */
  scope?: string;
  /** Trim of this audio field (seconds), forwarded to the inner MiniAudioPlayer so
   * the preview plays the same clip the show does. Pass the values the sibling
   * AudioTrimTimeline gets — the preview honours them while it is collapsed too. */
  audioStart?: number;
  audioEnd?: number;
  audioLoop?: boolean;
  /**
   * Forwarded to <PickerModal> as the low-resolution filter render box for the
   * online image-search mode. Only relevant when `category === 'images'`.
   */
  renderBox?: { w: number; h: number };
  /** Forwarded to <PickerModal>: pre-fills the online image search (question text or answer). */
  searchQuery?: string;
}

function VideoInfo({ src }: { src: string }) {
  const [duration, setDuration] = useState<number | null>(null);

  // Load video metadata (moov atom) eagerly on mount. Browsers cap themselves at ~6
  // concurrent fetches per host, so a long archive list warms its durations in the
  // background over a few seconds. By the time the user scrolls anywhere the number is
  // already there — an earlier IntersectionObserver-gated version caused a visible "…"
  // placeholder flash whenever the user scrolled past a block faster than the fetch
  // could complete.
  useEffect(() => {
    setDuration(null);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const onMeta = () => {
      if (isFinite(video.duration)) setDuration(video.duration);
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.src = src;
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.src = '';
    };
  }, [src]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="video-info">
      <span className="video-info-duration">🎬 {duration !== null ? fmt(duration) : '…'}</span>
    </div>
  );
}

export function AssetField({ label, value, category, onChange, readOnly = false, extras, scope, audioStart, audioEnd, audioLoop, renderBox, searchQuery }: FieldProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const isImage = isImageCategory(category);
  const isVideo = isVideoCategory(category);
  // Encoded ONLY at the DOM boundary — `value` itself stays the raw logical
  // path, because rename/move rewrites config refs by matching raw disk paths.
  // `imageSrc` (via `coverUrl`) already runs `toMediaSrc` internally; encoding
  // a second time turns `%20` into `%2520` and breaks every path containing
  // spaces. It also follows images replaced from a lightbox (cache-bust +
  // extension change), see replacedImages.ts.
  const imageSrc = useImageSrc();
  const displaySrc = imageSrc(value);
  const shownName = value ? resolveReplacedImage(value).path.split('/').pop() : undefined;

  // Images use <AssetImageLightbox>, which handles its own Esc.
  useEffect(() => {
    if (!preview || isImage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPreview(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [preview, isImage]);

  const openPreview = () => setPreview(true);
  const icon = isVideo ? '🎬' : '🎵';

  return (
    <div className="asset-field">
      <span className="be-label">{label}</span>
      {value ? (
        <>
          <div
            className="asset-field-preview"
            role="button"
            tabIndex={0}
            onClick={openPreview}
            onKeyDown={e => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                openPreview();
              }
            }}
            title="Vorschau"
          >
            {isImage ? (
              <img src={displaySrc} alt="" className="asset-field-thumb" />
            ) : isVideo ? null : (
              <MiniAudioPlayer
                src={toMediaSrc(value) ?? value}
                className="asset-field-audio"
                scope={scope}
                start={audioStart}
                end={audioEnd}
                loop={audioLoop}
              />
            )}
            <div className="asset-field-info">
              <span className="asset-field-name">{shownName}</span>
              {isVideo && <VideoInfo src={toMediaSrc(value) ?? value} />}
              {!readOnly && (
                <div className="asset-field-actions">
                  <button
                    className="be-icon-btn"
                    onClick={e => { e.stopPropagation(); setOpen(true); }}
                  >
                    Ändern
                  </button>
                  <button
                    className="be-icon-btn danger"
                    onClick={e => { e.stopPropagation(); onChange(undefined); }}
                  >
                    ✕
                  </button>
                  {extras}
                </div>
              )}
            </div>
          </div>
          {preview && isImage && (
            <AssetImageLightbox
              key={value}
              path={value}
              onClose={() => setPreview(false)}
              onChange={readOnly ? undefined : onChange}
              canUpscale={!readOnly}
              renderBox={renderBox}
              searchQuery={searchQuery}
            />
          )}
          {preview && !isImage && createPortal(
            <div className="modal-overlay" onClick={() => setPreview(false)}>
              <div className="image-lightbox" onClick={e => e.stopPropagation()}>
                <div className="image-lightbox-header">
                  <span className="image-lightbox-name">{icon} {value.split('/').pop()}</span>
                  <button className="be-icon-btn" onClick={() => setPreview(false)}>✕</button>
                </div>
                <div className="image-lightbox-body">
                  {isVideo ? (
                    <video src={toMediaSrc(value) ?? value} controls autoPlay preload="metadata" />
                  ) : (
                    <audio src={toMediaSrc(value) ?? value} controls autoPlay preload="metadata" />
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
        </>
      ) : readOnly ? (
        <div className="asset-field-empty" style={{ opacity: 0.6, cursor: 'default' }}>
          {isImage ? '🖼️' : isVideo ? '🎬' : '🎵'} — keine Auswahl —
        </div>
      ) : (
        <div className="asset-field-empty-row">
          <button className="asset-field-empty" onClick={() => setOpen(true)}>
            {isImage ? '🖼️' : isVideo ? '🎬' : '🎵'} {label} auswählen
          </button>
          {extras}
        </div>
      )}

      {open && !readOnly && createPortal(
        <PickerModal
          category={category}
          onSelect={url => { onChange(url); setOpen(false); }}
          onClose={() => setOpen(false)}
          renderBox={renderBox}
          searchQuery={searchQuery}
        />,
        document.body,
      )}
    </div>
  );
}
