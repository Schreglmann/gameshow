import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameshowConfig, GameFileSummary } from '@/types/config';
import { fetchGames } from '@/services/backendApi';
import { useDragReorder } from './useDragReorder';

// ── Overlap helpers ───────────────────────────────────────────────────────────

type Overlap = 'fresh' | 'none' | 'partial' | 'full';

function computeOverlap(instancePlayerSessions: string[], currentPlayers: string[]): Overlap {
  if (!instancePlayerSessions.length) return 'fresh';
  if (!currentPlayers.length) return 'none';
  const playedSet = new Set<string>();
  for (const session of instancePlayerSessions) {
    for (const p of session.split(',').map(s => s.trim().toLowerCase())) {
      if (p) playedSet.add(p);
    }
  }
  const current = currentPlayers.map(p => p.trim().toLowerCase()).filter(Boolean);
  if (!current.length) return 'none';
  const matched = current.filter(p => playedSet.has(p));
  if (matched.length === 0) return 'none';
  if (matched.length === current.length) return 'full';
  return 'partial';
}

const OVERLAP_BADGE: Record<Overlap, { label: string; className: string; title: string }> = {
  fresh:   { label: 'Neu',        className: 'overlap-fresh',   title: 'Noch nie von jemandem gespielt' },
  none:    { label: 'Ungespielt', className: 'overlap-none',    title: 'Schon mal gespielt, aber mit anderen Spielern' },
  partial: { label: 'Teilweise',  className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
  full:    { label: 'Gespielt',   className: 'overlap-full',    title: 'Alle aktuellen Spieler kennen das Spiel bereits' },
};

// ── Players combobox (multi-select with tag chips) ───────────────────────────

interface PlayersComboboxProps {
  selected: string[];
  knownPlayers: string[];
  onChange: (players: string[]) => void;
}

function PlayersCombobox({ selected, knownPlayers, onChange }: PlayersComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hlIndex, setHlIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = knownPlayers.filter(
    p => !selected.includes(p) && (!query || p.toLowerCase().includes(query.toLowerCase()))
  );

  const add = (player: string) => {
    const p = player.trim();
    if (p && !selected.includes(p)) onChange([...selected, p]);
    setQuery('');
    setHlIndex(-1);
  };

  const remove = (player: string) => onChange(selected.filter(p => p !== player));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && suggestions.length) setHlIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setHlIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (hlIndex >= 0 && hlIndex < suggestions.length) {
        add(suggestions[hlIndex]);
      } else if (query.trim()) {
        add(query.trim());
      }
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  };

  return (
    <div className="players-combobox">
      {selected.map(p => (
        <span key={p} className="player-tag">
          {p}
          <button className="player-tag-remove" onMouseDown={e => { e.preventDefault(); remove(p); }}>×</button>
        </span>
      ))}
      <div className="players-input-wrap">
        <input
          ref={inputRef}
          className="players-combobox-input"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setHlIndex(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setHlIndex(-1); }, 150)}
          onKeyDown={handleKeyDown}
          placeholder="Spieler hinzufügen…"
        />
        {open && suggestions.length > 0 && (
          <div className="players-combobox-dropdown">
            {suggestions.map((p, i) => (
              <button
                key={p}
                className={`players-combobox-item${i === hlIndex ? ' highlighted' : ''}`}
                onMouseDown={e => { e.preventDefault(); add(p); }}
                onMouseEnter={() => setHlIndex(i)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Searchable game combobox ──────────────────────────────────────────────────

interface ComboboxProps {
  games: GameFileSummary[];
  value: string;
  onChange: (fileName: string) => void;
  placeholder?: string;
  currentPlayers?: string[];
}

function gameOverlap(g: GameFileSummary, currentPlayers: string[]): Overlap | null {
  if (g.isSingleInstance) return null;
  const instances = g.instances.filter(i => i !== 'template');
  if (!instances.length) return null;
  const overlaps = instances.map(inst =>
    computeOverlap(g.instancePlayers?.[inst] ?? [], currentPlayers)
  );
  if (overlaps.every(o => o === 'fresh')) return 'fresh';
  if (!currentPlayers.length) return null;
  if (overlaps.some(o => o === 'fresh' || o === 'none')) return 'none';
  if (overlaps.every(o => o === 'full')) return 'full';
  return 'partial';
}

const OVERLAP_BADGE_COMBOBOX: Record<Overlap, { label: string; className: string; title: string }> = {
  fresh:   { label: 'Neu',        className: 'overlap-fresh',   title: 'Noch nie von jemandem gespielt' },
  none:    { label: 'Ungespielt', className: 'overlap-none',    title: 'Schon mal gespielt, aber mit anderen Spielern' },
  partial: { label: 'Gemischt',   className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
  full:    { label: 'Gespielt',   className: 'overlap-full',    title: 'Alle aktuellen Spieler kennen das Spiel bereits' },
};

function GameCombobox({ games, value, onChange, placeholder = 'Spiel suchen...', currentPlayers = [] }: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hlIndex, setHlIndex] = useState(-1);
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
    setHlIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && filtered.length) setHlIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setHlIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hlIndex >= 0 && hlIndex < filtered.length) select(filtered[hlIndex].fileName);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHlIndex(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="game-combobox">
      <input
        ref={inputRef}
        className="be-input"
        value={displayValue}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHlIndex(-1); }}
        onFocus={() => { setQuery(''); setOpen(true); setHlIndex(-1); }}
        onClick={() => { setQuery(''); setOpen(true); setHlIndex(-1); }}
        onBlur={() => setTimeout(() => { setOpen(false); setHlIndex(-1); }, 120)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className="game-combobox-dropdown">
          {filtered.length === 0 ? (
            <div className="game-combobox-empty">Keine Treffer</div>
          ) : (
            filtered.map((g, i) => {
              const ol = gameOverlap(g, currentPlayers);
              const badge = ol ? OVERLAP_BADGE_COMBOBOX[ol] : null;
              return (
                <button
                  key={g.fileName}
                  className={`game-combobox-item ${g.fileName === value ? 'selected' : ''}${i === hlIndex ? ' highlighted' : ''}`}
                  onMouseDown={e => { e.preventDefault(); select(g.fileName); }}
                  onMouseEnter={() => setHlIndex(i)}
                >
                  <span className="game-combobox-title">{g.title}</span>
                  <span className="game-combobox-file">{g.fileName}</span>
                  {badge && <span className={`overlap-badge ${badge.className}`} title={badge.title}>{badge.label}</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Instance combobox ─────────────────────────────────────────────────────────

interface InstanceComboboxProps {
  instances: string[];
  value: string;
  onChange: (inst: string) => void;
  gameData?: GameFileSummary;
  currentPlayers: string[];
  placeholder?: string;
}

function InstanceCombobox({ instances, value, onChange, gameData, currentPlayers, placeholder = 'Instanz...' }: InstanceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [hlIndex, setHlIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const select = (inst: string) => { onChange(inst); setOpen(false); setHlIndex(-1); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && instances.length) setHlIndex(i => Math.min(i + 1, instances.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setHlIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hlIndex >= 0 && hlIndex < instances.length) select(instances[hlIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHlIndex(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="game-combobox" style={{ width: 150, flex: 'none' }}>
      <input
        ref={inputRef}
        className="be-input"
        value={value}
        placeholder={placeholder}
        readOnly
        onFocus={() => { setOpen(true); setHlIndex(-1); }}
        onClick={() => { setOpen(true); setHlIndex(-1); }}
        onBlur={() => setTimeout(() => { setOpen(false); setHlIndex(-1); }, 120)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className="game-combobox-dropdown">
          {instances.map((inst, i) => {
            const sessions = gameData?.instancePlayers?.[inst] ?? [];
            const ol = computeOverlap(sessions, currentPlayers);
            const badge = (ol === 'fresh' || currentPlayers.length > 0) ? OVERLAP_BADGE_COMBOBOX[ol] : null;
            return (
              <button
                key={inst}
                className={`game-combobox-item ${inst === value ? 'selected' : ''}${i === hlIndex ? ' highlighted' : ''}`}
                onMouseDown={e => { e.preventDefault(); select(inst); }}
                onMouseEnter={() => setHlIndex(i)}
              >
                <span className="game-combobox-title">{inst}</span>
                {badge && <span className={`overlap-badge ${badge.className}`} title={badge.title}>{badge.label}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Planning overview ─────────────────────────────────────────────────────────

interface PlanningProps {
  games: GameFileSummary[];
  currentPlayers: string[];
  onAdd: (ref: string) => void;
}

function SessionList({ sessions, currentPlayers }: { sessions: string[]; currentPlayers: string[] }) {
  if (!sessions.length) return null;
  const currentLower = new Set(currentPlayers.map(p => p.trim().toLowerCase()));
  return (
    <div className="planning-sessions">
      {sessions.map((session, si) => {
        const parts = session.split(',').map(s => s.trim()).filter(Boolean);
        return (
          <span key={si} className="planning-session">
            {parts.map((p, pi) => (
              <span key={pi} className={currentLower.has(p.toLowerCase()) ? 'session-player matched' : 'session-player'}>
                {p}{pi < parts.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function PlanningOverview({ games, currentPlayers, onAdd }: PlanningProps) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const result: Array<{
      ref: string; title: string; instance: string | null;
      overlap: Overlap; sessions: string[];
    }> = [];
    for (const g of games) {
      if (g.isSingleInstance) {
        result.push({ ref: g.fileName, title: g.title, instance: null, overlap: 'fresh', sessions: [] });
      } else {
        for (const inst of g.instances.filter(i => i !== 'template')) {
          const sessions = g.instancePlayers?.[inst] ?? [];
          const overlap = computeOverlap(sessions, currentPlayers);
          result.push({ ref: `${g.fileName}/${inst}`, title: g.title, instance: inst, overlap, sessions });
        }
      }
    }
    const order: Record<Overlap, number> = { fresh: 0, none: 1, partial: 2, full: 3 };
    result.sort((a, b) => {
      const d = order[a.overlap] - order[b.overlap];
      return d !== 0 ? d : a.title.localeCompare(b.title);
    });
    return result;
  }, [games, currentPlayers]);

  const q = search.toLowerCase();
  const filtered = rows.filter(r =>
    !q ||
    r.title.toLowerCase().includes(q) ||
    (r.instance ?? '').toLowerCase().includes(q)
  );

  return (
    <div className="planning-overview">
      <input
        className="be-input"
        placeholder="Suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
        style={{ marginBottom: 8 }}
      />
      {filtered.length === 0 ? (
        <div className="be-empty">Keine Spiele gefunden</div>
      ) : (
        <div className="planning-list">
          {filtered.map(row => {
            const badge = OVERLAP_BADGE[row.overlap];
            return (
              <div key={row.ref} className="planning-row">
                <div className="planning-row-main">
                  <span className={`overlap-badge ${badge.className}`} title={badge.title}>{badge.label}</span>
                  <span className="planning-title">{row.title}</span>
                  {row.instance && <span className="planning-instance">{row.instance}</span>}
                  <button
                    className="be-icon-btn planning-add-btn"
                    onClick={() => onAdd(row.ref)}
                    title={`${row.ref} hinzufügen`}
                  >+</button>
                </div>
                {row.sessions.length > 0 && (
                  <SessionList sessions={row.sessions} currentPlayers={currentPlayers} />
                )}
              </div>
            );
          })}
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
  const [showPlanning, setShowPlanning] = useState(false);
  const drag = useDragReorder(gameshow.gameOrder, order => onChange({ ...gameshow, gameOrder: order }));

  useEffect(() => {
    fetchGames().then(setAvailableGames).catch(() => {});
  }, []);

  const knownPlayers = useMemo(() => {
    const set = new Set<string>();
    for (const g of availableGames) {
      if (g.instancePlayers) {
        for (const sessions of Object.values(g.instancePlayers)) {
          for (const session of sessions) {
            for (const p of session.split(',').map(s => s.trim()).filter(Boolean)) {
              set.add(p);
            }
          }
        }
      }
    }
    return [...set].sort();
  }, [availableGames]);

  const pickedGameData = availableGames.find(g => g.fileName === pickGame);
  const pickIsSingle = pickedGameData?.isSingleInstance ?? false;
  const currentPlayers = gameshow.players ?? [];

  const addGame = (ref?: string) => {
    if (ref) {
      onChange({ ...gameshow, gameOrder: [...gameshow.gameOrder, ref] });
      return;
    }
    if (!pickGame) return;
    if (!pickIsSingle && !pickInstance) return;
    const newRef = pickIsSingle ? pickGame : `${pickGame}/${pickInstance}`;
    onChange({ ...gameshow, gameOrder: [...gameshow.gameOrder, newRef] });
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

      {/* Players field */}
      <div className="gs-players-row">
        <label className="gs-players-label">Spieler</label>
        <PlayersCombobox
          selected={currentPlayers}
          knownPlayers={knownPlayers}
          onChange={players => onChange({ ...gameshow, players })}
        />
        <button
          className={`be-icon-btn ${showPlanning ? 'active' : ''}`}
          onClick={() => setShowPlanning(v => !v)}
          title="Spielplanung"
          style={{ flexShrink: 0 }}
        >
          {showPlanning ? '▲ Planung' : '▼ Planung'}
        </button>
      </div>

      {/* Planning overview */}
      {showPlanning && (
        <PlanningOverview
          games={availableGames}
          currentPlayers={currentPlayers}
          onAdd={ref => addGame(ref)}
        />
      )}

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

          const sessions = instance ? (gameData?.instancePlayers?.[instance] ?? []) : [];
          const overlap = computeOverlap(sessions, currentPlayers);
          const badge = (overlap === 'fresh' || currentPlayers.length > 0) ? OVERLAP_BADGE[overlap] : null;

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
              <span
                className={`overlap-badge ${badge?.className ?? ''}`}
                style={{ flexShrink: 0, visibility: badge ? 'visible' : 'hidden' }}
                title={badge?.title}
              >
                {badge?.label ?? 'Ungespielt'}
              </span>
              <GameCombobox
                games={availableGames}
                value={gameName}
                onChange={newGame => {
                  if (newGame === gameName) { updateEntry(i, newGame, instance); return; }
                  const newData = availableGames.find(g => g.fileName === newGame);
                  const newInstances = (newData?.instances ?? []).filter(k => k !== 'template');
                  const resolved = newData?.isSingleInstance ? ''
                    : newInstances.includes(instance) ? instance
                    : newInstances.length === 1 ? newInstances[0]
                    : '';
                  updateEntry(i, newGame, resolved);
                }}
                currentPlayers={currentPlayers}
              />
              {gameName && !isSingle && (
                <InstanceCombobox
                  instances={(gameData?.instances ?? []).filter(i => i !== 'template')}
                  value={instance}
                  onChange={inst => updateEntry(i, gameName, inst)}
                  gameData={gameData}
                  currentPlayers={currentPlayers}
                />
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
          onChange={game => {
            const data = availableGames.find(g => g.fileName === game);
            const instances = (data?.instances ?? []).filter(k => k !== 'template');
            const ref = data?.isSingleInstance ? game : `${game}/${instances[0] ?? ''}`;
            onChange({ ...gameshow, gameOrder: [...gameshow.gameOrder, ref] });
            setPickGame('');
            setPickInstance('');
          }}
          placeholder="Spiel hinzufügen..."
          currentPlayers={currentPlayers}
        />
      </div>
    </div>
  );
}
