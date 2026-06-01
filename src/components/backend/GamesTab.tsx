import { useState, useEffect, useRef } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import type { GameFileSummary, GameType } from '@/types/config';
import { fetchGames, fetchGame, createGame, createExampleGames, deleteGame } from '@/services/backendApi';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';
import GameEditor from './GameEditor';
import StatusMessage from './StatusMessage';
import { slugifyGameName } from './slugifyGameName';
import { useConfirm } from './ConfirmContext';

const GAME_TYPE_TEMPLATES: Record<GameType, object> = {
  'simple-quiz': { type: 'simple-quiz', rules: [], instances: { v1: { questions: [] } } },
  'bet-quiz': { type: 'bet-quiz', rules: [], instances: { v1: { questions: [] } } },
  'guessing-game': { type: 'guessing-game', rules: [], instances: { v1: { questions: [] } } },
  'final-quiz': { type: 'final-quiz', rules: [], instances: { v1: { questions: [] } } },
  'audio-guess': { type: 'audio-guess', rules: [], instances: { v1: { questions: [] } } },
  'video-guess': { type: 'video-guess', rules: [], instances: { v1: { questions: [] } } },
  'q1': { type: 'q1', rules: [], instances: { v1: { questions: [] } } },
  'four-statements': { type: 'four-statements', rules: [], instances: { v1: { questions: [] } } },
  'fact-or-fake': { type: 'fact-or-fake', rules: [], instances: { v1: { questions: [] } } },
  'quizjagd': { type: 'quizjagd', rules: [], instances: { v1: { questions: [], questionsPerTeam: 10 } } },
  'bandle': { type: 'bandle', rules: [], instances: { v1: { questions: [] } } },
  'image-guess': { type: 'image-guess', rules: [], instances: { v1: { questions: [] } } },
  'colorguess': { type: 'colorguess', rules: [], instances: { v1: { questions: [] } } },
  'ranking': { type: 'ranking', rules: [], instances: { v1: { questions: [] } } },
};

interface NewGameModalProps {
  onCancel: () => void;
  onCreate: (fileName: string, title: string, type: GameType) => void;
}

