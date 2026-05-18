import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { AssetCategory } from '@/types/config';
import {
  listTrash,
  listTrashAll,
  listTrashChildren,
  restoreTrash,
  purgeTrash,
  trashStreamUrl,
  type TrashBatch,
  type TrashDeepEntry,
  type TrashEntry,
  type TrashMediaType,
} from '@/services/backendApi';
import { matchesSearch } from './AssetPicker';
import { useWsChannel } from '@/services/useBackendSocket';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  images: 'Bilder',
  audio: 'Audio',
  'background-music': 'Hintergrundmusik',
  videos: 'Videos',
};

function fmtFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
}

// German relative-time labels used by both the "gelöscht vor …" and "läuft ab in …"
// columns. Hour granularity until under an hour, then minutes, then seconds.
function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return `vor ${d} Tag${d === 1 ? '' : 'en'}`;
}

function fmtRemaining(ms: number): string {
  if (ms <= 60_000) return 'läuft jeden Moment ab';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `läuft in ${m} Min. ab`;
  const h = Math.round(m / 60);
  return `läuft in ${h} Std. ab`;
}

interface SelectionKey { batchId: string; originalPath: string; }
function keyOf(k: SelectionKey): string { return `${k.batchId} ${k.originalPath}`; }
function parseKey(k: string): SelectionKey {
  const idx = k.indexOf(' ');
  return { batchId: k.slice(0, idx), originalPath: k.slice(idx + 1) };
}

// In-memory representation of the trash arranged by original folder structure,
// mirroring the main DAM's file browser. Every path segment becomes a TreeNode:
// nodes whose `realEntries` is empty are "synthetic" (just path organizers, no
// actions); nodes with one or more `realEntries` are actual trash entries that
// can be restored or permanently deleted (one row per entry — usually exactly
// one, occasionally more if the same path was trashed across multiple batches).
// `latestDeletion` is the max `batch.createdAt` across this subtree (0 if none)
// — backs the "Datum" sort so synthetic folders bubble up the most recent
// deletion within them.
type TreeNode = {
  name: string;
  path: string;
  realEntries: Array<{ batch: TrashBatch; entry: TrashEntry }>;
  children: Map<string, TreeNode>;
  descendantCount: number;
  latestDeletion: number;
};

function buildTree(batches: TrashBatch[]): TreeNode {
  const root: TreeNode = { name: '', path: '', realEntries: [], children: new Map(), descendantCount: 0, latestDeletion: 0 };
  for (const batch of batches) {
    for (const entry of batch.entries) {
      const segs = entry.originalPath.split('/').filter(Boolean);
      if (segs.length === 0) continue;
      let cur = root;
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        acc = acc ? `${acc}/${seg}` : seg;
        let child = cur.children.get(seg);
        if (!child) {
          child = { name: seg, path: acc, realEntries: [], children: new Map(), descendantCount: 0, latestDeletion: 0 };
          cur.children.set(seg, child);
        }
        if (i === segs.length - 1) child.realEntries.push({ batch, entry });
        cur = child;
      }
    }
  }
  const visit = (n: TreeNode): { count: number; latest: number } => {
    let count = n.realEntries.length;
    let latest = 0;
    for (const re of n.realEntries) {
      if (re.batch.createdAt > latest) latest = re.batch.createdAt;
    }
    for (const c of n.children.values()) {
      const r = visit(c);
      count += r.count;
      if (r.latest > latest) latest = r.latest;
    }
    n.descendantCount = count;
    n.latestDeletion = latest;
    return { count, latest };
  };
  visit(root);
  return root;
}

type TrashSortField = 'name' | 'date';

