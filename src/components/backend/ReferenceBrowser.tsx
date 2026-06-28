import { useEffect, useMemo, useRef, useState } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import {
  listReferenceRoots,
  browseReferencePaths,
  addVideoReference,
  fetchAssets,
  type ReferenceRoot,
  type ReferenceBrowseEntry,
} from '../../services/backendApi';
import type { AssetFileMeta, AssetFolder } from '@/types/config';

interface Props {
  /** Subfolder pre-selected from the current DAM view. Empty string = top-level. */
  initialSubfolder: string;
  /** Known folder paths (relative to local-assets/videos/) the user can target. */
  availableSubfolders: string[];
  onClose: () => void;
  /** Called after a batch finishes with every successfully-added reference.
   *  The modal closes itself on a fully successful batch; on partial failure it
   *  stays open showing the errors, but already-added files are still reported. */
  onAdded: (added: { relPath: string; fileName: string }[]) => void;
}

function formatBytes(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Walk the videos asset tree and collect every reference's absolute source path.
 *  Used to grey out entries in the browser that already exist as a reference. */
function collectKnownSourcePaths(
  fileMeta: Record<string, AssetFileMeta> | undefined,
  subfolders: AssetFolder[] | undefined,
  out: Set<string>,
): void {
  for (const meta of Object.values(fileMeta ?? {})) {
    if (meta.reference?.sourcePath) out.add(meta.reference.sourcePath);
  }
  for (const sf of subfolders ?? []) {
    collectKnownSourcePaths(sf.fileMeta, sf.subfolders, out);
  }
}

export default function ReferenceBrowser({ initialSubfolder, availableSubfolders, onClose, onAdded }: Props) {
  const [subfolder, setSubfolder] = useState(initialSubfolder);
  const [roots, setRoots] = useState<ReferenceRoot[] | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReferenceBrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Selection spans folders: keyed by absolute source path so the user can
  // browse into several directories and accumulate picks before confirming.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [knownSources, setKnownSources] = useState<Set<string>>(() => new Set());
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listReferenceRoots();
        // Hide unreachable roots entirely (mostly noise on macOS: /mnt + /media
        // are never connected). If exactly one reachable root remains, skip the
        // picker and open it directly.
        const reachable = all.filter(r => r.reachable);
        setRoots(reachable);
        if (reachable.length === 1) {
          navigateTo(reachable[0]!.path);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    // Fetch the current videos listing once so we can grey out files that are
    // already registered as references.
    (async () => {
      try {
        const data = await fetchAssets('videos');
        const sources = new Set<string>();
        collectKnownSourcePaths(data.fileMeta, data.subfolders, sources);
        setKnownSources(sources);
      } catch { /* non-critical */ }
    })();
  }, []);

  async function navigateTo(absPath: string) {
    setLoading(true);
    setError(null);
    setFilter('');
    try {
      const data = await browseReferencePaths(absPath);
      setCurrentPath(data.path);
      setParent(data.parent);
      setEntries(data.entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Re-focus the search input each time a new folder finishes loading.
  // Skipped on touch devices so the on-screen keyboard doesn't pop up.
  useEffect(() => {
    if (currentPath && !loading && !isTouchDevice()) filterRef.current?.focus();
  }, [currentPath, loading]);

  function toggleSelected(sourcePath: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sourcePath)) next.delete(sourcePath);
      else next.add(sourcePath);
      return next;
    });
  }

  async function handleAddBatch() {
    const items = [...selected];
    if (items.length === 0 || adding) return;
    setAdding(true);
    setError(null);
    setAddProgress({ done: 0, total: items.length });
    const added: { relPath: string; fileName: string }[] = [];
    const errors: string[] = [];
    const addedSources = new Set<string>();
    for (const sourcePath of items) {
      try {
        const result = await addVideoReference(sourcePath, {
          subfolder: subfolder || undefined,
        });
        added.push({ relPath: result.relPath, fileName: result.fileName });
        addedSources.add(sourcePath);
      } catch (err) {
        errors.push(`${sourcePath.split('/').pop()}: ${(err as Error).message}`);
      }
      setAddProgress(p => (p ? { ...p, done: p.done + 1 } : p));
    }
    setAdding(false);
    setAddProgress(null);
    // Mark the just-added sources as known so their rows grey out, and drop
    // them from the pending selection.
    if (addedSources.size > 0) {
      setKnownSources(prev => new Set([...prev, ...addedSources]));
      setSelected(prev => new Set([...prev].filter(s => !addedSources.has(s))));
    }
    if (added.length > 0) onAdded(added);
    if (errors.length === 0) {
      onClose();
    } else {
      setError(errors.join('\n'));
    }
  }

  const breadcrumb = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const filteredEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.name.toLowerCase().includes(q));
  }, [entries, filter]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>Videoquelle auswählen</h3>
          <input
            ref={filterRef}
            className="be-input"
            placeholder={currentPath ? 'Im aktuellen Ordner suchen…' : 'Suchen…'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: 220 }}
            autoFocus={!isTouchDevice()}
            disabled={!currentPath}
          />
          {availableSubfolders.length > 0 && (
            <select
              className="be-input"
              value={subfolder}
              onChange={e => setSubfolder(e.target.value)}
              title="DAM-Ordner, in dem die Referenz angelegt wird"
              style={{ width: 180 }}
            >
              <option value="">/videos/ (Wurzel)</option>
              {availableSubfolders.map(sf => (
                <option key={sf} value={sf}>/videos/{sf}/</option>
              ))}
            </select>
          )}
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{ margin: '0 16px 8px', padding: '6px 10px', fontSize: 'var(--admin-sz-13, 13px)', color: 'var(--error-lighter)', background: 'rgba(var(--error-deep-rgb), 0.1)', borderRadius: 4, whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        {/* Breadcrumb nav — reuses picker-nav styling. Hide "← Quellen" when
             there's only a single root (we auto-opened it), since there's nowhere
             meaningful to go back to. */}
        {currentPath && (
          <div className="picker-nav">
            {roots && roots.length > 1 && (
              <button
                className="be-icon-btn"
                onClick={() => { setCurrentPath(null); setEntries([]); setParent(null); setFilter(''); }}
              >
                ← Quellen
              </button>
            )}
            <span className="picker-nav-folder">
              {breadcrumb.map((seg, i) => {
                const segPath = '/' + breadcrumb.slice(0, i + 1).join('/');
                const isLast = i === breadcrumb.length - 1;
                return (
                  <span key={segPath}>
                    {i > 0 && ' / '}
                    {isLast
                      ? <strong>{seg}</strong>
                      : <a
                          href="#"
                          onClick={ev => { ev.preventDefault(); navigateTo(segPath); }}
                          style={{ color: 'inherit' }}
                        >{seg}</a>}
                  </span>
                );
              })}
            </span>
          </div>
        )}

        {/* Root picker (only shown when >1 reachable root exists) */}
        {!currentPath && (
          <div className="picker-list">
            {!roots ? (
              <div className="be-loading">Lade Quellen…</div>
            ) : roots.length === 0 ? (
              <div className="be-empty">
                Keine erreichbaren Quellen. Externe Laufwerke verbinden oder
                <code style={{ marginLeft: 4 }}>GAMESHOW_REFERENCE_ROOTS</code> setzen.
              </div>
            ) : (
              roots.map(r => (
                <button
                  key={r.path}
                  className="picker-audio-item"
                  onClick={() => navigateTo(r.path)}
                  title={r.label ? `${r.label} (${r.path})` : r.path}
                >
                  <span className="picker-audio-icon">{r.label === 'Home' ? '🏠' : '💾'}</span>
                  <span className="picker-file-name">
                    {r.label ? <><strong>{r.label}</strong> <span style={{ opacity: 0.5, fontSize: 11 }}>{r.path}</span></> : r.path}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Directory entries */}
        {currentPath && (
          <div className="picker-list">
            {loading ? (
              <div className="be-loading">Lade …</div>
            ) : (
              <>
                {parent && !filter && (
                  <button
                    className="picker-audio-item"
                    onClick={() => navigateTo(parent)}
                  >
                    <span className="picker-audio-icon">📁</span>
                    <span className="picker-file-name">.. (Übergeordneter Ordner)</span>
                  </button>
                )}
                {filteredEntries.length === 0 && (
                  <div className="be-empty">
                    {filter ? 'Keine Treffer.' : 'Keine Ordner oder Videos.'}
                  </div>
                )}
                {filteredEntries.map(e => {
                  if (e.kind === 'dir') {
                    return (
                      <button
                        key={e.name}
                        className="picker-audio-item"
                        onClick={() => navigateTo(`${currentPath}/${e.name}`)}
                      >
                        <span className="picker-audio-icon">📁</span>
                        <span className="picker-file-name">{e.name}</span>
                      </button>
                    );
                  }
                  const sourcePath = `${currentPath}/${e.name}`;
                  const alreadyReferenced = knownSources.has(sourcePath);
                  const isChecked = selected.has(sourcePath);
                  return (
                    <button
                      key={e.name}
                      className={`picker-audio-item${alreadyReferenced ? ' picker-item-disabled' : ''}${isChecked ? ' picker-selected' : ''}`}
                      onClick={() => !alreadyReferenced && !adding && toggleSelected(sourcePath)}
                      disabled={alreadyReferenced || adding}
                      title={alreadyReferenced ? `${e.name} — ist bereits als Referenz in der DAM` : e.name}
                    >
                      <span className="picker-audio-icon">{alreadyReferenced ? '🎬' : isChecked ? '☑️' : '🎬'}</span>
                      <span className="picker-file-name">{e.name}</span>
                      {e.size != null && (
                        <span style={{ fontSize: 11, opacity: 0.65, flexShrink: 0 }}>{formatBytes(e.size)}</span>
                      )}
                      <span style={{ fontSize: 11, flexShrink: 0, opacity: alreadyReferenced ? 0.7 : 0.9 }}>
                        {alreadyReferenced ? 'Bereits vorhanden' : isChecked ? 'Ausgewählt' : 'Auswählen'}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {(selected.size > 0 || adding) && (
          <div className="picker-footer">
            <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))' }}>
              {adding && addProgress
                ? `Füge hinzu … ${addProgress.done}/${addProgress.total}`
                : `${selected.size} ausgewählt`}
            </span>
            {!adding && selected.size > 0 && (
              <button
                type="button"
                className="be-icon-btn"
                onClick={() => setSelected(new Set())}
                title="Auswahl aufheben"
              >
                Auswahl löschen
              </button>
            )}
            <button
              className="be-btn-primary"
              disabled={selected.size === 0 || adding}
              onClick={handleAddBatch}
            >
              {adding ? '…' : `Hinzufügen (${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
