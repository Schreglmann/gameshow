import { useEffect, useState } from 'react';
import {
  listReferenceRoots,
  browseReferencePaths,
  type ReferenceRoot,
  type ReferenceBrowseEntry,
} from '../../services/backendApi';

interface Props {
  /** Pre-open at this absolute path if set + browsable (the current NAS path). */
  initialPath?: string;
  onClose: () => void;
  /** Called with the absolute path of the folder the user confirmed. */
  onSelect: (path: string) => void;
}

/**
 * Directory-only file explorer for picking the NAS base path — a lean adaptation of
 * `ReferenceBrowser`. Reuses the same bounded server-side browse endpoints
 * (`/api/backend/assets/videos/reference-roots` + `reference-browse`, macOS roots `/Volumes` + Home)
 * and the shared `picker-*` modal styling. Only folders are shown/navigable; the footer confirms the
 * current folder. See [specs/nas-sync-config.md](../../../specs/nas-sync-config.md).
 */
export default function NasPathBrowser({ initialPath, onClose, onSelect }: Props) {
  const [roots, setRoots] = useState<ReferenceRoot[] | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReferenceBrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listReferenceRoots();
        const reachable = all.filter(r => r.reachable);
        setRoots(reachable);
        // Prefer opening directly at the current path; else auto-open a lone root.
        if (initialPath) {
          navigateTo(initialPath, /* silent */ true);
        } else if (reachable.length === 1) {
          navigateTo(reachable[0]!.path);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function navigateTo(absPath: string, silent = false) {
    setLoading(true);
    setError(null);
    try {
      const data = await browseReferencePaths(absPath);
      setCurrentPath(data.path);
      setParent(data.parent);
      setEntries(data.entries);
    } catch (err) {
      // A silent failure (e.g. the current path is unmounted) just falls back to
      // the root picker instead of surfacing a scary error.
      if (!silent) setError((err as Error).message);
      setCurrentPath(null);
    } finally {
      setLoading(false);
    }
  }

  const breadcrumb = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const dirs = entries.filter(e => e.kind === 'dir');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>NAS-Ordner auswählen</h3>
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{ margin: '0 16px 8px', padding: '6px 10px', fontSize: 'var(--admin-sz-13, 13px)', color: 'var(--error-lighter)', background: 'rgba(var(--error-deep-rgb), 0.1)', borderRadius: 4, whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        {/* Breadcrumb nav */}
        {currentPath && (
          <div className="picker-nav">
            {roots && roots.length > 1 && (
              <button
                className="be-icon-btn"
                onClick={() => { setCurrentPath(null); setEntries([]); setParent(null); }}
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

        {/* Root picker */}
        {!currentPath && (
          <div className="picker-list">
            {!roots ? (
              <div className="be-loading">Lade Quellen…</div>
            ) : roots.length === 0 ? (
              <div className="be-empty">
                Keine erreichbaren Quellen. NAS verbinden oder Pfad manuell eingeben.
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

        {/* Folder entries (directories only — this is a directory picker) */}
        {currentPath && (
          <div className="picker-list">
            {loading ? (
              <div className="be-loading">Lade …</div>
            ) : (
              <>
                {parent && (
                  <button
                    className="picker-audio-item"
                    onClick={() => navigateTo(parent)}
                  >
                    <span className="picker-audio-icon">📁</span>
                    <span className="picker-file-name">.. (Übergeordneter Ordner)</span>
                  </button>
                )}
                {dirs.length === 0 && (
                  <div className="be-empty">Keine Unterordner.</div>
                )}
                {dirs.map(e => (
                  <button
                    key={e.name}
                    className="picker-audio-item"
                    onClick={() => navigateTo(`${currentPath}/${e.name}`)}
                  >
                    <span className="picker-audio-icon">📁</span>
                    <span className="picker-file-name">{e.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {currentPath && (
          <div className="picker-footer">
            <span style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.4, var(--text-fade-floor, 0)))', wordBreak: 'break-all' }}>
              {currentPath}
            </span>
            <button
              className="be-btn-primary"
              onClick={() => onSelect(currentPath)}
            >
              Diesen Ordner verwenden
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