// Folder-and-name compare: folders before files, then locale-aware
// case-insensitive name compare. A node is "folder-like" if it has any tree
// children OR any real entry that is a dir. Date compare: most recent deletion
// in the subtree first; ties broken by name. `sortReverse` flips the resulting
// order in both modes; the folders-first rule deliberately stays put in name
// mode so reversing yields Z→A within each group rather than files-on-top.
function makeCompareNodes(sortBy: TrashSortField, sortReverse: boolean) {
  return (a: TreeNode, b: TreeNode): number => {
    if (sortBy === 'name') {
      const aFolder = a.children.size > 0 || a.realEntries.some(r => r.entry.isDirectory);
      const bFolder = b.children.size > 0 || b.realEntries.some(r => r.entry.isDirectory);
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      const cmp = a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
      return sortReverse ? -cmp : cmp;
    }
    let cmp = b.latestDeletion - a.latestDeletion;
    if (cmp === 0) cmp = a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
    return sortReverse ? -cmp : cmp;
  };
}

interface Props {
  category: AssetCategory;
  onClose: () => void;
  onChanged: () => void;
  showMessage: (type: 'success' | 'error', text: string) => void;
}

export default function TrashView({ category, onClose, onChanged, showMessage }: Props) {
  const [batches, setBatches] = useState<TrashBatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Selection mode matches the main DAM: checkboxes are hidden until the user
  // explicitly opts into "Auswählen". Bulk-action buttons in the toolbar are
  // also hidden until then. Outside selection mode, clicking a file row opens
  // its preview directly.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState<null | { kind: 'all' } | { kind: 'items'; items: SelectionKey[] }>(null);
  // Read-only preview state for trashed files.
  const [preview, setPreview] = useState<null | { batchId: string; entry: TrashEntry }>(null);
  // Folder navigation state. Keys are prefixed by kind so synthetic and real
  // folders don't collide: `synth:<path>` for path-derived organizer folders;
  // `real:<batchId>/<path>` for actual trashed folders that lazy-load their
  // preserved on-disk children via /trash/list.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Record<string, TrashEntry[] | null>>({});
  const [searchQuery, setSearchQuery] = useState('');
  // Sort controls — mirrors the main DAM's AssetsTab pattern (sort field + a
  // direction toggle that flips whichever default the field has). "name" keeps
  // the original folders-first locale compare; "date" sorts by deletion
  // timestamp with newest first as the default direction.
  const [sortBy, setSortBy] = useState<TrashSortField>('name');
  const [sortReverse, setSortReverse] = useState(false);
  const [showSort, setShowSort] = useState(false);
  // Lazy-loaded deep-flat listing of every trashed file across every batch.
  // Backs the search input — the top-level `/trash` response collapses soft-
  // deleted folders into single rows, hiding the files nested inside them
  // from a token match. `null` means "not yet fetched"; the loader effect
  // below populates it on first non-empty search and after every reload().
  const [deepEntries, setDeepEntries] = useState<TrashDeepEntry[] | null>(null);
  // A ref (not state) guards re-entry while the request is in flight, because
  // toggling a `deepLoading` state inside the loader effect would re-run the
  // effect, cancel the in-flight promise via cleanup, and lose the result.
  const deepLoadingRef = useRef(false);
  // 30s ticker so the relative-time labels stay fresh while the view is open.
  const [, setNow] = useState(Date.now());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const synthKey = (p: string) => `synth:${p}`;
  const realKey = (batchId: string, p: string) => `real:${batchId}/${p}`;

  const reload = useCallback(async () => {
    // Invalidate the deep-search cache — a restore/purge may have changed it.
    // The loader effect re-fetches it if a search is still active.
    setDeepEntries(null);
    try {
      const data = await listTrash(category);
      setBatches(data.batches);
      // Refresh every currently-expanded real-folder path so the navigation
      // tree stays in sync with disk after a restore/purge.
      const realKeys = Array.from(expanded).filter(k => k.startsWith('real:'));
      const refreshed: Record<string, TrashEntry[] | null> = {};
      for (const key of realKeys) {
        const rest = key.slice('real:'.length);
        const slash = rest.indexOf('/');
        if (slash < 0) continue;
        const batchId = rest.slice(0, slash);
        const p = rest.slice(slash + 1);
        if (!data.batches.some(b => b.batchId === batchId)) continue;
        try {
          const c = await listTrashChildren(category, batchId, p);
          refreshed[key] = c.entries;
        } catch { refreshed[key] = []; }
      }
      setChildrenCache(prev => ({ ...prev, ...refreshed }));
      // Drop any selection whose underlying path is no longer present anywhere.
      setSelected(prev => {
        const valid = new Set<string>();
        for (const b of data.batches) for (const e of b.entries) valid.add(keyOf({ batchId: b.batchId, originalPath: e.originalPath }));
        for (const [key, entries] of Object.entries(refreshed)) {
          const rest = key.slice('real:'.length);
          const slash = rest.indexOf('/');
          if (slash < 0) continue;
          const batchId = rest.slice(0, slash);
          for (const e of entries ?? []) valid.add(keyOf({ batchId, originalPath: e.originalPath }));
        }
        const next = new Set<string>();
        for (const k of prev) if (valid.has(k)) next.add(k);
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      showMessage('error', `Papierkorb konnte nicht geladen werden: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
    // `expanded` is intentionally read fresh — including it would re-run on every toggle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, showMessage]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useWsChannel<{ category: string }>('assets-changed', data => {
    if (data.category !== category) return;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { reloadTimer.current = null; reload(); }, 300);
  });

  // Reset selection / nav state when category changes — though typically the parent unmounts on switch.
  useEffect(() => {
    setSelected(new Set());
    setSelectionMode(false);
    setExpanded(new Set());
    setChildrenCache({});
    setSearchQuery('');
    setDeepEntries(null);
    setSortBy('name');
    setSortReverse(false);
    setShowSort(false);
  }, [category]);

  // Lazy-load the deep-flat listing the first time a search query is entered
  // (or whenever the cache was invalidated by a reload). Folders nested inside
  // soft-deleted folders are only reachable through this listing, so the
  // search would silently miss them without it.
  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (deepEntries !== null) return;
    if (deepLoadingRef.current) return;
    deepLoadingRef.current = true;
    listTrashAll(category)
      .then(r => setDeepEntries(r.entries))
      .catch(err => showMessage('error', `Suche fehlgeschlagen: ${(err as Error).message}`))
      .finally(() => { deepLoadingRef.current = false; });
  }, [searchQuery, category, deepEntries, showMessage]);

  // Escape exits selection mode (matches the main DAM's Escape handler).
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        setSelectionMode(false);
        setSelected(new Set());
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selectionMode]);

  const tree = useMemo(() => buildTree(batches ?? []), [batches]);
  const compareNodes = useMemo(() => makeCompareNodes(sortBy, sortReverse), [sortBy, sortReverse]);
  // Sort the `realEntries` array on a tree node. Only date sort actually
  // reorders — name sort keeps insertion order because all entries on the same
  // node share the same path, so they only differ by batch (rare; same path
  // trashed twice). For date, newest batch first by default; reverse flips it.
  const sortRealEntries = useCallback((entries: TreeNode['realEntries']): TreeNode['realEntries'] => {
    if (sortBy !== 'date') return entries;
    const sorted = [...entries].sort((a, b) => b.batch.createdAt - a.batch.createdAt);
    return sortReverse ? sorted.reverse() : sorted;
  }, [sortBy, sortReverse]);

  // Search collapses the tree to a flat list of every matching trashed file,
  // mirroring the main DAM's behaviour where active search bypasses folder
  // navigation entirely. Returns `'loading'` while the deep listing is still
  // in flight so the UI can show a placeholder instead of "Keine Treffer".
  const searchResults = useMemo((): 'loading' | TrashDeepEntry[] | null => {
    if (!searchQuery.trim()) return null;
    if (deepEntries === null) return 'loading';
    return deepEntries
      .filter(e => matchesSearch(e.originalPath, searchQuery))
      .sort((a, b) => {
        let cmp: number;
        if (sortBy === 'date') {
          cmp = b.batchCreatedAt - a.batchCreatedAt;
          if (cmp === 0) cmp = a.originalPath.localeCompare(b.originalPath, 'de', { sensitivity: 'base' });
        } else {
          cmp = a.originalPath.localeCompare(b.originalPath, 'de', { sensitivity: 'base' });
        }
        return sortReverse ? -cmp : cmp;
      });
  }, [deepEntries, searchQuery, sortBy, sortReverse]);

  const selectedItems = useMemo(() => Array.from(selected, parseKey), [selected]);
  const totalEntries = batches?.reduce((a, b) => a + b.entries.length, 0) ?? 0;
  const totalSize = batches?.reduce((a, b) => a + b.sizeBytes, 0) ?? 0;

  const toggle = (k: SelectionKey) => {
    const s = keyOf(k);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const toggleSynth = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      const key = synthKey(path);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleReal = async (batchId: string, p: string, isDirectory: boolean) => {
    if (!isDirectory) return;
    const key = realKey(batchId, p);
    if (expanded.has(key)) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpanded(prev => new Set(prev).add(key));
    if (!(key in childrenCache)) {
      setChildrenCache(prev => ({ ...prev, [key]: null }));
      try {
        const data = await listTrashChildren(category, batchId, p);
        setChildrenCache(prev => ({ ...prev, [key]: data.entries }));
      } catch (err) {
        setChildrenCache(prev => ({ ...prev, [key]: [] }));
        showMessage('error', `Ordner konnte nicht geladen werden: ${(err as Error).message}`);
      }
    }
  };

  // Group selection by batchId so restore/purge can be issued per-batch.
  const groupByBatch = (items: SelectionKey[]) => {
    const map = new Map<string, string[]>();
    for (const it of items) {
      const arr = map.get(it.batchId) ?? [];
      arr.push(it.originalPath);
      map.set(it.batchId, arr);
    }
    return map;
  };

  const doRestore = async (items: SelectionKey[]) => {
    if (busy) return;
    setBusy(true);
    try {
      let totalRestored = 0;
      const allConflicts: string[] = [];
      const grouped = groupByBatch(items);
      for (const [batchId, paths] of grouped) {
        const r = await restoreTrash(category, batchId, paths);
        totalRestored += r.restored;
        allConflicts.push(...r.conflicts);
      }
      onChanged();
      setSelected(new Set());
      await reload();
      if (allConflicts.length === 0) {
        showMessage('success', `${totalRestored} Datei(en) wiederhergestellt`);
      } else {
        showMessage('error', `${totalRestored} wiederhergestellt, ${allConflicts.length} Konflikt(e): ${allConflicts.slice(0, 3).join(', ')}${allConflicts.length > 3 ? ' …' : ''}`);
      }
    } catch (err) {
      showMessage('error', `Wiederherstellen fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doPurge = async (target: { kind: 'all' } | { kind: 'items'; items: SelectionKey[] }) => {
    if (busy) return;
    setBusy(true);
    try {
      let purged = 0;
      let batchesPurged = 0;
      if (target.kind === 'all') {
        const r = await purgeTrash(category);
        purged += r.purged; batchesPurged += r.batches;
      } else {
        const grouped = groupByBatch(target.items);
        for (const [batchId, paths] of grouped) {
          const r = await purgeTrash(category, { batchId, items: paths });
          purged += r.purged; batchesPurged += r.batches;
        }
      }
      onChanged();
      setSelected(new Set());
      setPreview(null);
      await reload();
      showMessage('success', `Endgültig gelöscht: ${purged} Eintr${purged === 1 ? 'ag' : 'äge'}${batchesPurged ? ` (${batchesPurged} Charge${batchesPurged === 1 ? '' : 'n'} geleert)` : ''}`);
    } catch (err) {
      showMessage('error', `Endgültig löschen fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setConfirmPurge(null);
    }
  };

  const flatMode = searchResults !== null;

  // Adapt a TrashDeepEntry to the shape renderRealRow expects. The synthesized
  // batch/entry stubs are sufficient because flat search rows never participate
  // in folder expansion or batch selection logic.
  const renderDeepRow = (e: TrashDeepEntry): ReactNode => {
    const batchStub: TrashBatch = {
      batchId: e.batchId,
      createdAt: e.batchCreatedAt,
      expiresAt: e.batchExpiresAt,
      sizeBytes: e.sizeBytes,
      isCurrent: false,
      entries: [],
    };
    const entryStub: TrashEntry = {
      originalPath: e.originalPath,
      isDirectory: false,
      sizeBytes: e.sizeBytes,
      mediaType: e.mediaType,
    };
    return renderRealRow(batchStub, entryStub, 0, e.originalPath, false, true);
  };

  // One row for a real trash entry (file or folder). In tree mode, `depth`
  // drives indentation and `displayName` is the leaf path segment; in search
  // mode, `flat` is true, depth is 0, and the row shows the full original path
  // so users can locate the match without expanded ancestors.
  const renderRealRow = (
    batch: TrashBatch,
    entry: TrashEntry,
    depth: number,
    displayName: string,
    expandedNow: boolean,
    flat: boolean,
  ) => {
    const k = { batchId: batch.batchId, originalPath: entry.originalPath };
    const isSelected = selected.has(keyOf(k));
    const icon = mediaTypeIcon(entry.mediaType, entry.isDirectory);
    const isPreviewable = !entry.isDirectory && (entry.mediaType === 'image' || entry.mediaType === 'audio' || entry.mediaType === 'video');
    // Click-on-row behaviour:
    // - Selection mode: toggle selection (matches the main DAM).
    // - Folder, not selecting, tree mode: expand/collapse.
    // - Previewable file: open preview modal.
    // - Folder in flat search mode: no-op (children aren't rendered here).
    const handleRowClick = () => {
      if (selectionMode) { toggle(k); return; }
      if (entry.isDirectory && !flat) { void toggleReal(batch.batchId, entry.originalPath, true); return; }
      if (isPreviewable) { setPreview({ batchId: batch.batchId, entry }); return; }
    };
    const interactive = selectionMode || isPreviewable || (entry.isDirectory && !flat);
    return (
      <div
        key={`row:${batch.batchId}#${entry.originalPath}`}
        className={`trash-entry${isSelected ? ' trash-entry--selected' : ''}${selectionMode ? ' trash-entry--selecting' : ''}`}
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={handleRowClick}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
      >
        {selectionMode && (
          <label className="trash-entry-check" onClick={ev => ev.stopPropagation()}>
            <input type="checkbox" checked={isSelected} onChange={() => toggle(k)} />
          </label>
        )}
        {entry.isDirectory && !flat ? (
          <button
            type="button"
            className={`trash-entry-chevron${expandedNow ? ' trash-entry-chevron--open' : ''}`}
            onClick={ev => { ev.stopPropagation(); void toggleReal(batch.batchId, entry.originalPath, true); }}
            aria-label={expandedNow ? 'Ordner schließen' : 'Ordner öffnen'}
            title={expandedNow ? 'Ordner schließen' : 'Ordner öffnen'}
          >▶</button>
        ) : (
          <span className="trash-entry-chevron trash-entry-chevron--leaf" aria-hidden />
        )}
        <span className="trash-entry-icon" aria-hidden>{icon}</span>
        <span
          className={`trash-entry-path${entry.isDirectory ? ' trash-entry-path--folder' : ''}`}
          title={entry.originalPath}
        >
          {displayName}
          {entry.isDirectory && '/'}
        </span>
        <span className="trash-entry-when" title={`gelöscht ${fmtAgo(Date.now() - batch.createdAt)}`}>
          {fmtAgo(Date.now() - batch.createdAt)}
        </span>
        <span className="trash-entry-ttl" title={fmtRemaining(batch.expiresAt - Date.now())}>
          {fmtRemaining(batch.expiresAt - Date.now())}
        </span>
        <span className="trash-entry-size">{fmtFileSize(entry.sizeBytes)}</span>
        <span className="trash-entry-actions" onClick={ev => ev.stopPropagation()}>
          <button
            type="button"
            className="be-btn-primary trash-action-btn"
            onClick={() => doRestore([k])}
            disabled={busy}
          >
            Wiederherstellen
          </button>
          <button
            type="button"
            className="be-btn-secondary trash-action-btn trash-action-danger"
            onClick={() => setConfirmPurge({ kind: 'items', items: [k] })}
            disabled={busy}
          >
            Endgültig löschen
          </button>
        </span>
      </div>
    );
  };

  // Synthetic folder header — a path organizer derived from one or more
  // entries' originalPaths. No actions, no preview, just expand/collapse.
  const renderSyntheticFolder = (node: TreeNode, depth: number, expandedNow: boolean) => (
    <div
      key={`synth:${node.path}`}
      className="trash-folder-row"
      style={{ paddingLeft: 12 + depth * 20 }}
      onClick={() => toggleSynth(node.path)}
      role="button"
      tabIndex={0}
    >
      <button
        type="button"
        className={`trash-entry-chevron${expandedNow ? ' trash-entry-chevron--open' : ''}`}
        onClick={ev => { ev.stopPropagation(); toggleSynth(node.path); }}
        aria-label={expandedNow ? 'Ordner schließen' : 'Ordner öffnen'}
        title={expandedNow ? 'Ordner schließen' : 'Ordner öffnen'}
      >▶</button>
      <span className="trash-entry-icon" aria-hidden>📁</span>
      <span className="trash-entry-path trash-entry-path--folder" title={node.path}>
        {node.name}/
      </span>
      <span className="trash-folder-count">{node.descendantCount}</span>
    </div>
  );

  // Render a TrashEntry that was lazy-loaded as a child of a real trashed
  // folder via /trash/list. Folders here can be further expanded recursively.
  const renderRealChildSubtree = (batch: TrashBatch, entry: TrashEntry, depth: number): ReactNode => {
    const key = realKey(batch.batchId, entry.originalPath);
    const expandedNow = expanded.has(key);
    const cached = childrenCache[key];
    const displayName = entry.originalPath.split('/').pop() ?? entry.originalPath;
    return (
      <Fragment key={`real-child:${batch.batchId}/${entry.originalPath}`}>
        {renderRealRow(batch, entry, depth, displayName, expandedNow, false)}
        {entry.isDirectory && expandedNow && (
          <>
            {cached === null && (
              <div className="trash-entry-empty" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>Lade…</div>
            )}
            {cached && cached.length === 0 && (
              <div className="trash-entry-empty" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>Ordner ist leer</div>
            )}
            {cached?.map(c => renderRealChildSubtree(batch, c, depth + 1))}
          </>
        )}
      </Fragment>
    );
  };

  // Render a TreeNode (synthetic OR real) and its descendants.
  const renderTreeNode = (node: TreeNode, depth: number): ReactNode => {
    const sortedChildren = Array.from(node.children.values()).sort(compareNodes);

    if (node.realEntries.length === 0) {
      // Pure synthetic folder — just a path organizer.
      const expandedNow = expanded.has(synthKey(node.path));
      return (
        <Fragment key={`node:${node.path}`}>
          {renderSyntheticFolder(node, depth, expandedNow)}
          {expandedNow && sortedChildren.map(c => renderTreeNode(c, depth + 1))}
        </Fragment>
      );
    }

    // One or more actual trash entries resolve to this path. Render each as
    // its own row; usually there's exactly one. Multiple real entries on the
    // same node happen only when the same originalPath was trashed across
    // distinct batches — each row keeps its batchId for restore/purge.
    return (
      <Fragment key={`node:${node.path}`}>
        {sortRealEntries(node.realEntries).map(re => {
          const key = realKey(re.batch.batchId, re.entry.originalPath);
          const expandedNow = expanded.has(key);
          const cached = childrenCache[key];
          return (
            <Fragment key={`entry:${re.batch.batchId}#${re.entry.originalPath}`}>
              {renderRealRow(re.batch, re.entry, depth, node.name, expandedNow, false)}
              {re.entry.isDirectory && expandedNow && (
                <>
                  {sortedChildren.map(c => renderTreeNode(c, depth + 1))}
                  {cached === null && (
                    <div className="trash-entry-empty" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>Lade…</div>
                  )}
                  {cached && cached.length === 0 && sortedChildren.length === 0 && (
                    <div className="trash-entry-empty" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>Ordner ist leer</div>
                  )}
                  {cached?.map(c => renderRealChildSubtree(re.batch, c, depth + 1))}
                </>
              )}
            </Fragment>
          );
        })}
      </Fragment>
    );
  };

  const rootChildren = useMemo(
    () => Array.from(tree.children.values()).sort(compareNodes),
    [tree, compareNodes],
  );

  return (
    <div className="trash-view">
      <div className="trash-header">
        <button type="button" className="be-btn-secondary" onClick={onClose}>← Zurück</button>
        <h2 className="trash-header-title">Papierkorb — {CATEGORY_LABEL[category]}</h2>
        <span className="trash-header-stats">
          {totalEntries} Eintr{totalEntries === 1 ? 'ag' : 'äge'} · {fmtFileSize(totalSize)}
        </span>
      </div>

      <div className="asset-search-row">
        <span className="asset-search-icon">🔍</span>
        <input
          className="be-input asset-search-input"
          placeholder="Dateien suchen…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="be-icon-btn asset-search-clear" onClick={() => setSearchQuery('')}>✕</button>
        )}
        <div className="asset-sort-wrapper">
          <button
            type="button"
            className={`be-icon-btn${showSort ? ' asset-select-toggle-active' : ''}`}
            onClick={() => setShowSort(s => !s)}
            title="Sortierung"
          >
            {sortBy === 'name' ? 'Name' : 'Datum'}
            {sortReverse ? ' ↑' : ' ↓'}
          </button>
          {showSort && (
            <>
              <div className="asset-sort-backdrop" onClick={() => setShowSort(false)} />
              <div className="asset-sort-popover">
                {([['name', 'Name'], ['date', 'Datum']] as [TrashSortField, string][]).map(([field, label]) => (
                  <button
                    key={field}
                    type="button"
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
      </div>

      <div className="trash-toolbar">
        {!selectionMode && (
          <>
            <button
              type="button"
              className="be-btn-secondary trash-toolbar-btn"
              onClick={() => setSelectionMode(true)}
              disabled={busy || !batches || totalEntries === 0}
            >
              Auswählen
            </button>
            <button
              type="button"
              className="be-btn-secondary trash-action-danger trash-toolbar-btn"
              disabled={busy || !batches || batches.length === 0}
              onClick={() => setConfirmPurge({ kind: 'all' })}
            >
              Alle leeren
            </button>
          </>
        )}
        {selectionMode && (
          <>
            <button
              type="button"
              className="be-btn-secondary trash-toolbar-btn"
              onClick={() => { setSelectionMode(false); setSelected(new Set()); }}
              title="Auswahl abbrechen (Esc)"
            >
              ✕ Auswahl beenden
            </button>
            <span className="trash-toolbar-count">
              {selectedItems.length} ausgewählt
            </span>
            <button
              type="button"
              className="be-btn-primary trash-toolbar-btn"
              disabled={busy || selectedItems.length === 0}
              onClick={() => doRestore(selectedItems)}
            >
              Wiederherstellen ({selectedItems.length})
            </button>
            <button
              type="button"
              className="be-btn-secondary trash-action-danger trash-toolbar-btn"
              disabled={busy || selectedItems.length === 0}
              onClick={() => setConfirmPurge({ kind: 'items', items: selectedItems })}
            >
              Endgültig löschen ({selectedItems.length})
            </button>
          </>
        )}
      </div>

      {loading && <p className="trash-empty">Lade…</p>}
      {!loading && totalEntries === 0 && <p className="trash-empty">Papierkorb ist leer</p>}

      {!loading && totalEntries > 0 && (
        <div className="trash-list">
          {flatMode ? (
            searchResults === 'loading' ? (
              <p className="trash-empty">Lade Suchergebnisse…</p>
            ) : searchResults!.length === 0 ? (
              <p className="trash-empty">Keine Treffer</p>
            ) : (
              searchResults!.map(e => renderDeepRow(e))
            )
          ) : (
            rootChildren.map(node => renderTreeNode(node, 0))
          )}
        </div>
      )}

      {preview && (
        <TrashPreviewModal
          category={category}
          batchId={preview.batchId}
          entry={preview.entry}
          busy={busy}
          onClose={() => setPreview(null)}
          onRestore={async () => {
            await doRestore([{ batchId: preview.batchId, originalPath: preview.entry.originalPath }]);
            setPreview(null);
          }}
          onPurge={() => setConfirmPurge({ kind: 'items', items: [{ batchId: preview.batchId, originalPath: preview.entry.originalPath }] })}
        />
      )}

      {confirmPurge && (
        <PurgeConfirmModal
          target={confirmPurge}
          onCancel={() => setConfirmPurge(null)}
          onConfirm={() => doPurge(confirmPurge)}
          busy={busy}
        />
      )}
    </div>
  );
}

function mediaTypeIcon(t: TrashMediaType, isDirectory: boolean): string {
  if (isDirectory) return '📁';
  if (t === 'image') return '🖼';
  if (t === 'audio') return '🎵';
  if (t === 'video') return '🎬';
  return '📄';
}

interface PreviewProps {
  category: AssetCategory;
  batchId: string;
  entry: TrashEntry;
  busy: boolean;
  onClose: () => void;
  onRestore: () => void;
  onPurge: () => void;
}

function TrashPreviewModal({ category, batchId, entry, busy, onClose, onRestore, onPurge }: PreviewProps) {
  const src = trashStreamUrl(category, batchId, entry.originalPath);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="trash-preview-backdrop" onClick={onClose}>
      <div className="trash-preview-modal" onClick={e => e.stopPropagation()}>
        <header className="trash-preview-header">
          <span className="trash-preview-path" title={entry.originalPath}>{entry.originalPath}</span>
          <span className="trash-preview-actions">
            <button
              type="button"
              className="be-btn-primary trash-action-btn"
              onClick={onRestore}
              disabled={busy}
            >
              Wiederherstellen
            </button>
            <button
              type="button"
              className="be-btn-secondary trash-action-btn trash-action-danger"
              onClick={onPurge}
              disabled={busy}
            >
              Endgültig löschen
            </button>
            <button type="button" className="be-icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
          </span>
        </header>
        <div className="trash-preview-body">
          {entry.mediaType === 'image' && (
            <img src={src} alt={entry.originalPath} className="trash-preview-image" />
          )}
          {entry.mediaType === 'audio' && (
            <audio src={src} controls autoPlay={false} className="trash-preview-audio" />
          )}
          {entry.mediaType === 'video' && (
            <video src={src} controls className="trash-preview-video" />
          )}
        </div>
      </div>
    </div>
  );
}

interface PurgeProps {
  target: { kind: 'all' } | { kind: 'items'; items: SelectionKey[] };
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

function PurgeConfirmModal({ target, onCancel, onConfirm, busy }: PurgeProps) {
  const summary = target.kind === 'all'
    ? 'Alle Einträge im Papierkorb endgültig löschen.'
    : `${target.items.length} Eintr${target.items.length === 1 ? 'ag' : 'äge'} endgültig löschen.`;
  return (
    <div className="trash-preview-backdrop" onClick={onCancel}>
      <div className="trash-purge-modal" onClick={e => e.stopPropagation()}>
        <h3>Endgültig löschen</h3>
        <p>{summary}</p>
        <p className="trash-purge-warning">
          Dieser Vorgang kann nicht rückgängig gemacht werden.
        </p>
        <div className="trash-purge-actions">
          <button type="button" className="be-btn-secondary" onClick={onCancel} disabled={busy}>Abbrechen</button>
          <button type="button" className="be-btn-primary trash-action-danger" onClick={onConfirm} disabled={busy}>
            Permanent löschen
          </button>
        </div>
      </div>
    </div>
  );
}
