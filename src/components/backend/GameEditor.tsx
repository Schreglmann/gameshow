import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameType, RulesPreset, ContentChangedPayload } from '@/types/config';
import { THEMES } from '@/context/ThemeContext';
import { saveGame, renameGame, unlockPrecheck, fetchConfig, deleteGameInstance, convertGameToMulti, fetchGame, ApiError } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import { GAME_TYPE_INFO, GAME_TYPE_TEMPLATES, gameTypesShareQuestionShape } from '@/data/gameTypeInfo';
import RulesEditor from './RulesEditor';
import InstanceEditor from './InstanceEditor';
import StatusMessage from './StatusMessage';
import SpellCheckPanel, { type SpellGroup, type SpellIssue } from './SpellCheckPanel';
import { useSpellcheckSettings } from './SpellcheckSettingsContext';
import { SpellCheckProvider, type SpellCheckCtxValue } from './SpellCheckContext';
import SpellField from './SpellField';
import { segmentsForCurrentInstance, applyReplacement } from '@/utils/spellcheckFields';
import { checkSpelling, type SpellMatch } from '@/services/backendApi';
import ConflictBanner from './ConflictBanner';
import { useDragReorder } from './useDragReorder';
import { slugifyGameName } from './slugifyGameName';
import { useConfirm } from './ConfirmContext';

interface Props {
  fileName: string;
   
  initialData: Record<string, any>;
  initialInstance?: string;
  initialQuestion?: number;
  onClose: () => void;
  onGoToAssets: () => void;
  onInstanceChange?: (instance: string) => void;
  onRename?: (newFileName: string) => void;
}

