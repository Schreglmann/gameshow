import { useState, useEffect, useRef } from 'react';
import type { AssetCategory, AssetFolder } from '@/types/config';
import { fetchAssets, uploadAsset, createAssetFolder } from '@/services/backendApi';
import MiniAudioPlayer from './MiniAudioPlayer';

const IMAGE_CATEGORIES: AssetCategory[] = ['images'];
const VIDEO_CATEGORIES: AssetCategory[] = ['videos'];

/** Recursively collect all file paths from folder tree as relative paths */
function collectFolderFiles(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [...f.files.map(file => `${p}/${file}`), ...collectFolderFiles(f.subfolders ?? [], p)];
  });
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
}

export function PickerModal({ category, onSelect, onClose, multiSelect, onMultiSelect, hiddenBasenames, multiSelectLabel }: ModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [subfolders, setSubfolders] = useState<AssetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Empty string = root; 'Folder' or 'Folder/Sub' = inside that path
  const [currentPath, setCurrentPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAssets(category)
      .then(data => {
        setFiles(data.files ?? []);
        setSubfolders(data.subfolders ?? []);
      })
      .finally(() => setLoading(false));
  }, [category]);

  const isImage = isImageCategory(category);
  const isSearching = search.trim().length > 0;

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
  // In multi-select mode, hide files whose basename (without ext) is in hiddenBasenames
  const displayFiles = hiddenBasenames
    ? rawDisplayFiles.filter(f => {
        const basename = f.split('/').pop()!.replace(/\.[^.]+$/, '');
        return !hiddenBasenames.has(basename);
      })
    : rawDisplayFiles;
  const displayFolders = isSearching ? [] : viewSubfolders;
  const isEmpty = displayFiles.length === 0 && displayFolders.length === 0;

  const enterFolder = (sf: AssetFolder) =>
    setCurrentPath(currentPath ? `${currentPath}/${sf.name}` : sf.name);

  const goUp = () =>
    setCurrentPath(pathSegments.slice(0, -1).join('/'));

  // Flat list for audio-guess (folder/file pairs with " / " separator label)
  const audioGuessFiles: { label: string; url: string }[] = subfolders.flatMap(sf =>
    sf.files.map(file => ({
      label: `${sf.name} / ${file}`,
      url: assetUrl(category, `${sf.name}/${file}`),
    }))
  ).filter(f => f.label.toLowerCase().includes(search.toLowerCase()));

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

  const handleCreateFolder = async () => {
    const name = newFolderName?.trim();
    if (!name) return;
    setUploadError('');
    try {
      const folderPath = currentPath ? `${currentPath}/${name}` : name;
      await createAssetFolder(category, folderPath);
      // Refresh the asset list and enter the new folder
      const data = await fetchAssets(category);
      setFiles(data.files ?? []);
      setSubfolders(data.subfolders ?? []);
      setNewFolderName(null);
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
                onClick={() => setNewFolderName(newFolderName === null ? '' : null)}
              >
                📁+
              </button>
            </>
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
              {selected.size === displayFiles.length && displayFiles.length > 0 ? 'Keine' : 'Alle'}
            </button>
          )}
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

        {uploadError && (
          <div style={{ margin: '0 16px 8px', padding: '6px 10px', fontSize: 13, color: '#fca5a5', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 4 }}>
            {uploadError}
          </div>
        )}

        {newFolderName !== null && (
          <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px', alignItems: 'center' }}>
            <input
              className="be-input"
              placeholder="Ordnername…"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setNewFolderName(null); }}
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="be-icon-btn" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Erstellen</button>
            <button className="be-icon-btn" onClick={() => setNewFolderName(null)}>✕</button>
          </div>
        )}

        {!isSearching && currentPath && (
          <div className="picker-nav">
            <button className="be-icon-btn" onClick={goUp}>← Zurück</button>
            <span className="picker-nav-folder">{currentPath}</span>
          </div>
        )}

        {loading ? (
          <div className="be-loading">Lade Assets...</div>
        ) : category === 'audio-guess' ? (
          <div className="picker-list">
            {audioGuessFiles.length === 0 ? (
              <div className="be-empty">Keine Dateien</div>
            ) : (
              audioGuessFiles.map(f => (
                <button key={f.url} className="picker-audio-item" onClick={() => onSelect(f.url)}>
                  <span className="picker-audio-icon">🎵</span>
                  <span className="picker-file-name">{f.label}</span>
                </button>
              ))
            )}
          </div>
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
        {multiSelect && (
          <div className="picker-footer">
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{selected.size} ausgewählt</span>
            <button
              className="be-btn-primary"
              disabled={selected.size === 0}
              onClick={() => onMultiSelect?.([...selected])}
            >
              Cover laden ({selected.size})
            </button>
          </div>
        )}
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
