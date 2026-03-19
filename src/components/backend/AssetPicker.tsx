import { useState, useEffect } from 'react';
import type { AssetCategory, AudioGuessSubfolder } from '@/types/config';
import { fetchAssets } from '@/services/backendApi';

const IMAGE_CATEGORIES: AssetCategory[] = ['images', 'image-guess'];
const AUDIO_CATEGORIES: AssetCategory[] = ['audio', 'audio-guess', 'background-music'];

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
  const [subfolders, setSubfolders] = useState<AudioGuessSubfolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchAssets(category)
      .then(data => {
        setFiles(data.files ?? []);
        setSubfolders(data.subfolders ?? []);
      })
      .finally(() => setLoading(false));
  }, [category]);

  const isImage = isImageCategory(category);

  // Flat file list (for non-audio-guess)
  const filteredFiles = files.filter(f => f.toLowerCase().includes(search.toLowerCase()));

  // Flat list for audio-guess (folder/file pairs)
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
            {filteredFiles.length === 0 ? (
              <div className="be-empty">Keine Bilder</div>
            ) : (
              filteredFiles.map(file => {
                const url = assetUrl(category, file);
                return (
                  <button key={file} className="picker-image-item" onClick={() => onSelect(url)} title={file}>
                    <img src={url} alt={file} className="picker-thumbnail" />
                    <span className="picker-file-name">{file}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="picker-list">
            {filteredFiles.length === 0 ? (
              <div className="be-empty">Keine Dateien</div>
            ) : (
              filteredFiles.map(file => {
                const url = assetUrl(category, file);
                return (
                  <button key={file} className="picker-audio-item" onClick={() => onSelect(url)}>
                    <span className="picker-audio-icon">🎵</span>
                    <span className="picker-file-name">{file}</span>
                    <audio src={url} style={{ height: 28, flex: 'none' }} controls onClick={e => e.stopPropagation()} />
                  </button>
                );
              })
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
