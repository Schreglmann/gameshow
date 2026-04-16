import { useState, useEffect, useRef } from 'react';
import type { AssetCategory, AssetFolder, AssetFileMeta } from '@/types/config';
import { fetchAssets, uploadAsset, createAssetFolder } from '@/services/backendApi';
import MiniAudioPlayer from './MiniAudioPlayer';
import FolderNamePrompt from './FolderNamePrompt';

const IMAGE_CATEGORIES: AssetCategory[] = ['images'];
const VIDEO_CATEGORIES: AssetCategory[] = ['videos'];

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

type SortField = 'name' | 'date' | 'size' | 'type';

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

function isVideoCategory(cat: AssetCategory) {
  return VIDEO_CATEGORIES.includes(cat);
}

/** Build the public URL for an asset given its category and relative path */
function assetUrl(category: AssetCategory, filePath: string): string {
  return `/${category}/${filePath}`;
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
}

export function PickerModal({ category, onSelect, onClose, multiSelect, onMultiSelect, hiddenBasenames, multiSelectLabel, rateLimitedFiles }: ModalProps) {
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

  useEffect(() => {
    fetchAssets(category)
      .then(data => {
        setFiles(data.files ?? []);
        setFileMeta(data.fileMeta ?? {});
        setSubfolders(data.subfolders ?? []);
      })
      .finally(() => setLoading(false));
  }, [category]);

  const isImage = isImageCategory(category);
  const isSearching = search.trim().length > 0;

  // Merged metadata map: root-level fileMeta + recursive folder metadata (keyed by relative path)
  const allMeta: Record<string, AssetFileMeta> = { ...fileMeta, ...collectFolderMeta(subfolders) };

  // Flat list of all files for search mode
  const allFiles = [...files, ...collectFolderFiles(subfolders)];
  const filteredFiles = allFiles.filter(f => f.toLowerCase().includes(search.toLowerCase()));

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
      for (const file of Array.from(fileList)) {
        const fileName = await uploadAsset(category, file, currentPath || undefined);
        const relativePath = currentPath ? `${currentPath}/${fileName}` : fileName;
        const url = assetUrl(category, relativePath);
        // Select the last uploaded file
        onSelect(url);
        return;
      }
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

  const acceptTypes = isImageCategory(category) ? 'image/*'
    : category === 'videos' ? 'video/*'
    : 'audio/*';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>{multiSelect ? (multiSelectLabel ?? 'Auswählen') : category}</h3>
          <input
            className="be-input"
            placeholder="Suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220 }}
            autoFocus
          />
          {!multiSelect && (
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
              style={{ fontSize: 11 }}
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
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

        {uploadError && (
          <div style={{ margin: '0 16px 8px', padding: '6px 10px', fontSize: 13, color: 'var(--error-lighter)', background: 'rgba(var(--error-deep-rgb), 0.1)', borderRadius: 4 }}>
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

        {!isSearching && currentPath && (
          <div className="picker-nav">
            <button className="be-icon-btn" onClick={goUp}>← Zurück</button>
            <span className="picker-nav-folder">{currentPath}</span>
          </div>
        )}

        {loading ? (
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
                  return (
                    <button key={file} className="picker-image-item" onClick={() => onSelect(url)} title={file}>
                      <div className="picker-thumb-wrap">
                        <img src={url} alt={file} className="picker-thumbnail" />
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
                  return (
                    <button key={file} className="picker-audio-item" onClick={() => onSelect(url)}>
                      <span className="picker-audio-icon">🎵</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span className="picker-file-name" style={{ flex: 'none' }}>{fileName}</span>
                        {isSearching && folderPath && (
                          <span className="picker-file-folder">{folderPath}</span>
                        )}
                      </span>
                      <MiniAudioPlayer src={url} style={{ flexShrink: 0 }} />
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
              <span style={{ fontSize: 12, color: 'var(--gold-warm)' }}>
                {rateLimitedCount} davon beim letzten Mal rate-limited
              </span>
            )}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{selected.size} ausgewählt</span>
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
}

function VideoInfo({ src }: { src: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDuration(null);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const onMeta = () => {
      if (isFinite(video.duration)) setDuration(video.duration);
    };
    video.addEventListener('loadedmetadata', onMeta);

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { video.src = src; observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', onMeta);
      video.src = ''; // release network connection
    };
  }, [src]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div ref={containerRef} className="video-info">
      <span className="video-info-duration">🎬 {duration !== null ? fmt(duration) : '...'}</span>
    </div>
  );
}

export function AssetField({ label, value, category, onChange }: FieldProps) {
  const [open, setOpen] = useState(false);
  const isImage = isImageCategory(category);
  const isVideo = isVideoCategory(category);

  return (
    <div className="asset-field">
      <span className="be-label">{label}</span>
      {value ? (
        <div className="asset-field-preview">
          {isImage ? (
            <img src={value} alt="" className="asset-field-thumb" />
          ) : isVideo ? null : (
            <MiniAudioPlayer src={value} className="asset-field-audio" />
          )}
          <div className="asset-field-info">
            <span className="asset-field-name">{value.split('/').pop()}</span>
            {isVideo && <VideoInfo src={value} />}
            <div className="asset-field-actions">
              <button className="be-icon-btn" onClick={() => setOpen(true)}>Ändern</button>
              <button className="be-icon-btn danger" onClick={() => onChange(undefined)}>✕</button>
            </div>
          </div>
        </div>
      ) : (
        <button className="asset-field-empty" onClick={() => setOpen(true)}>
          {isImage ? '🖼️' : isVideo ? '🎬' : '🎵'} {label} auswählen
        </button>
      )}

      {open && (
        <PickerModal
          category={category}
          onSelect={url => { onChange(url); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
