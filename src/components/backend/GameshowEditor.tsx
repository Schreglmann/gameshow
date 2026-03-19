import { useState, useEffect, useRef } from 'react';
import type { GameshowConfig, GameFileSummary } from '@/types/config';
import { fetchGames } from '@/services/backendApi';
import { useDragReorder } from './useDragReorder';

// ── Searchable game combobox ──────────────────────────────────────────────────

interface ComboboxProps {
  games: GameFileSummary[];
  value: string;        // selected fileName
  onChange: (fileName: string) => void;
  placeholder?: string;
}

function GameCombobox({ games, value, onChange, placeholder = 'Spiel suchen...' }: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = games.find(g => g.fileName === value);
  const displayValue = open ? query : (selected ? selected.title : '');

  const filtered = games.filter(g =>
    !query ||
    g.title.toLowerCase().includes(query.toLowerCase()) ||
    g.fileName.toLowerCase().includes(query.toLowerCase())
  );

  const select = (fileName: string) => {
    onChange(fileName);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="game-combobox">
      <input
        ref={inputRef}
        className="be-input"
        value={displayValue}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <div className="game-combobox-dropdown">
          {filtered.length === 0 ? (
            <div className="game-combobox-empty">Keine Treffer</div>
          ) : (
            filtered.map(g => (
              <button
                key={g.fileName}
                className={`game-combobox-item ${g.fileName === value ? 'selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); select(g.fileName); }}
              >
                <span className="game-combobox-title">{g.title}</span>
                <span className="game-combobox-file">{g.fileName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  id: string;
  gameshow: GameshowConfig;
  isActive: boolean;
  onSetActive: () => void;
  onChange: (updated: GameshowConfig) => void;
  onDelete: () => void;
}

export default function GameshowEditor({ id, gameshow, isActive, onSetActive, onChange, onDelete }: Props) {
  const [availableGames, setAvailableGames] = useState<GameFileSummary[]>([]);
  const [pickGame, setPickGame] = useState('');
  const [pickInstance, setPickInstance] = useState('');
  const drag = useDragReorder(gameshow.gameOrder, order => onChange({ ...gameshow, gameOrder: order }));

  useEffect(() => {
    fetchGames().then(setAvailableGames).catch(() => {});
  }, []);

  const pickedGameData = availableGames.find(g => g.fileName === pickGame);
  const pickIsSingle = pickedGameData?.isSingleInstance ?? false;

  const addGame = () => {
    if (!pickGame) return;
    if (!pickIsSingle && !pickInstance) return;
    const ref = pickIsSingle ? pickGame : `${pickGame}/${pickInstance}`;
    onChange({ ...gameshow, gameOrder: [...gameshow.gameOrder, ref] });
    setPickGame('');
    setPickInstance('');
  };

  const updateEntry = (i: number, newGame: string, newInstance: string) => {
    const gameData = availableGames.find(g => g.fileName === newGame);
    const isSingle = gameData?.isSingleInstance ?? false;
    const ref = !newGame ? '' : isSingle ? newGame : newInstance ? `${newGame}/${newInstance}` : newGame;
    const order = [...gameshow.gameOrder];
    order[i] = ref;
    onChange({ ...gameshow, gameOrder: order });
  };

  return (
    <div className="backend-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          className="be-input"
          style={{ flex: 1, fontSize: 14, fontWeight: 600 }}
          value={gameshow.name}
          onChange={e => onChange({ ...gameshow, name: e.target.value })}
          placeholder="Gameshow-Name"
        />
        {isActive ? (
          <span className="gs-active-badge">✓ Aktiv</span>
        ) : (
          <button className="be-icon-btn" onClick={onSetActive}>Als aktiv setzen</button>
        )}
        <button className="be-delete-btn" onClick={onDelete} title="Gameshow löschen">🗑</button>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
        ID: <code style={{ color: 'rgba(255,255,255,0.55)' }}>{id}</code>
        &nbsp;·&nbsp; {gameshow.gameOrder.length} Spiel{gameshow.gameOrder.length !== 1 ? 'e' : ''}
      </div>

      {/* Game order list */}
      {gameshow.gameOrder.length === 0 ? (
        <div className="be-empty" style={{ padding: '12px 0' }}>Keine Spiele — füge unten welche hinzu</div>
      ) : (
        gameshow.gameOrder.map((ref, i) => {
          const slashIdx = ref.indexOf('/');
          const gameName = slashIdx >= 0 ? ref.slice(0, slashIdx) : ref;
          const instance = slashIdx >= 0 ? ref.slice(slashIdx + 1) : '';
          const gameData = availableGames.find(g => g.fileName === gameName);
          const isSingle = gameData?.isSingleInstance ?? false;

          return (
            <div
              key={i}
              className={`be-list-row ${drag.overIdx === i ? 'be-dragging' : ''}`}
              draggable
              onDragStart={drag.onDragStart(i)}
              onDragOver={drag.onDragOver(i)}
              onDragEnd={drag.onDragEnd}
            >
              <span className="drag-handle">⠿</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, minWidth: 22, flexShrink: 0 }}>{i + 1}.</span>
              <GameCombobox
                games={availableGames}
                value={gameName}
                onChange={newGame => updateEntry(i, newGame, instance)}
              />
              {gameName && !isSingle && (
                <select
                  className="be-select"
                  style={{ width: 90, flexShrink: 0 }}
                  value={instance}
                  onChange={e => updateEntry(i, gameName, e.target.value)}
                >
                  <option value="">Instanz...</option>
                  {(gameData?.instances ?? []).filter(i => i !== 'template').map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              )}
              <button
                className="be-delete-btn"
                onClick={() => { if (confirm('Spiel aus der Liste entfernen?')) onChange({ ...gameshow, gameOrder: gameshow.gameOrder.filter((_, idx) => idx !== i) }); }}
                title="Entfernen"
              >🗑</button>
            </div>
          );
        })
      )}

      {/* Add new game */}
      <div className="gs-picker-row">
        <GameCombobox
          games={availableGames}
          value={pickGame}
          onChange={game => { setPickGame(game); setPickInstance(''); }}
          placeholder="Spiel hinzufügen..."
        />
        {pickGame && !pickIsSingle && (
          <select
            className="be-select"
            style={{ width: 100, flexShrink: 0 }}
            value={pickInstance}
            onChange={e => setPickInstance(e.target.value)}
          >
            <option value="">Instanz...</option>
            {(pickedGameData?.instances ?? []).filter(i => i !== 'template').map(inst => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
        )}
        <button
          className="be-icon-btn"
          onClick={addGame}
          disabled={!pickGame || (!pickIsSingle && !pickInstance)}
        >
          + Hinzufügen
        </button>
      </div>
    </div>
  );
}
