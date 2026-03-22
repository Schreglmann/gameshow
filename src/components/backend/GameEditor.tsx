import { useState, useEffect, useRef } from 'react';
import type { GameType } from '@/types/config';
import { saveGame } from '@/services/backendApi';
import RulesEditor from './RulesEditor';
import InstanceEditor from './InstanceEditor';
import StatusMessage from './StatusMessage';

interface Props {
  fileName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: Record<string, any>;
  initialInstance?: string;
  onClose: () => void;
  onGoToAssets: () => void;
  onInstanceChange?: (instance: string) => void;
}

export default function GameEditor({ fileName, initialData, initialInstance, onClose, onGoToAssets, onInstanceChange }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<Record<string, any>>(initialData);
  const [activeInstance, setActiveInstance] = useState<string>(() => {
    if (data.instances) {
      const keys = Object.keys(data.instances).filter(k => k !== 'template');
      if (initialInstance && keys.includes(initialInstance)) return initialInstance;
      return keys[0] ?? '';
    }
    return '__single__';
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevData = useRef(data);
  const prevFileName = useRef(fileName);

  const isSingle = !data.instances;

  useEffect(() => {
    if (activeInstance && activeInstance !== '__single__') onInstanceChange?.(activeInstance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInstance]);
  const instances: string[] = isSingle ? ['__single__'] : Object.keys(data.instances).filter(k => k !== 'template');

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  useEffect(() => {
    if (data === prevData.current && fileName === prevFileName.current) return;
    prevData.current = data;
    prevFileName.current = fileName;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveGame(fileName, data);
        showMsg('success', '✅ Gespeichert!');
      } catch (e) {
        showMsg('error', `❌ ${(e as Error).message}`);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, fileName]);

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
    setActiveInstance(key);
  };

  const deleteInstance = (key: string) => {
    if (!confirm(`Instanz "${key}" wirklich löschen?`)) return;
    const { [key]: _, ...rest } = data.instances;
    setData({ ...data, instances: rest });
    setActiveInstance(Object.keys(rest)[0] ?? '');
  };

  const [renamingInstance, setRenamingInstance] = useState<string | null>(null);

  const renameInstance = (oldKey: string, newKey: string) => {
    const trimmed = newKey.trim();
    setRenamingInstance(null);
    if (!trimmed || trimmed === oldKey) return;
    if (data.instances[trimmed]) return;
    const renamed = Object.fromEntries(
      Object.entries(data.instances).map(([k, v]) => [k === oldKey ? trimmed : k, v])
    );
    setData({ ...data, instances: renamed });
    setActiveInstance(trimmed);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentInstance: Record<string, any> = isSingle
    ? data
    : (data.instances[activeInstance] ?? {});

  return (
    <div>
      <div className="editor-header">
        <button className="be-icon-btn" onClick={onClose}>← Zurück</button>
        <span className="editor-header-title">{data.title || fileName}</span>
        <span className="type-badge">{data.type}</span>
      </div>

      <StatusMessage message={message} />

      {/* Base metadata */}
      <div className="backend-card">
        <h3>Grundeinstellungen</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '0 10px', alignItems: 'start' }}>
          <div>
            <label className="be-label">Titel</label>
            <input className="be-input" value={data.title ?? ''} onChange={e => setData({ ...data, title: e.target.value })} />
          </div>
          <div>
            <label className="be-label">Spieltyp</label>
            <select
              className="be-select"
              value={data.type ?? ''}
              onChange={e => setData({ ...data, type: e.target.value as GameType })}
            >
              {(['simple-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'four-statements', 'fact-or-fake', 'quizjagd'] as GameType[]).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="be-label" style={{ marginTop: 10 }}>Regeln</label>
        <RulesEditor
          rules={data.rules ?? []}
          onChange={rules => setData({ ...data, rules: rules.length > 0 ? rules : undefined })}
        />

        <label className="be-checkbox-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={data.randomizeQuestions ?? false}
            onChange={e => setData({ ...data, randomizeQuestions: e.target.checked || undefined })}
          />
          Fragen zufällig anordnen
        </label>
      </div>

      {/* Instance tabs */}
      {!isSingle && (
        <div className="instance-tabs">
          {instances.map(key => (
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
                onClick={() => activeInstance === key ? setRenamingInstance(key) : setActiveInstance(key)}
              >
                {key}
              </button>
            )
          ))}
          <button className="instance-tab-btn" onClick={addInstance}>+ Instanz</button>
        </div>
      )}

      {/* Instance editor */}
      <div className="backend-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{isSingle ? 'Inhalte' : `Instanz: ${activeInstance}`}</h3>
          {!isSingle && instances.length > 1 && (
            <button className="be-icon-btn danger" onClick={() => deleteInstance(activeInstance)}>
              Instanz löschen
            </button>
          )}
        </div>
        <InstanceEditor
          gameType={data.type as GameType}
          instance={currentInstance}
          onChange={inst => updateInstance(activeInstance, inst)}
          onGoToAssets={onGoToAssets}
        />
      </div>
    </div>
  );
}
