import { useState, useEffect } from 'react';
import type { AssetCategory, AudioGuessSubfolder } from '@/types/config';
import { fetchAssets, uploadAsset, deleteAsset } from '@/services/backendApi';
import StatusMessage from './StatusMessage';

const CATEGORIES: { id: AssetCategory; label: string; accept: string; isImage: boolean }[] = [
  { id: 'images', label: 'Bilder', accept: 'image/*', isImage: true },
  { id: 'audio', label: 'Audio', accept: 'audio/*', isImage: false },
  { id: 'audio-guess', label: 'Audio-Guess', accept: 'audio/*', isImage: false },
  { id: 'image-guess', label: 'Image-Guess', accept: 'image/*', isImage: true },
  { id: 'background-music', label: 'Hintergrundmusik', accept: 'audio/*', isImage: false },
];

export default function AssetsTab() {
  const [activeCategory, setActiveCategory] = useState<AssetCategory>('images');
  const [files, setFiles] = useState<string[]>([]);
  const [subfolders, setSubfolders] = useState<AudioGuessSubfolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);

  const currentCat = CATEGORIES.find(c => c.id === activeCategory)!;

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAssets(activeCategory);
      setFiles(data.files ?? []);
      setSubfolders(data.subfolders ?? []);
    } catch (e) {
      showMsg('error', `Fehler beim Laden: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleUpload = async (fileList: FileList | null, subfolder?: string) => {
    if (!fileList || fileList.length === 0) return;
    const uploads = Array.from(fileList);
    for (const file of uploads) {
      try {
        await uploadAsset(activeCategory, file, subfolder);
      } catch (e) {
        showMsg('error', `❌ Upload "${file.name}" fehlgeschlagen: ${(e as Error).message}`);
        return;
      }
    }
    showMsg('success', `✅ ${uploads.length} Datei${uploads.length !== 1 ? 'en' : ''} hochgeladen`);
    load();
  };

  const handleDelete = async (filePath: string, label: string) => {
    if (!confirm(`"${label}" wirklich löschen?`)) return;
    try {
      await deleteAsset(activeCategory, filePath);
      showMsg('success', `🗑️ "${label}" gelöscht`);
      load();
    } catch (e) {
      showMsg('error', `❌ Fehler: ${(e as Error).message}`);
    }
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (subfolders.find(s => s.name === name)) return;
    setSubfolders(prev => [...prev, { name, files: [] }]);
    setExpandedFolders(prev => new Set([...prev, name]));
    setNewFolderName('');
    showMsg('success', `Ordner "${name}" vorbereitet — lade eine Datei hoch um ihn zu erstellen`);
  };

  const toggleFolder = (name: string) =>
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Drag-and-drop onto upload zone
  const onDrop = (e: React.DragEvent, subfolder?: string) => {
    e.preventDefault();
    setDragover(false);
    handleUpload(e.dataTransfer.files, subfolder);
  };

  return (
    <div>
      <StatusMessage message={message} />

      {/* Category tabs */}
      <div className="asset-category-tabs">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`asset-category-btn ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading && <div className="be-loading">Lade...</div>}

      {!loading && (
        <>
          {/* Upload zone */}
          {activeCategory !== 'audio-guess' && (
            <div
              className={`upload-zone ${dragover ? 'dragover' : ''}`}
              style={{ marginBottom: 16 }}
              onDragOver={e => { e.preventDefault(); setDragover(true); }}
              onDragLeave={() => setDragover(false)}
              onDrop={e => onDrop(e)}
            >
              <span style={{ fontSize: 24, display: 'block', marginBottom: 6 }}>
                {currentCat.isImage ? '🖼️' : '🎵'}
              </span>
              Dateien hier ablegen oder klicken zum Auswählen
              <input
                type="file"
                accept={currentCat.accept}
                multiple
                onChange={e => handleUpload(e.target.files)}
                onClick={e => { (e.target as HTMLInputElement).value = ''; }}
              />
            </div>
          )}

          {/* Audio-guess: folder view */}
          {activeCategory === 'audio-guess' && (
            <div>
              {/* Create folder */}
              <div className="be-list-row" style={{ marginBottom: 16 }}>
                <input
                  className="be-input"
                  placeholder="Neuer Ordnername (= Antwort im Spiel)"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createFolder()}
                />
                <button className="be-icon-btn" onClick={createFolder}>+ Ordner</button>
              </div>

              {subfolders.length === 0 ? (
                <div className="be-empty">Keine Ordner vorhanden.<br />Erstelle einen Ordner und lade Audio-Dateien hoch.</div>
              ) : (
                subfolders.map(folder => (
                  <div key={folder.name} className="asset-folder">
                    <div className="asset-folder-header" onClick={() => toggleFolder(folder.name)}>
                      <span className={`asset-folder-chevron ${expandedFolders.has(folder.name) ? 'open' : ''}`}>▶</span>
                      <span className="asset-folder-name">{folder.name}</span>
                      <span className="asset-folder-count">{folder.files.length} Datei{folder.files.length !== 1 ? 'en' : ''}</span>
                      <label
                        className="be-icon-btn"
                        style={{ cursor: 'pointer', fontSize: 12 }}
                        onClick={e => e.stopPropagation()}
                      >
                        ↑ Upload
                        <input
                          type="file"
                          accept="audio/*"
                          style={{ display: 'none' }}
                          onChange={e => handleUpload(e.target.files, folder.name)}
                          onClick={e => { (e.target as HTMLInputElement).value = ''; }}
                        />
                      </label>
                      <button
                        className="be-delete-btn"
                        onClick={e => { e.stopPropagation(); handleDelete(folder.name, folder.name); }}
                        title="Ordner löschen"
                      >🗑</button>
                    </div>

                    {expandedFolders.has(folder.name) && (
                      <div className="asset-folder-files">
                        {folder.files.length === 0 ? (
                          <div
                            className={`upload-zone ${dragover ? 'dragover' : ''}`}
                            style={{ margin: 0 }}
                            onDragOver={e => { e.preventDefault(); setDragover(true); }}
                            onDragLeave={() => setDragover(false)}
                            onDrop={e => onDrop(e, folder.name)}
                          >
                            Dateien hier ablegen oder hochladen
                            <input
                              type="file"
                              accept="audio/*"
                              multiple
                              onChange={e => handleUpload(e.target.files, folder.name)}
                              onClick={e => { (e.target as HTMLInputElement).value = ''; }}
                            />
                          </div>
                        ) : (
                          folder.files.map(file => (
                            <div key={file} className="asset-file-item">
                              <span className="asset-file-icon">🎵</span>
                              <span className="asset-file-name">{file}</span>
                              <audio src={`/audio-guess/${folder.name}/${file}`} controls className="asset-file-audio" />
                              <button
                                className="be-delete-btn"
                                onClick={() => handleDelete(`${folder.name}/${file}`, file)}
                                title="Löschen"
                              >🗑</button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Image categories: grid with thumbnails */}
          {currentCat.isImage && activeCategory !== 'audio-guess' && (
            files.length === 0 ? (
              <div className="be-empty">Keine Bilder vorhanden</div>
            ) : (
              <div className="asset-image-grid">
                {files.map(file => (
                  <div key={file} className="asset-image-card" onClick={() => { setPreviewImage(file); setPreviewDims(null); }}>
                    <img src={`/${activeCategory}/${file}`} alt={file} loading="lazy" />
                    <div className="asset-image-card-footer">
                      <span className="asset-image-card-name" title={file}>{file}</span>
                      <button
                        className="be-delete-btn"
                        onClick={e => { e.stopPropagation(); handleDelete(file, file); }}
                        title="Löschen"
                        style={{ width: 24, height: 24, fontSize: 13 }}
                      >🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Audio categories: list with player */}
          {!currentCat.isImage && activeCategory !== 'audio-guess' && (
            files.length === 0 ? (
              <div className="be-empty">Keine Audiodateien vorhanden</div>
            ) : (
              <div className="asset-file-list">
                {files.map(file => (
                  <div key={file} className="asset-file-item">
                    <span className="asset-file-icon">🎵</span>
                    <span className="asset-file-name" title={file}>{file}</span>
                    <audio src={`/${activeCategory}/${file}`} controls className="asset-file-audio" />
                    <button className="be-delete-btn" onClick={() => handleDelete(file, file)} title="Löschen">🗑</button>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Image lightbox */}
      {previewImage && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className="image-lightbox" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">{previewImage}</span>
              {previewDims && (
                <span className="image-lightbox-dims">{previewDims.w} × {previewDims.h}px</span>
              )}
              <button
                className="be-delete-btn"
                onClick={() => { handleDelete(previewImage, previewImage); setPreviewImage(null); }}
                title="Löschen"
              >🗑</button>
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
          </div>
        </div>
      )}
    </div>
  );
}