export default function GameEditor({ fileName, initialData, initialInstance, initialQuestion, onClose, onGoToAssets, onInstanceChange, onRename }: Props) {
  const confirmDialog = useConfirm();
   
  const [data, setData] = useState<Record<string, any>>(initialData);
  const [activeInstance, setActiveInstance] = useState<string>(() => {
    if (data.instances) {
      if (initialInstance && initialInstance in data.instances) return initialInstance;
      const keys = Object.keys(data.instances).filter(k => k !== 'template' && k.toLowerCase() !== 'archive');
      return keys[0] ?? '';
    }
    return '__single__';
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rulesPresets, setRulesPresets] = useState<RulesPreset[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Spellcheck ("Lektorat") — per-game check; see specs/spellcheck.md ──
  const spellcheck = useSpellcheckSettings();
  const [spellOpen, setSpellOpen] = useState(false);
  const [spellLoading, setSpellLoading] = useState(false);
  const [spellError, setSpellError] = useState<string | null>(null);
  const [spellEntries, setSpellEntries] = useState<{ issue: SpellIssue; segKey: string; path: (string | number)[] }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then(cfg => { if (!cancelled) setRulesPresets(cfg.rulesPresets ?? []); })
      .catch(() => { /* presets are optional — fail silently */ });
    return () => { cancelled = true; };
  }, []);
  const prevData = useRef(data);
  const prevFileName = useRef(fileName);
  // Serialization state for the auto-save: `saveInFlight` guards against starting a second
  // PUT while the first is still running, and `pendingSave` stashes the latest payload so
  // it's flushed after the in-flight request returns. Without this, a fast edit after a
  // save started (e.g. a drag-reorder that finished 800 ms after a previous one) could
  // produce overlapping PUTs whose server-side renames arrive out of order.
  const saveInFlight = useRef(false);
  const pendingSave = useRef<{ fileName: string; data: Record<string, unknown> } | null>(null);

  // ── Cross-tab live sync (admin multi-instance) — see specs/live-config-reload.md ──
  // `savedSnapshotRef` is the JSON of the last state known to be persisted on disk; it
  // drives the dirty check. `recentSelfWrites` holds the JSON of writes WE issued so our
  // own `content-changed` echoes never trigger a reload banner. `reconcileReq` is a
  // monotonic guard so a slow re-fetch can't clobber a newer one. `skipDeletedClose`
  // suppresses the 404→close path during our own rename (old file briefly gone).
  const savedSnapshotRef = useRef<string>(JSON.stringify(initialData));
  const recentSelfWrites = useRef<Set<string>>(new Set());
  const reconcileReq = useRef(0);
  const skipDeletedClose = useRef(false);
   
  const [conflict, setConflict] = useState<{ fresh: Record<string, any> } | null>(null);

  const markSelfSaved = (payload: unknown) => {
    const s = JSON.stringify(payload);
    savedSnapshotRef.current = s;
    recentSelfWrites.current.add(s);
    setTimeout(() => recentSelfWrites.current.delete(s), 5000);
  };

  // Adopt a remote version. Set prevData/savedSnapshot BEFORE setData so the auto-save
  // effect early-returns (data === prevData.current) — otherwise adopting a remote change
  // would bounce our own copy straight back to the server and thrash across tabs.
   
  const adoptRemote = (fresh: Record<string, any>) => {
    prevData.current = fresh;
    savedSnapshotRef.current = JSON.stringify(fresh);
    setData(fresh);
    setConflict(null);
    const freshInstances = fresh.instances as Record<string, unknown> | undefined;
    if (freshInstances) {
      if (!(activeInstance in freshInstances)) {
        const first = Object.keys(freshInstances).filter(k => k !== 'template' && k.toLowerCase() !== 'archive')[0] ?? '';
        setActiveInstance(first);
      }
    } else if (activeInstance !== '__single__') {
      setActiveInstance('__single__');
    }
  };

  // React to a content-changed broadcast (any games/*.json write). Re-fetch the open file
  // and reconcile: ignore our own echoes, adopt silently when we have no unsaved edits,
  // show a non-blocking banner when we do.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (!payload?.games) return;
    const myReq = ++reconcileReq.current;
    fetchGame(fileName)
      .then(freshRaw => {
        if (myReq !== reconcileReq.current) return;
         
        const fresh = freshRaw as Record<string, any>;
        const freshStr = JSON.stringify(fresh);
        if (recentSelfWrites.current.has(freshStr)) return;  // our own write echoing back
        if (freshStr === JSON.stringify(data)) return;        // already in sync
        // Disk matches the baseline we loaded — there is NO remote change to reconcile; any
        // difference is purely our own unsaved edits. Without this guard a late content-changed
        // echo (e.g. the "Beispiele erstellen" write-burst on a fresh install) landing while we
        // have unsaved edits would falsely raise the "in einem anderen Tab geändert" banner.
        if (freshStr === savedSnapshotRef.current) return;
        const isDirty = JSON.stringify(data) !== savedSnapshotRef.current;
        if (isDirty) setConflict({ fresh });
        else adoptRemote(fresh);
      })
      .catch(err => {
        if (myReq !== reconcileReq.current) return;
        // Deleted or renamed in another tab — bail back to the list (unless it's our own
        // in-flight rename, where the old name is briefly gone).
        if (err instanceof ApiError && err.status === 404 && !skipDeletedClose.current) {
          onClose();
        }
      });
  });

  const isSingle = !data.instances;
  const isArchive = (k: string) => k.toLowerCase() === 'archive';
  const instances: string[] = isSingle ? ['__single__'] : Object.keys(data.instances).filter(k => k !== 'template' && !isArchive(k));
  const hasArchive = !isSingle && Object.keys(data.instances).some(isArchive);
  const archiveKey = !isSingle ? Object.keys(data.instances).find(isArchive) ?? null : null;

  // Auto-create archive instance for multi-instance games
  useEffect(() => {
    if (!isSingle && !hasArchive) {
      setData(prev => ({ ...prev, instances: { ...prev.instances, archive: { questions: [] } } }));
    }
  }, [isSingle, hasArchive]);

  // Switch instance AND report to parent (for user-initiated changes only)
  const switchInstance = (key: string) => {
    setActiveInstance(key);
    if (key !== '__single__') onInstanceChange?.(key);
  };

  // Sync with parent navigation (browser back/forward) — no report back to avoid loop
  useEffect(() => {
    if (initialInstance && initialInstance !== activeInstance && (instances.includes(initialInstance) || (archiveKey && initialInstance === archiveKey))) {
      setActiveInstance(initialInstance);
    } else if (!initialInstance && data.instances) {
      const first = instances[0];
      if (first && first !== '__single__' && activeInstance !== first) {
        setActiveInstance(first);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInstance]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  useEffect(() => {
    if (data === prevData.current && fileName === prevFileName.current) return;
    prevData.current = data;
    prevFileName.current = fileName;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave(fileName, data);
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, fileName]);

  const flushSave = async (fn: string, payload: Record<string, unknown>) => {
    // If another save is already in flight, remember the newest payload and let the
    // in-flight save's finally block pick it up. This keeps the last value as the
    // winner and prevents two PUTs from overlapping on the server.
    if (saveInFlight.current) {
      pendingSave.current = { fileName: fn, data: payload };
      return;
    }
    saveInFlight.current = true;
    try {
      await saveGame(fn, payload);
      markSelfSaved(payload);
      showMsg('success', '✅ Gespeichert!');
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    } finally {
      saveInFlight.current = false;
      const next = pendingSave.current;
      if (next) {
        pendingSave.current = null;
        void flushSave(next.fileName, next.data);
      }
    }
  };

   
  const updateInstance = (key: string, instance: Record<string, any>) => {
    if (isSingle) {
      setData({ ...data, ...instance });
    } else {
      setData({ ...data, instances: { ...data.instances, [key]: instance } });
    }
  };

  const addInstance = () => {
    const key = `v${instances.length + 1}`;
    setData({ ...data, instances: { ...data.instances, [key]: { questions: [] } } });
    switchInstance(key);
  };

  const [converting, setConverting] = useState(false);

  // "+ Instanz" handler. For a multi-instance game this just appends an empty instance. For a
  // single-instance game it first converts the file to multi (existing content → "v1", bare
  // gameOrder refs re-pointed to /v1 server-side), then appends an empty "v2" and switches to it.
  const handleAddInstance = async () => {
    if (!isSingle) {
      addInstance();
      return;
    }
    setConverting(true);
    try {
      const { gameFile, rewrittenRefs } = await convertGameToMulti(fileName);
      const converted = gameFile as Record<string, any>;
      const next = {
        ...converted,
        instances: { ...converted.instances, v2: { questions: [] } },
      };
      // The server already wrote the v1 conversion; mark it self-written so the cross-tab
      // reconciliation banner doesn't fire, and let the normal auto-save persist the empty v2.
      prevData.current = next;
      markSelfSaved(next);
      setData(next);
      switchInstance('v2');
      if (rewrittenRefs.length) {
        showMsg('success', `Instanz hinzugefügt — ${rewrittenRefs.length} Gameshow-Verweis(e) auf /v1 umgestellt`);
      }
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    } finally {
      setConverting(false);
    }
  };

  const deleteInstance = async (key: string) => {
    if (isArchive(key)) return;
    if (!(await confirmDialog({ title: `Instanz "${key}" wirklich löschen?` }))) return;
    // Flush any pending auto-save first so unsaved edits to the OTHER instances aren't lost
    // when the server rewrites the file (mirrors handleTitleBlur's flush).
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      try { await saveGame(fileName, data); markSelfSaved(data); } catch { /* server delete reads the on-disk version */ }
    }
    // Server-side delete removes the instance from the file AND cascades the gameOrder cleanup
    // (config.json), so a deleted instance never leaves a dangling reference. See
    // specs/config-gameorder-cascade.md.
    let removedRefs: { gameshow: string; ref: string }[] = [];
    try {
      ({ removedRefs } = await deleteGameInstance(fileName, key));
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
      return;
    }
    const { [key]: _, ...rest } = data.instances;
    const nextData = { ...data, instances: rest };
    // Mark the post-delete state as self-written + persisted: the server already wrote it,
    // so skip the redundant auto-save (prevData) and suppress our own content-changed echo.
    prevData.current = nextData;
    markSelfSaved(nextData);
    setData(nextData);
    const nextKey = Object.keys(rest).filter(k => k !== 'template' && !isArchive(k))[0] ?? '';
    switchInstance(nextKey);
    if (removedRefs.length) {
      showMsg('success', `Instanz gelöscht — aus ${removedRefs.length} Gameshow-Verweis(en) entfernt`);
    }
  };

  const [renamingInstance, setRenamingInstance] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const handleTitleBlur = async () => {
    const title = data.title;
    if (!title || !onRename) return;
    const derived = slugifyGameName(title);
    if (!derived || derived === fileName) return;

    // Flush any pending auto-save first
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      try { await saveGame(fileName, data); markSelfSaved(data); } catch { /* rename will fail if save fails */ }
    }

    // During our own rename the old file briefly 404s — don't let reconciliation read that
    // as a remote delete and close the editor before the new fileName prop arrives.
    skipDeletedClose.current = true;
    setTimeout(() => { skipDeletedClose.current = false; }, 3000);

    setRenaming(true);
    try {
      await renameGame(fileName, derived);
      onRename(derived);
    } catch (e) {
      showMsg('error', `Umbenennung fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setRenaming(false);
    }
  };

  const reorderInstances = (newOrder: string[]) => {
    const reordered = Object.fromEntries(
      newOrder.map(k => [k, data.instances[k]])
    );
    if (data.instances.template) reordered.template = data.instances.template;
    if (archiveKey) reordered[archiveKey] = data.instances[archiveKey];
    setData({ ...data, instances: reordered });
  };
  const { onDragStart: onTabDragStart, onDragOver: onTabDragOver, onDragEnd: onTabDragEnd } = useDragReorder(instances, reorderInstances);

  const renameInstance = (oldKey: string, newKey: string) => {
    const trimmed = newKey.trim();
    setRenamingInstance(null);
    if (!trimmed || trimmed === oldKey) return;
    if (isArchive(oldKey) || isArchive(trimmed)) return;
    if (data.instances[trimmed]) return;
    const renamed = Object.fromEntries(
      Object.entries(data.instances).map(([k, v]) => [k === oldKey ? trimmed : k, v])
    );
    setData({ ...data, instances: renamed });
    switchInstance(trimmed);
  };

   
  const currentInstance: Record<string, any> = isSingle
    ? data
    : (data.instances[activeInstance] ?? {});

  const otherInstances = !isSingle
    ? [...instances, ...(archiveKey ? [archiveKey] : [])].filter(k => k !== activeInstance)
    : [];

  // ── Video-guess instance lock (see specs/video-guess-lock.md) ──
  const isVideoGuessLockable = data.type === 'video-guess' && !isArchive(activeInstance);
  const locked = isVideoGuessLockable && currentInstance.locked === true;
  const [unlockWarning, setUnlockWarning] = useState<{ missing: string[]; offlineReferences: string[] } | null>(null);
  const [unlockPending, setUnlockPending] = useState(false);
  const setLocked = (value: boolean) => {
    const next = value ? true : undefined;
    if (isSingle) {
      setData({ ...data, locked: next });
    } else {
      setData({ ...data, instances: { ...data.instances, [activeInstance]: { ...currentInstance, locked: next } } });
    }
  };
  const handleLockToggle = async () => {
    if (!locked) { setLocked(true); return; }
    // Unlocking — precheck for offline source files.
    setUnlockPending(true);
    const instKey = isSingle ? '(root)' : activeInstance;
    try {
      const result = await unlockPrecheck(fileName, instKey);
      if (result.missing.length === 0 && result.offlineReferences.length === 0) {
        setLocked(false);
      } else {
        setUnlockWarning(result);
      }
    } catch {
      setLocked(false);
    } finally {
      setUnlockPending(false);
    }
  };
  const confirmUnlock = () => { setUnlockWarning(null); setLocked(false); };

  const moveQuestion = async (questionIndex: number, targetInstanceKey: string) => {
    if (isSingle) return;
    const sourceQuestions = [...(currentInstance.questions ?? [])];
    const [moved] = sourceQuestions.splice(questionIndex, 1);
    if (!moved) return;
    const target = data.instances[targetInstanceKey] ?? {};
    const targetQuestions = [...(target.questions ?? []), moved];
    const newData = {
      ...data,
      instances: {
        ...data.instances,
        [activeInstance]: { ...currentInstance, questions: sourceQuestions },
        [targetInstanceKey]: { ...target, questions: targetQuestions },
      },
    };
    setData(newData);
    // Save immediately — don't rely on the 800ms debounce for structural moves
    if (saveTimer.current) clearTimeout(saveTimer.current);
    prevData.current = newData;
    try {
      await saveGame(fileName, newData);
      markSelfSaved(newData);
      showMsg('success', '✅ Gespeichert!');
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  // Changing the game type re-interprets every question against a different schema, so the
  // existing questions usually become incompatible (and are dropped on the next save). Warn
  // before switching when the game actually has content. On cancel we simply don't update
  // `data` — React restores the controlled <select> to the current type.
  const instanceHasQuestions = (inst: Record<string, unknown> | undefined): boolean => {
    const qs = inst?.questions as unknown;
    if (Array.isArray(qs)) return qs.length > 0;
    // quizjagd shape: { easy, medium, hard }
    if (qs && typeof qs === 'object') {
      return (['easy', 'medium', 'hard'] as const).some(d => {
        const arr = (qs as Record<string, unknown>)[d];
        return Array.isArray(arr) && arr.length > 0;
      });
    }
    return false;
  };
  const handleTypeChange = async (newType: GameType) => {
    if (newType === data.type) return;
    // Compatible types share a question shape (simple-quiz ↔ bet-quiz) — keep the
    // existing questions/instances and just switch the type, no warning needed.
    if (gameTypesShareQuestionShape(data.type as GameType, newType)) {
      setData({ ...data, type: newType });
      return;
    }
    const hasContent = isSingle
      ? instanceHasQuestions(data)
      : Object.entries(data.instances ?? {}).some(([k, inst]) => !isArchive(k) && instanceHasQuestions(inst as Record<string, unknown>));
    if (hasContent) {
      const ok = await confirmDialog({
        title: 'Spieltyp ändern?',
        description: 'Die vorhandenen Fragen passen möglicherweise nicht zum neuen Spieltyp und gehen beim Speichern verloren.',
        confirmLabel: 'Ändern',
        cancelLabel: 'Abbrechen',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    // Reset to the clean per-type template (keeping title + theme). Keeping the old
    // questions/instance structure would feed the new type's question form data it can't
    // render — which left the editor on a blank page. The template is a well-formed empty
    // game for the new type, so the form renders correctly and the next save validates.
     
    const reset: Record<string, any> = { ...GAME_TYPE_TEMPLATES[newType], title: data.title };
    if (data.theme) reset.theme = data.theme;
    setData(reset);
    setActiveInstance('v1');
  };

  // ── Spellcheck handlers ──
  const runSpellCheck = async () => {
    setSpellOpen(true);
    setSpellLoading(true);
    setSpellError(null);
    try {
      const segments = segmentsForCurrentInstance(data, activeInstance);
      const checkable = segments.filter(s => s.text.trim().length > 0);
      const results = await checkSpelling(checkable.map(s => ({ key: s.key, text: s.text })));
      const segByKey = new Map(checkable.map(s => [s.key, s]));
      const entries: { issue: SpellIssue; segKey: string; path: (string | number)[] }[] = [];
      for (const r of results) {
        const seg = segByKey.get(r.key);
        if (!seg) continue;
        for (const match of r.matches) {
          entries.push({
            issue: { id: `${r.key}::${match.offset}`, label: seg.label, text: seg.text, match },
            segKey: r.key,
            path: seg.path,
          });
        }
      }
      setSpellEntries(entries);
    } catch (err) {
      setSpellError(err instanceof ApiError && (err.status === 502 || err.status === 503)
        ? 'LanguageTool ist nicht erreichbar.'
        : (err instanceof Error ? err.message : 'Prüfung fehlgeschlagen.'));
      setSpellEntries([]);
    } finally {
      setSpellLoading(false);
    }
  };

  // ── Reusable spellcheck mutators (shared by the report panel + inline SpellField) ──
  const pathByKey = useMemo(() => {
    const m = new Map<string, (string | number)[]>();
    for (const e of spellEntries) if (!m.has(e.segKey)) m.set(e.segKey, e.path);
    return m;
  }, [spellEntries]);

  const matchesByKey = useMemo(() => {
    const m = new Map<string, SpellMatch[]>();
    for (const e of spellEntries) {
      const arr = m.get(e.segKey) ?? [];
      arr.push(e.issue.match);
      m.set(e.segKey, arr);
    }
    return m;
  }, [spellEntries]);

  const applySpellByKey = (segKey: string, match: SpellMatch, replacement: string) => {
    const path = pathByKey.get(segKey);
    if (!path) return;
    setData(applyReplacement(data, path, match.offset, match.length, replacement));
    // Drop every issue on the same field — their offsets are now stale.
    setSpellEntries(prev => prev.filter(e => e.segKey !== segKey));
  };

  const allowSpellWordValue = async (word: string) => {
    await spellcheck.allowWord(word);
    const norm = word.normalize('NFC').toLowerCase().trim();
    setSpellEntries(prev => prev.filter(e => {
      const w = e.issue.text.slice(e.issue.match.offset, e.issue.match.offset + e.issue.match.length);
      return w.normalize('NFC').toLowerCase().trim() !== norm;
    }));
  };

  const ignoreSpellFingerprint = async (fingerprint: string) => {
    await spellcheck.ignoreMatch(fingerprint);
    setSpellEntries(prev => prev.filter(e => e.issue.match.fingerprint !== fingerprint));
  };

  const handleSpellApply = (issue: SpellIssue, replacement: string) => {
    const entry = spellEntries.find(e => e.issue.id === issue.id);
    if (entry) applySpellByKey(entry.segKey, issue.match, replacement);
  };
  const handleSpellAllowWord = (issue: SpellIssue) =>
    void allowSpellWordValue(issue.text.slice(issue.match.offset, issue.match.offset + issue.match.length));
  const handleSpellIgnore = (issue: SpellIssue) => void ignoreSpellFingerprint(issue.match.fingerprint);

  const spellGroups: SpellGroup[] = [{ issues: spellEntries.map(e => e.issue) }];

  const spellCtxValue: SpellCheckCtxValue = {
    enabled: spellcheck.enabled && spellOpen,
    getMatches: (segKey) => matchesByKey.get(segKey) ?? [],
    apply: applySpellByKey,
    allowWord: (word) => void allowSpellWordValue(word),
    ignore: (fingerprint) => void ignoreSpellFingerprint(fingerprint),
  };

  return (
    <SpellCheckProvider value={spellCtxValue}>
      <div>
      <div className="editor-header">
        <div className="editor-header-side editor-header-side--left">
          <button className="be-icon-btn" onClick={onClose}>← Zurück</button>
        </div>
        <span className="editor-header-title">{data.title || fileName}</span>
        <div className="editor-header-side editor-header-side--right">
          {spellcheck.enabled && (
            <button
              className="be-icon-btn"
              onClick={() => { if (spellOpen) { setSpellOpen(false); } else { void runSpellCheck(); } }}
            >
              🔤 Rechtschreibung {spellOpen ? 'ausblenden' : 'prüfen'}
            </button>
          )}
          <span className="type-badge">{GAME_TYPE_INFO[data.type as GameType]?.label ?? data.type}</span>
        </div>
      </div>

      <StatusMessage message={message} />

      {conflict && (
        <ConflictBanner
          what="Dieses Spiel"
          onReload={() => adoptRemote(conflict.fresh)}
          onDismiss={() => setConflict(null)}
        />
      )}

      {/* Base metadata */}
      <div className="backend-card">
        <h3>Grundeinstellungen</h3>
        <div className="editor-title-row">
          <div>
            <label className="be-label">Titel</label>
            <SpellField segKey="title" className="be-input" value={data.title ?? ''} onChange={e => setData({ ...data, title: e.target.value })} onBlur={handleTitleBlur} disabled={renaming} />
            {data.title && slugifyGameName(data.title) !== fileName && (
              <span className="be-hint">Wird gespeichert als {slugifyGameName(data.title)}.json</span>
            )}
          </div>
          <div>
            <label className="be-label">Spieltyp</label>
            <select
              className="be-select"
              aria-label="Spieltyp"
              value={data.type ?? ''}
              onChange={e => void handleTypeChange(e.target.value as GameType)}
            >
              {(['simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess', 'q1', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess', 'colorguess', 'ranking', 'wer-kennt-mehr', 'random-frame'] as GameType[]).map(t => (
                <option key={t} value={t}>{GAME_TYPE_INFO[t].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="be-label">Theme-Override</label>
            <select
              className="be-select"
              aria-label="Theme-Override"
              value={data.theme ?? ''}
              onChange={e => setData({ ...data, theme: e.target.value || undefined })}
            >
              <option value="">–</option>
              {THEMES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="be-label" style={{ marginTop: 10 }}>Regeln</label>
        <RulesEditor
          rules={data.rules ?? []}
          onChange={rules => setData({ ...data, rules: rules.length > 0 ? rules : undefined })}
          taskLine
          presets={rulesPresets}
          activePresetId={typeof data.rulesPreset === 'string' ? data.rulesPreset : undefined}
          onPresetChange={id => setData({ ...data, rulesPreset: id })}
          extraCenter={data.type !== 'quizjagd' ? (
            <>
              <label className="be-toggle">
                <input
                  type="checkbox"
                  checked={(currentInstance.randomizeQuestions ?? data.randomizeQuestions) ?? false}
                  onChange={e => {
                    const value = e.target.checked || undefined;
                    if (!isSingle && currentInstance.randomizeQuestions !== undefined) {
                      updateInstance(activeInstance, { ...currentInstance, randomizeQuestions: value });
                    } else {
                      setData({ ...data, randomizeQuestions: value });
                    }
                  }}
                />
                <span className="be-toggle-track" />
                <span className="be-toggle-label">Fragen zufällig anordnen</span>
              </label>
              {data.type === 'wer-kennt-mehr' && (
                <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
                  <span className="be-toggle-label">Punktevergabe</span>
                  <select
                    className="be-select"
                    aria-label="Punktevergabe"
                    style={{ flex: '1 1 220px', width: 'auto', minWidth: 0 }}
                    value={data.scoringMode ?? 'standard'}
                    onChange={e => {
                      const value = e.target.value;
                      setData({ ...data, scoringMode: value === 'standard' ? undefined : (value as 'count' | 'count-penalty') });
                    }}
                  >
                    <option value="standard">Standard (Punkte nach Spielreihenfolge)</option>
                    <option value="count">Trefferzahl als Punkte</option>
                    <option value="count-penalty">Trefferzahl als Punkte – Verlierer verliert die Punkte</option>
                  </select>
                </label>
              )}
            </>
          ) : undefined}
          extra={data.type !== 'quizjagd' ? (
            <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="be-toggle-label">Fragen limitieren auf</span>
              <input
                type="number"
                min={1}
                className="be-input"
                style={{ width: 70 }}
                value={(currentInstance.questionLimit ?? data.questionLimit) ?? ''}
                placeholder="–"
                onChange={e => {
                  const parsed = e.target.value ? parseInt(e.target.value, 10) : undefined;
                  const value = parsed && parsed > 0 ? parsed : undefined;
                  if (!isSingle && currentInstance.questionLimit !== undefined) {
                    updateInstance(activeInstance, { ...currentInstance, questionLimit: value });
                  } else {
                    setData({ ...data, questionLimit: value });
                  }
                }}
              />
            </label>
          ) : undefined}
        />
      </div>

      {/* Instance tabs. Rendered for single-instance games too, so the "+ Instanz" button is
          reachable — clicking it converts the game to multi-instance. */}
      <div className="instance-tabs">
        <div className="instance-tabs-left">
          {(isSingle ? [] : instances).map((key, i) => (
              renamingInstance === key ? (
                <input
                  key={key}
                  className="instance-tab-btn active instance-tab-rename"
                  defaultValue={key}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameInstance(key, (e.target as HTMLInputElement).value);
                    if (e.key === 'Escape') setRenamingInstance(null);
                  }}
                  onBlur={e => renameInstance(key, e.target.value)}
                />
              ) : (
                <button
                  key={key}
                  className={`instance-tab-btn ${activeInstance === key ? 'active' : ''}`}
                  draggable
                  onDragStart={onTabDragStart(i)}
                  onDragOver={onTabDragOver(i)}
                  onDragEnd={onTabDragEnd}
                  onClick={() => activeInstance === key ? setRenamingInstance(key) : switchInstance(key)}
                >
                  {key}
                </button>
              )
            ))}
            <button className="instance-tab-btn" onClick={handleAddInstance} disabled={converting}>
              {converting ? '…' : '+ Instanz'}
            </button>
          </div>
          {archiveKey && (
            <button
              className={`instance-tab-btn instance-tab-archive ${activeInstance === archiveKey ? 'active' : ''}`}
              onClick={() => switchInstance(archiveKey)}
            >
              Archiv
            </button>
          )}
        </div>

      {/* Instance editor */}
      <div className="backend-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{isSingle ? 'Inhalte' : archiveKey && activeInstance === archiveKey ? 'Archiv' : `Instanz: ${activeInstance}`}</h3>
            {isVideoGuessLockable && (
              <button
                className="be-icon-btn"
                onClick={handleLockToggle}
                disabled={unlockPending}
                title={locked
                  ? 'Instanz gesperrt — klicken zum Entsperren. Cache wird bei Saves nicht verworfen.'
                  : 'Sperren: Marker + Fragen einfrieren, Cache wird nicht verworfen.'}
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--admin-sz-12, 12px)',
                  background: locked ? 'rgba(251, 146, 60, 0.18)' : 'transparent',
                  border: locked ? '1px solid rgba(251, 146, 60, 0.45)' : '1px solid rgba(var(--glass-rgb), 0.15)',
                  color: locked ? 'var(--warning, #fb923c)' : 'rgba(var(--text-rgb), max(0.55, var(--text-fade-floor, 0)))',
                }}
              >
                {unlockPending ? '…' : locked ? '🔒' : '🔓'}
              </button>
            )}
          </div>
          {!isSingle && instances.length > 1 && !isArchive(activeInstance) && (
            <button className="be-icon-btn danger" onClick={() => deleteInstance(activeInstance)}>
              Instanz löschen
            </button>
          )}
        </div>
        {unlockWarning && (
          <div className="modal-overlay" onClick={() => setUnlockWarning(null)}>
            <div
              className="modal-box"
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              style={{ maxWidth: 520 }}
            >
              <h3 style={{ margin: '0 0 12px' }}>Nicht erreichbare Quelldateien</h3>
              <p style={{ margin: '0 0 8px' }}>Folgende Dateien sind aktuell nicht erreichbar:</p>
              <ul style={{ margin: '0 0 12px 16px', maxHeight: 240, overflowY: 'auto' }}>
                {unlockWarning.offlineReferences.map(p => (
                  <li key={`r-${p}`}><code>{p}</code> <span style={{ opacity: 0.7, fontSize: 11 }}>(Referenz offline)</span></li>
                ))}
                {unlockWarning.missing.map(p => (
                  <li key={`m-${p}`}><code>{p}</code> <span style={{ opacity: 0.7, fontSize: 11 }}>(fehlt)</span></li>
                ))}
              </ul>
              <p style={{ margin: '0 0 16px', fontSize: 'var(--admin-sz-13, 13px)' }}>
                Nach dem Entsperren können Marker geändert werden. Wenn Caches dadurch invalidiert und
                keine Quelldateien erreichbar sind, fehlen sie im Spiel.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="be-icon-btn" onClick={() => setUnlockWarning(null)}>Abbrechen</button>
                <button
                  className="be-icon-btn"
                  style={{ background: 'rgba(251, 146, 60, 0.2)', border: '1px solid rgba(251, 146, 60, 0.55)' }}
                  onClick={confirmUnlock}
                >
                  Trotzdem entsperren
                </button>
              </div>
            </div>
          </div>
        )}
        {!isArchive(activeInstance) && data.type !== 'quizjagd' && Array.isArray(currentInstance.questions) && currentInstance.questions.length > 2 && (
          <button className="be-icon-btn" style={{ marginBottom: 10 }} onClick={() => {
            const qs = [...currentInstance.questions];
            const rest = qs.slice(1);
            for (let i = rest.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [rest[i], rest[j]] = [rest[j], rest[i]];
            }
            updateInstance(activeInstance, { ...currentInstance, questions: [qs[0], ...rest] });
          }}>
            🔀 Fragen mischen
          </button>
        )}
        <InstanceEditor
          gameType={data.type as GameType}
          instance={currentInstance}
          onChange={inst => updateInstance(activeInstance, inst)}
          onGoToAssets={onGoToAssets}
          otherInstances={otherInstances}
          onMoveQuestion={otherInstances.length > 0 ? moveQuestion : undefined}
          isArchive={isArchive(activeInstance)}
          initialQuestion={initialQuestion}
        />
      </div>

      {spellcheck.enabled && spellOpen && (
        <div className="backend-card">
          <h3>Rechtschreibung &amp; Grammatik</h3>
          <SpellCheckPanel
            groups={spellGroups}
            loading={spellLoading}
            error={spellError}
            onApply={handleSpellApply}
            onAllowWord={handleSpellAllowWord}
            onIgnore={handleSpellIgnore}
          />
        </div>
      )}
      </div>
    </SpellCheckProvider>
  );
}
