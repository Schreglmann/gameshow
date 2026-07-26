import { useMemo, useState } from 'react';
import { useConfirm } from './ConfirmContext';
import type { NasSyncConflictEntry, NasSyncResolution } from '@/services/backendApi';

/**
 * "NAS-Sync-Konflikte" card for the admin System tab — lists the deletions the
 * sync safety layers refused (Layer 2 loss-ratio veto + Layer 3 bulk-cap abort)
 * and lets the operator resolve each one (or a whole folder-group) by restoring
 * the surviving copy or confirming the deletion. See specs/nas-sync-conflicts.md.
 *
 * Data + resolve wiring is owned by the parent (SystemTab); this component is
 * pure UI so it can also be exercised in the theme showcase and unit tests.
 */

interface Props {
  conflicts: NasSyncConflictEntry[];
  nasReachable: boolean;
  /** Resolve a batch. Should refetch the list once it settles. */
  onResolve: (rels: string[], resolution: NasSyncResolution) => Promise<void>;
}

interface Group {
  key: string;
  folder: string;
  action: NasSyncConflictEntry['action'];
  reason: NasSyncConflictEntry['reason'];
  lossRatio?: number;
  entries: NasSyncConflictEntry[];
}

/**
 * "N Datei(en) fehlt/fehlen auf NAS/lokal" — delete-local → present locally, gone on
 * NAS; delete-nas → present on NAS, gone locally. Handles German singular/plural.
 */
function missingLabel(count: number, action: NasSyncConflictEntry['action']): string {
  const noun = count === 1 ? 'Datei' : 'Dateien';
  const verb = count === 1 ? 'fehlt' : 'fehlen';
  const where = action === 'delete-local' ? 'auf NAS' : 'lokal';
  return `${count} ${noun} ${verb} ${where}`;
}

function reasonLabel(reason: NasSyncConflictEntry['reason']): string {
  return reason === 'loss-ratio-veto' ? 'Verlust-Schwelle' : 'Massenlöschung blockiert';
}

function groupConflicts(conflicts: NasSyncConflictEntry[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of conflicts) {
    const key = `${c.folder}|${c.reason}|${c.action}`;
    let g = map.get(key);
    if (!g) {
      g = { key, folder: c.folder, action: c.action, reason: c.reason, lossRatio: c.lossRatio, entries: [] };
      map.set(key, g);
    }
    g.entries.push(c);
  }
  return Array.from(map.values()).sort((a, b) => a.folder.localeCompare(b.folder) || a.key.localeCompare(b.key));
}

export default function NasSyncConflictsCard({ conflicts, nasReachable, onResolve }: Props) {
  const confirmDialog = useConfirm();
  const groups = useMemo(() => groupConflicts(conflicts), [conflicts]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  async function run(scopeKey: string, rels: string[], resolution: NasSyncResolution, confirmTitle?: string) {
    if (!nasReachable || rels.length === 0) return;
    if (confirmTitle) {
      const ok = await confirmDialog({
        title: confirmTitle,
        description: 'Die Datei wird in den Papierkorb (.trash/) verschoben und ist 30 Tage wiederherstellbar.',
        confirmLabel: 'Löschen',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    setBusy(prev => new Set(prev).add(scopeKey));
    try {
      await onResolve(rels, resolution);
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(scopeKey); return next; });
    }
  }

  const labelStyle = { fontSize: 'var(--admin-sz-11, 11px)' };

  return (
    <div className="backend-card">
      <h3>NAS-Sync-Konflikte</h3>

      {groups.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.6, var(--text-fade-floor, 0)))' }}>
          <span style={{ color: 'var(--success)' }}>✓</span> Keine Konflikte
        </div>
      ) : (
        <>
          <p style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', margin: '0 0 10px', lineHeight: 1.5 }}>
            Löschungen, die die Sicherheitsprüfung <strong>nicht ausgeführt</strong> hat, weil auf einer Seite zu viele
            Dateien auf einmal verschwunden sind (meist ein NAS-Mount-Fehler). <em>Wiederherstellen</em> kopiert die noch
            vorhandene Datei zurück; <em>Löschen</em> übernimmt die Löschung (Papierkorb, 30 Tage wiederherstellbar).
          </p>
          {!nasReachable && (
            <p style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'var(--gold-warm)', margin: '0 0 10px' }}>
              NAS nicht erreichbar — Konflikte können erst nach erneuter Verbindung aufgelöst werden.
            </p>
          )}

          {groups.map(group => {
            const isBusy = busy.has(group.key);
            const isOpen = expanded.has(group.key);
            const rels = group.entries.map(e => e.rel);
            const lossText = group.reason === 'loss-ratio-veto' && group.lossRatio !== undefined
              ? ` · ${(group.lossRatio * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % Verlust`
              : ` · ${reasonLabel(group.reason)}`;
            return (
              <div key={group.key} style={{ padding: '8px 0', borderBottom: '1px solid rgba(var(--text-rgb),0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={{
                      ...labelStyle,
                      flex: '1 1 220px',
                      minWidth: 160,
                      textAlign: 'left',
                      whiteSpace: 'normal',
                      lineHeight: 1.4,
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(var(--text-rgb),0.85)',
                      cursor: 'pointer',
                      padding: '2px 0',
                      fontFamily: 'inherit',
                    }}
                    onClick={() => toggle(group.key)}
                    aria-expanded={isOpen}
                  >
                    <span style={{ marginRight: 6 }}>{isOpen ? '▾' : '▸'}</span>
                    <strong>{group.folder}/</strong> · {missingLabel(group.entries.length, group.action)}{lossText}
                  </button>
                  <button
                    className="be-btn-primary"
                    style={labelStyle}
                    disabled={isBusy || !nasReachable}
                    onClick={() => run(group.key, rels, 'restore')}
                  >{isBusy ? '⏳' : '↻'} Alle wiederherstellen</button>
                  <button
                    className="be-icon-btn danger"
                    style={labelStyle}
                    disabled={isBusy || !nasReachable}
                    onClick={() => run(group.key, rels, 'delete', `${group.entries.length} ${group.entries.length === 1 ? 'Datei' : 'Dateien'} endgültig löschen?`)}
                  >🗑 Alle löschen</button>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 6, paddingLeft: 18 }}>
                    {group.entries.map(entry => {
                      const rowKey = `${group.key}::${entry.rel}`;
                      const rowBusy = busy.has(rowKey);
                      const shortRel = entry.rel.startsWith(`${group.folder}/`) ? entry.rel.slice(group.folder.length + 1) : entry.rel;
                      return (
                        <div key={entry.rel} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' }}>
                          <span style={{ flex: '1 1 200px', minWidth: 160, fontSize: 'var(--admin-sz-11, 11px)', fontFamily: 'monospace', wordBreak: 'break-all', color: 'rgba(var(--text-rgb),0.8)' }}>{shortRel}</span>
                          <button
                            className="be-icon-btn"
                            style={labelStyle}
                            disabled={rowBusy || !nasReachable}
                            onClick={() => run(rowKey, [entry.rel], 'restore')}
                          >{rowBusy ? '⏳' : '↻'}</button>
                          <button
                            className="be-icon-btn danger"
                            style={labelStyle}
                            disabled={rowBusy || !nasReachable}
                            onClick={() => run(rowKey, [entry.rel], 'delete', 'Datei endgültig löschen?')}
                          >🗑</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
