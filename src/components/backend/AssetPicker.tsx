import { useState, useEffect } from 'react';
import type { AssetCategory, AssetFolder } from '@/types/config';
import { fetchAssets } from '@/services/backendApi';

const IMAGE_CATEGORIES: AssetCategory[] = ['images'];

/** Recursively collect all file paths from folder tree as relative paths */
function collectFolderFiles(folders: AssetFolder[], prefix = ''): string[] {
  return folders.flatMap(f => {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    return [...f.files.map(file => `${p}/${file}`), ...collectFolderFiles(f.subfolders, p)];
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

/** Build the public URL for an asset given its category and relative path */
function assetUrl(category: AssetCategory, filePath: string): string {
  return `/${category}/${filePath}`;
}

// ── Picker Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  category: AssetCategory;
  onSelect: (url: string) => void;
  onClose: () => void;
}

function PickerModal({ category, onSelect, onClose }: ModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [subfolders, setSubfolders] = useState<AssetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Empty string = root; 'Folder' or 'Folder/Sub' = inside that path
  const [currentPath, setCurrentPath] = useState('');

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
    ? [...files, ...collectFolderFiles(subfolders)]   // root: show everything flat with folder badges
    : (currentNode?.files.map(f => `${currentPath}/${f}`) ?? []);
  const viewSubfolders: AssetFolder[] = currentPath === ''
    ? subfolders
    : (currentNode?.subfolders ?? []);

  const displayFiles = isSearching ? filteredFiles : viewFiles;
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>{category}</h3>
          <input
            className="be-input"
            placeholder="Suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220 }}
            autoFocus
          />
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

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
          <div className="picker-image-grid">
            {isEmpty ? (
              <div className="be-empty">Keine Bilder</div>
            ) : (
              <>
                {displayFolders.map(sf => (
                  <button key={sf.name} className="picker-folder-item" onClick={() => enterFolder(sf)}>
                    <span className="picker-folder-icon">📁</span>
                    <span className="picker-file-name">{sf.name}</span>
                  </button>
                ))}
                {displayFiles.map(file => {
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
                })}
              </>
            )}
          </div>
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
                  return (
                    <button key={file} className="picker-audio-item" onClick={() => onSelect(url)}>
                      <span className="picker-audio-icon">🎵</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span className="picker-file-name" style={{ flex: 'none' }}>{fileName}</span>
                        {isSearching && folderPath && (
                          <span className="picker-file-folder">{folderPath}</span>
                        )}
                      </span>
                      <audio src={url} style={{ height: 28, flex: 'none' }} controls onClick={e => e.stopPropagation()} />
                    </button>
                  );
                })}
              </>
            )}
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

export function AssetField({ label, value, category, onChange }: FieldProps) {
  const [open, setOpen] = useState(false);
  const isImage = isImageCategory(category);

  return (
    <div className="asset-field">
      <span className="be-label">{label}</span>
      {value ? (
        <div className="asset-field-preview">
          {isImage ? (
            <img src={value} alt="" className="asset-field-thumb" />
          ) : (
            <audio src={value} controls className="asset-field-audio" />
          )}
          <div className="asset-field-info">
            <span className="asset-field-name">{value.split('/').pop()}</span>
            <div className="asset-field-actions">
              <button className="be-icon-btn" onClick={() => setOpen(true)}>Ändern</button>
              <button className="be-icon-btn danger" onClick={() => onChange(undefined)}>✕</button>
            </div>
          </div>
        </div>
      ) : (
        <button className="asset-field-empty" onClick={() => setOpen(true)}>
          {isImage ? '🖼️' : '🎵'} {label} auswählen
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
