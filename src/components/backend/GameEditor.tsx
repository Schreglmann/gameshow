import { useState, useEffect, useRef } from 'react';
import type { GameType } from '@/types/config';
import { THEMES } from '@/context/ThemeContext';
import { saveGame, renameGame, unlockPrecheck } from '@/services/backendApi';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';
import RulesEditor from './RulesEditor';
import InstanceEditor from './InstanceEditor';
import StatusMessage from './StatusMessage';
import { useDragReorder } from './useDragReorder';
import { slugifyGameName } from './slugifyGameName';

interface Props {
  fileName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: Record<string, any>;
  initialInstance?: string;
  initialQuestion?: number;
  onClose: () => void;
  onGoToAssets: () => void;
  onInstanceChange?: (instance: string) => void;
  onRename?: (newFileName: string) => void;
}

export default function GameEditor({ fileName, initialData, initialInstance, initialQuestion, onClose, onGoToAssets, onInstanceChange, onRename }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevData = useRef(data);
  const prevFileName = useRef(fileName);
  // Serialization state for the auto-save: `saveInFlight` guards against starting a second
  // PUT while the first is still running, and `pendingSave` stashes the latest payload so
  // it's flushed after the in-flight request returns. Without this, a fast edit after a
  // save started (e.g. a drag-reorder that finished 800 ms after a previous one) could
  // produce overlapping PUTs whose server-side renames arrive out of order.
  const saveInFlight = useRef(false);
  const pendingSave = useRef<{ fileName: string; data: Record<string, unknown> } | null>(null);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const deleteInstance = (key: string) => {
    if (isArchive(key)) return;
    if (!confirm(`Instanz "${key}" wirklich löschen?`)) return;
    const { [key]: _, ...rest } = data.instances;
    setData({ ...data, instances: rest });
    const nextKey = Object.keys(rest).filter(k => k !== 'template' && !isArchive(k))[0] ?? '';
    switchInstance(nextKey);
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
      try { await saveGame(fileName, data); } catch { /* rename will fail if save fails */ }
    }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      showMsg('success', '✅ Gespeichert!');
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  return (
    <div>
      <div className="editor-header">
        <button className="be-icon-btn" onClick={onClose}>← Zurück</button>
        <span className="editor-header-title">{data.title || fileName}</span>
        <span className="type-badge">{GAME_TYPE_INFO[data.type as GameType]?.label ?? data.type}</span>
      </div>

      <StatusMessage message={message} />

      {/* Base metadata */}
      <div className="backend-card">
        <h3>Grundeinstellungen</h3>
        <div className="editor-title-row">
          <div>
            <label className="be-label">Titel</label>
            <input className="be-input" value={data.title ?? ''} onChange={e => setData({ ...data, title: e.target.value })} onBlur={handleTitleBlur} disabled={renaming} />
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
              onChange={e => setData({ ...data, type: e.target.value as GameType })}
            >
              {(['simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess', 'q1', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess', 'colorguess', 'ranking'] as GameType[]).map(t => (
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
          extra={data.type !== 'quizjagd' ? (
            <>
              <label className="be-toggle">
                <input
                  type="checkbox"
                  checked={data.randomizeQuestions ?? false}
                  onChange={e => setData({ ...data, randomizeQuestions: e.target.checked || undefined })}
                />
                <span className="be-toggle-track" />
                <span className="be-toggle-label">Fragen zufällig anordnen</span>
              </label>
              <label className="be-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="be-toggle-label">Fragen limitieren auf</span>
                <input
                  type="number"
                  min={1}
                  className="be-input"
                  style={{ width: 70 }}
                  value={data.questionLimit ?? ''}
                  placeholder="–"
                  onChange={e => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                    setData({ ...data, questionLimit: val && val > 0 ? val : undefined });
                  }}
                />
              </label>
            </>
          ) : undefined}
        />
      </div>

      {/* Instance tabs */}
      {!isSingle && (
        <div className="instance-tabs">
          <div className="instance-tabs-left">
            {instances.map((key, i) => (
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
            <button className="instance-tab-btn" onClick={addInstance}>+ Instanz</button>
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
      )}

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
                  border: locked ? '1px solid rgba(251, 146, 60, 0.45)' : '1px solid rgba(255,255,255,0.15)',
                  color: locked ? 'rgba(251, 146, 60, 1)' : 'rgba(255,255,255,0.55)',
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
    </div>
  );
}