function NewGameModal({ onCancel, onCreate }: NewGameModalProps) {
  const [gameName, setGameName] = useState('');
  const [selectedType, setSelectedType] = useState<GameType>('simple-quiz');

  const derived = slugifyGameName(gameName);

  const GAME_TYPES: GameType[] = ['simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess', 'q1', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess', 'colorguess', 'ranking'];

  const submit = () => {
    if (derived) onCreate(derived, gameName.trim(), selectedType);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal-box"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); submit(); }}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      >
        <h2>Neues Spiel erstellen</h2>

        <label className="be-label">Name</label>
        <input
          className="be-input"
          value={gameName}
          onChange={e => setGameName(e.target.value)}
          placeholder="Mein neues Spiel"
          autoFocus
        />
        <label className="be-label" style={{ marginTop: 14 }}>Spieltyp</label>
        <div className="game-type-grid">
          {GAME_TYPES.map(type => (
            <button
              key={type}
              type="button"
              className={`game-type-option ${selectedType === type ? 'selected' : ''}`}
              onClick={() => setSelectedType(type)}
              data-tooltip={GAME_TYPE_INFO[type].description}
            >
              {GAME_TYPE_INFO[type].label}
            </button>
          ))}
        </div>

        <div className="be-actions">
          <button type="button" className="admin-button secondary" onClick={onCancel}>Abbrechen</button>
          <button
            type="submit"
            className="admin-button primary"
            disabled={!derived}
          >
            Erstellen
          </button>
        </div>
      </form>
    </div>
  );
}

interface Props {
  onGoToAssets: () => void;
  initialFile?: string;
  initialInstance?: string;
  initialQuestion?: number;
  onNavigate: (file: string | null, instance?: string) => void;
}

export default function GamesTab({ onGoToAssets, initialFile, initialInstance, initialQuestion, onNavigate }: Props) {
  const confirmDialog = useConfirm();

  const [games, setGames] = useState<GameFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingExamples, setCreatingExamples] = useState(false);
  const [search, setSearch] = useState('');
  // Capture initialQuestion in a ref so it survives onNavigate clearing the parent state
  const questionRef = useRef(initialQuestion);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingData, setEditingData] = useState<Record<string, any> | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    fetchGames()
      .then(setGames)
      .catch(e => showMsg('error', `Fehler: ${e.message}`))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Restore editor state on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialFile) openEditor(initialFile, initialInstance); }, []);

  // Sync with parent navigation (browser back/forward)
  useEffect(() => {
    if (!initialFile && editingFile) {
      // Back to games list
      setEditingFile(null);
      setEditingData(null);
      load();
    } else if (initialFile && initialFile !== editingFile) {
      // Back/forward to a different game
      openEditor(initialFile, initialInstance);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const openEditor = async (fileName: string, instance?: string) => {
    try {
      const data = await fetchGame(fileName);
      setEditingData(data as Record<string, unknown>);
      setEditingFile(fileName);
      onNavigate(fileName, instance);
    } catch (e) {
      showMsg('error', `Fehler beim Laden: ${(e as Error).message}`);
    }
  };

  const handleInstanceChange = (instance: string) => {
    if (editingFile) onNavigate(editingFile, instance);
  };

  const handleDelete = async (fileName: string) => {
    if (!(await confirmDialog({ title: `Spiel "${fileName}" wirklich löschen?` }))) return;
    try {
      const result = await deleteGame(fileName);
      const removedCount = result?.removedRefs?.length ?? 0;
      const suffix = removedCount
        ? ` — aus ${removedCount} Gameshow-Verweis(en) entfernt`
        : '';
      showMsg('success', `🗑️ "${fileName}" gelöscht${suffix}`);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  const handleCreate = async (fileName: string, title: string, type: GameType) => {
    try {
      const template = { ...GAME_TYPE_TEMPLATES[type], title };
      await createGame(fileName, template);
      setShowNewModal(false);
      const data = await fetchGame(fileName);
      setEditingData(data as Record<string, unknown>);
      setEditingFile(fileName);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    }
  };

  const handleCreateExamples = async () => {
    setCreatingExamples(true);
    try {
      const result = await createExampleGames();
      showMsg('success', `✅ ${result.createdGames.length} Beispiele erstellt`);
      load();
    } catch (e) {
      showMsg('error', `❌ ${(e as Error).message}`);
    } finally {
      setCreatingExamples(false);
    }
  };

  const handleRename = (newFileName: string) => {
    setEditingFile(newFileName);
    onNavigate(newFileName);
    load();
  };

  if (editingFile && editingData) {
    return (
      <GameEditor
        fileName={editingFile}
        initialData={editingData}
        initialInstance={initialInstance}
        initialQuestion={questionRef.current}
        onInstanceChange={handleInstanceChange}
        onClose={() => { setEditingFile(null); setEditingData(null); onNavigate(null); load(); }}
        onGoToAssets={onGoToAssets}
        onRename={handleRename}
      />
    );
  }

  return (
    <div>
      <StatusMessage message={message} />

      <div className="tab-toolbar" style={{ marginBottom: 10 }}>
        <h2 className="tab-title">Spiele</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="be-input"
            style={{ width: 200 }}
            placeholder="Suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const filtered = games.filter(g => !search || g.title.toLowerCase().includes(search.toLowerCase()) || g.fileName.toLowerCase().includes(search.toLowerCase()));
                if (filtered.length === 1) openEditor(filtered[0].fileName);
              }
            }}
            autoFocus={!isTouchDevice()}
          />
          <button className="admin-button primary" style={{ marginTop: 0 }} onClick={() => setShowNewModal(true)}>
            + Neues Spiel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="be-loading">Lade Spiele...</div>
      ) : games.length === 0 ? (
        <div className="be-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <p style={{ margin: 0 }}>Noch keine Spiele vorhanden.</p>
          <button
            className="admin-button primary"
            onClick={handleCreateExamples}
            disabled={creatingExamples}
          >
            {creatingExamples ? 'Erstelle Beispiele…' : 'Beispiele erstellen'}
          </button>
          <p style={{ margin: 0, fontSize: 'clamp(0.8rem, 1.6vw, 0.9rem)', opacity: 0.7, maxWidth: 420, textAlign: 'center' }}>
            Legt für jede Spielart ein Beispielspiel mit echten Fragen an – inklusive selbst erzeugter, lizenzfreier Bilder und Musik.
          </p>
        </div>
      ) : (
        <div className="games-list">
          <div className="games-list-header">
            <span style={{ flex: 1 }}>Titel</span>
            <span style={{ width: 240 }}>Typ</span>
            <span style={{ width: 120 }}>Instanzen</span>
            <span style={{ width: 32 }}></span>
          </div>
          {games.filter(g => !search || g.title.toLowerCase().includes(search.toLowerCase()) || g.fileName.toLowerCase().includes(search.toLowerCase())).map(game => (
            <div
              key={game.fileName}
              className={`games-list-row${game.parseError ? ' games-list-row--error' : ''}`}
              onClick={() => !game.parseError && openEditor(game.fileName)}
              title={game.parseError ? `JSON-Fehler: ${game.parseError}` : undefined}
            >
              <span className="games-list-title">
                {game.title}
                {game.parseError && <span className="parse-error-badge">JSON-Fehler</span>}
              </span>
              <span style={{ width: 240, flexShrink: 0, minWidth: 0, overflow: 'hidden' }}><span className="type-badge" title={GAME_TYPE_INFO[game.type]?.label ?? game.type}>{game.parseError ? 'fehler' : (GAME_TYPE_INFO[game.type]?.label ?? game.type)}</span></span>
              <span className="games-list-instances">
                {game.isSingleInstance ? '—' : game.instances.filter(i => i !== 'template').join(', ')}
              </span>
              <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, flexShrink: 0 }}>
                <button className="be-delete-btn" onClick={() => handleDelete(game.fileName)} title="Löschen">🗑</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {showNewModal && (
        <NewGameModal
          onCancel={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
