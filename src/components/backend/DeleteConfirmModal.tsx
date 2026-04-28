import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetCategory } from '../../types/config';
import { fetchAssetUsages } from '../../services/backendApi';

export interface DeleteFileItem {
  path: string;
  kind: 'file';
  size?: number;
}

export interface DeleteFolderItem {
  path: string;
  kind: 'folder';
  fileCount: number;
  subfolderCount: number;
  totalBytes: number;
  sample: string[];
}

export type DeleteItem = DeleteFileItem | DeleteFolderItem;

interface UsageInfo {
  count: number;
  titles: string[];
}

interface Props {
  category: AssetCategory;
  items: DeleteItem[];
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

// Per-file usage probes can be slow and hammer the server. Cap how many we attempt.
const MAX_USAGE_PROBES = 50;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIcon(category: AssetCategory): string {
  if (category === 'audio' || category === 'background-music') return '🎵';
  if (category === 'videos') return '🎬';
  return '🖼';
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export default function DeleteConfirmModal({ category, items, onConfirm, onCancel, busy }: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const [usages, setUsages] = useState<Record<string, UsageInfo>>({});
  const [usageProbesSkipped, setUsageProbesSkipped] = useState(false);
  const [usageProbesDone, setUsageProbesDone] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const files = useMemo(() => items.filter((i): i is DeleteFileItem => i.kind === 'file'), [items]);
  const folders = useMemo(() => items.filter((i): i is DeleteFolderItem => i.kind === 'folder'), [items]);

  const totals = useMemo(() => {
    const fileBytes = files.reduce((s, f) => s + (f.size ?? 0), 0);
    const folderBytes = folders.reduce((s, f) => s + f.totalBytes, 0);
    const folderFiles = folders.reduce((s, f) => s + f.fileCount, 0);
    return {
      fileCount: files.length,
      folderCount: folders.length,
      totalBytes: fileBytes + folderBytes,
      totalFilesIncludingFolders: files.length + folderFiles,
    };
  }, [files, folders]);

  // Probe usages for plain file items (not files inside folders — that would require a
  // recursive probe and bloat the dialog). Skip entirely above MAX_USAGE_PROBES.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (files.length === 0) { setUsageProbesDone(true); return; }
      if (files.length > MAX_USAGE_PROBES) {
        setUsageProbesSkipped(true);
        setUsageProbesDone(true);
        return;
      }
      const results = await Promise.all(
        files.map(f => fetchAssetUsages(category, f.path).catch(() => [])),
      );
      if (cancelled) return;
      const next: Record<string, UsageInfo> = {};
      results.forEach((games, idx) => {
        if (games.length > 0) {
          next[files[idx].path] = {
            count: games.length,
            titles: games.map(g => g.instance ? `${g.title} (${g.instance})` : g.title),
          };
        }
      });
      setUsages(next);
      setUsageProbesDone(true);
    })();
    return () => { cancelled = true; };
  }, [files, category]);

  const hasUsedFiles = Object.keys(usages).length > 0;
  const requiresAck = hasUsedFiles || usageProbesSkipped;
  const confirmDisabled = busy || !usageProbesDone || (requiresAck && !acknowledged);

  useEffect(() => {
    if (!confirmDisabled) confirmBtnRef.current?.focus();
  }, [confirmDisabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !confirmDisabled) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, confirmDisabled, onCancel, onConfirm]);

  const confirmLabel = busy
    ? 'Lösche …'
    : totals.folderCount > 0 && totals.fileCount > 0
      ? `${totals.fileCount} Datei${totals.fileCount !== 1 ? 'en' : ''} + ${totals.folderCount} Ordner löschen`
      : totals.folderCount > 0
        ? `${totals.folderCount} Ordner löschen`
        : totals.fileCount === 1
          ? 'Löschen'
          : `${totals.fileCount} Dateien löschen`;

  return (
    <div className="modal-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-box delete-confirm-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="delete-confirm-title">Löschen bestätigen</h3>
        <p className="delete-confirm-subtitle">
          Folgende Elemente werden gelöscht{' '}
          <span className="delete-confirm-total">
            ({totals.totalFilesIncludingFolders} Datei{totals.totalFilesIncludingFolders !== 1 ? 'en' : ''} · {formatBytes(totals.totalBytes)})
          </span>
          :
        </p>

        <ul className="delete-confirm-list">
          {folders.map(f => (
            <li key={f.path} className="delete-confirm-item delete-confirm-folder">
              <div className="delete-confirm-item-row">
                <span className="delete-confirm-icon" aria-hidden>📁</span>
                <span className="delete-confirm-name" title={f.path}>{basename(f.path)}/</span>
                <span className="delete-confirm-meta">
                  {f.fileCount === 0 && f.subfolderCount === 0
                    ? 'leer'
                    : (
                      <>
                        {f.fileCount > 0 && `${f.fileCount} Datei${f.fileCount !== 1 ? 'en' : ''}`}
                        {f.fileCount > 0 && f.subfolderCount > 0 && ' · '}
                        {f.subfolderCount > 0 && `${f.subfolderCount} Unterordner`}
                        {f.totalBytes > 0 && ` · ${formatBytes(f.totalBytes)}`}
                      </>
                    )}
                </span>
              </div>
              {f.sample.length > 0 && (
                <div className="delete-confirm-sample">
                  → {f.sample.join(', ')}
                  {f.fileCount > f.sample.length && ` … (+${f.fileCount - f.sample.length})`}
                </div>
              )}
            </li>
          ))}
          {files.map(f => {
            const u = usages[f.path];
            return (
              <li key={f.path} className="delete-confirm-item delete-confirm-file">
                <div className="delete-confirm-item-row">
                  <span className="delete-confirm-icon" aria-hidden>{fileIcon(category)}</span>
                  <span className="delete-confirm-name" title={f.path}>{basename(f.path)}</span>
                  {f.size != null && <span className="delete-confirm-meta">{formatBytes(f.size)}</span>}
                </div>
                {u && (
                  <div className="delete-confirm-usage" title={u.titles.join('\n')}>
                    ⚠ Wird in {u.count} Spiel{u.count !== 1 ? 'en' : ''} verwendet
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {usageProbesSkipped && (
          <div className="delete-confirm-note">
            ℹ Nutzungsprüfung übersprungen — sehr viele Dateien ausgewählt.
          </div>
        )}
        {folders.length > 0 && (
          <div className="delete-confirm-note delete-confirm-note-muted">
            ℹ Dateien innerhalb von Ordnern werden nicht auf Spiel-Verwendung geprüft.
          </div>
        )}

        {requiresAck && (
          <label className="delete-confirm-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              disabled={busy}
            />
            <span>Ich weiß, dass die betroffenen Spiele dadurch kaputtgehen können.</span>
          </label>
        )}

        <div className="delete-confirm-actions">
          <button className="be-icon-btn" onClick={onCancel} disabled={busy}>Abbrechen</button>
          <button
            ref={confirmBtnRef}
            className="be-icon-btn delete-confirm-submit"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
