import { useState, useEffect, useRef } from 'react';
import type { GameFileSummary, GameType } from '@/types/config';
import { fetchGames, fetchGame, createGame, deleteGame } from '@/services/backendApi';
import { useGameContext } from '@/context/GameContext';
import GameEditor from './GameEditor';
import StatusMessage from './StatusMessage';
import { slugifyGameName } from './slugifyGameName';

const GAME_TYPE_TEMPLATES: Record<GameType, object> = {
  'simple-quiz': { type: 'simple-quiz', title: 'Neues Quiz', rules: [], instances: { v1: { questions: [] } } },
  'bet-quiz': { type: 'bet-quiz', title: 'Neues Einsatzquiz', rules: [], instances: { v1: { questions: [] } } },
  'guessing-game': { type: 'guessing-game', title: 'Neues Ratespiel', rules: [], instances: { v1: { questions: [] } } },
  'final-quiz': { type: 'final-quiz', title: 'Neues Finalquiz', rules: [], instances: { v1: { questions: [] } } },
  'audio-guess': { type: 'audio-guess', title: 'Neues Audio-Guess', rules: [], instances: { v1: { questions: [] } } },
  'video-guess': { type: 'video-guess', title: 'Neues Video-Guess', rules: [], instances: { v1: { questions: [] } } },
  'four-statements': { type: 'four-statements', title: 'Neues Four-Statements', rules: [], instances: { v1: { questions: [] } } },
  'fact-or-fake': { type: 'fact-or-fake', title: 'Neues Fact-or-Fake', rules: [], instances: { v1: { questions: [] } } },
  'quizjagd': { type: 'quizjagd', title: 'Neue Quizjagd', rules: [], instances: { v1: { questions: [], questionsPerTeam: 10 } } },
  'bandle': { type: 'bandle', title: 'Neues Bandle', rules: [], instances: { v1: { questions: [] } } },
  'image-guess': { type: 'image-guess', title: 'Neues Image-Guess', rules: [], instances: { v1: { questions: [] } } },
};

interface NewGameModalProps {
  onCancel: () => void;
  onCreate: (fileName: string, title: string, type: GameType) => void;
}

function NewGameModal({ onCancel, onCreate }: NewGameModalProps) {
  const [gameName, setGameName] = useState('');
  const [selectedType, setSelectedType] = useState<GameType>('simple-quiz');

  const derived = slugifyGameName(gameName);

  const GAME_TYPES: GameType[] = ['simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess'];

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
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
              className={`game-type-option ${selectedType === type ? 'selected' : ''}`}
              onClick={() => setSelectedType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="be-actions">
          <button className="admin-button secondary" onClick={onCancel}>Abbrechen</button>
          <button
            className="admin-button primary"
            disabled={!derived}
            onClick={() => derived && onCreate(derived, gameName.trim(), selectedType)}
          >
            Erstellen
          </button>
        </div>
      </div>
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
  const { state } = useGameContext();
  // In clean-install mode (fresh clone without git-crypt key), show the
  // _template-*.json files so the user has starter games to edit.
  // See specs/clean-install.md.
  const showTemplates = state.settings.isCleanInstall;
  const isVisible = (fileName: string) => showTemplates || !fileName.startsWith('_');

  const [games, setGames] = useState<GameFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!confirm(`Spiel "${fileName}" wirklich löschen?`)) return;
    try {
      await deleteGame(fileName);
      showMsg('success', `🗑️ "${fileName}" gelöscht`);
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
                const filtered = games.filter(g => isVisible(g.fileName) && (!search || g.title.toLowerCase().includes(search.toLowerCase()) || g.fileName.toLowerCase().includes(search.toLowerCase())));
                if (filtered.length === 1) openEditor(filtered[0].fileName);
              }
            }}
            autoFocus
          />
          <button className="admin-button primary" style={{ marginTop: 0 }} onClick={() => setShowNewModal(true)}>
            + Neues Spiel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="be-loading">Lade Spiele...</div>
      ) : games.length === 0 ? (
        <div className="be-empty">Keine Spiele gefunden</div>
      ) : (
        <div className="games-list">
          <div className="games-list-header">
            <span style={{ flex: 1 }}>Titel</span>
            <span style={{ width: 130 }}>Typ</span>
            <span style={{ width: 120 }}>Instanzen</span>
            <span style={{ width: 32 }}></span>
          </div>
          {games.filter(g => isVisible(g.fileName) && (!search || g.title.toLowerCase().includes(search.toLowerCase()) || g.fileName.toLowerCase().includes(search.toLowerCase()))).map(game => (
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
              <span style={{ width: 130, flexShrink: 0 }}><span className="type-badge">{game.parseError ? 'fehler' : game.type}</span></span>
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
