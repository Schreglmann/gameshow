import { useState, useEffect, useRef, useMemo } from 'react';
import { isTouchDevice } from '@/utils/isTouchDevice';
import type { GameshowConfig, GameFileSummary, GameType } from '@/types/config';
import { fetchGames } from '@/services/backendApi';
import { gameTypeMatchesQuery } from '@/data/gameTypeInfo';
import { useDragReorder } from './useDragReorder';
import { JOKER_CATALOG } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import { useTheme } from '@/context/ThemeContext';
import { useConfirm } from './ConfirmContext';
import PlayerStatsModal from './PlayerStatsModal';
import {
  buildOverlapContext,
  classifyOverlap,
  classifyGameOverlap,
  refProvenance,
  playersWhoPlayed,
  type Overlap,
  type OverlapContext,
} from '@/utils/playerStats';

// ── Overlap helpers ───────────────────────────────────────────────────────────
//
// "Played" is derived from gameshow membership + config order, not a per-game
// field — see src/utils/playerStats.ts and specs/game-planning.md.

/** Fully-qualified refs for every selectable instance of a game (single → [fileName]). */
function gameRefs(g: GameFileSummary): string[] {
  if (g.isSingleInstance) return [g.fileName];
  return g.instances.filter(i => i !== 'template').map(i => `${g.fileName}/${i}`);
}

/**
 * Tooltip for an overlap badge. For partial/full badges it names the current
 * players who already know the game (from happened shows); otherwise the static
 * description.
 */
function overlapTitle(overlap: Overlap, ref: string, ctx: OverlapContext, base: string): string {
  if (overlap === 'partial' || overlap === 'full') {
    const who = playersWhoPlayed(ref, ctx);
    if (who.length) return `Kennen das Spiel schon: ${who.join(', ')}`;
  }
  return base;
}

const OVERLAP_BADGE: Record<Overlap, { label: string; className: string; title: string }> = {
  fresh:   { label: 'Neu',        className: 'overlap-fresh',   title: 'Noch nie in einer früheren Gameshow gespielt' },
  none:    { label: 'Ungespielt', className: 'overlap-none',    title: 'Früher gespielt, aber mit anderen Spielern' },
  planned: { label: 'Eingeplant', className: 'overlap-planned', title: 'In einer folgenden Gameshow mit gemeinsamen Spielern eingeplant' },
  partial: { label: 'Teilweise',  className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
  full:    { label: 'Gespielt',   className: 'overlap-full',    title: 'Alle aktuellen Spieler kennen das Spiel bereits' },
};

// ── Players combobox (multi-select with tag chips) ───────────────────────────

interface PlayersComboboxProps {
  selected: string[];
  knownPlayers: string[];
  onChange: (players: string[]) => void;
  onPlayerClick: (player: string) => void;
}

function PlayersCombobox({ selected, knownPlayers, onChange, onPlayerClick }: PlayersComboboxProps) {
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
        add(suggestions[hlIndex]!);
      } else if (open && suggestions.length === 1) {
        // Exactly one match shown → Enter adds it directly, no need to arrow-key down first.
        add(suggestions[0]!);
      } else if (query.trim()) {
        add(query.trim());
      }
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]!);
    }
  };

  return (
    <div className="players-combobox">
      {selected.map(p => (
        <span key={p} className="player-tag">
          <button
            type="button"
            className="player-tag-name"
            onMouseDown={e => { e.preventDefault(); onPlayerClick(p); }}
            title={`Statistik für ${p}`}
          >{p}</button>
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
  ctx?: OverlapContext;
}

const OVERLAP_BADGE_COMBOBOX: Record<Overlap, { label: string; className: string; title: string }> = {
  fresh:   { label: 'Neu',        className: 'overlap-fresh',   title: 'Noch nie in einer früheren Gameshow gespielt' },
  none:    { label: 'Ungespielt', className: 'overlap-none',    title: 'Früher gespielt, aber mit anderen Spielern' },
  planned: { label: 'Eingeplant', className: 'overlap-planned', title: 'In einer folgenden Gameshow mit gemeinsamen Spielern eingeplant' },
  partial: { label: 'Gemischt',   className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
  full:    { label: 'Gespielt',   className: 'overlap-full',    title: 'Alle aktuellen Spieler kennen das Spiel bereits' },
};

function GameCombobox({ games, value, onChange, placeholder = 'Spiel suchen...', ctx }: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hlIndex, setHlIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = games.find(g => g.fileName === value);
  const displayValue = open ? query : (selected ? selected.title : '');

  const filtered = games.filter(g =>
    !query ||
    g.title.toLowerCase().includes(query.toLowerCase()) ||
    g.fileName.toLowerCase().includes(query.toLowerCase()) ||
    gameTypeMatchesQuery(g.type, query)
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
      if (hlIndex >= 0 && hlIndex < filtered.length) select(filtered[hlIndex]!.fileName);
      else if (open && filtered.length === 1) select(filtered[0]!.fileName); // single match → Enter selects it
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
              const ol = ctx ? classifyGameOverlap(gameRefs(g), ctx) : null;
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
  /** Undefined hides the overlap badges (e.g. for already-played gameshows). */
  ctx?: OverlapContext;
  placeholder?: string;
}

function InstanceCombobox({ instances, value, onChange, gameData, ctx, placeholder = 'Instanz...' }: InstanceComboboxProps) {
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
      if (hlIndex >= 0 && hlIndex < instances.length) select(instances[hlIndex]!);
      else if (open && instances.length === 1) select(instances[0]!); // single instance → Enter selects it
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
            const ref = gameData ? `${gameData.fileName}/${inst}` : inst;
            const ol = ctx ? classifyOverlap(ref, ctx) : null;
            const badge = (ol && (ol === 'fresh' || ctx!.currentPlayersLower.length > 0)) ? OVERLAP_BADGE_COMBOBOX[ol] : null;
            return (
              <button
                key={inst}
                className={`game-combobox-item ${inst === value ? 'selected' : ''}${i === hlIndex ? ' highlighted' : ''}`}
                onMouseDown={e => { e.preventDefault(); select(inst); }}
                onMouseEnter={() => setHlIndex(i)}
              >
                <span className="game-combobox-title">{inst}</span>
                {badge && <span className={`overlap-badge ${badge.className}`} title={ol && ctx ? overlapTitle(ol, ref, ctx, badge.title) : badge.title}>{badge.label}</span>}
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
  ctx: OverlapContext;
  gameshows: Record<string, GameshowConfig>;
  addedRefs: ReadonlySet<string>;
  onAdd: (ref: string) => void;
  /** When false, overlap badges + provenance are hidden (already-played gameshow). */
  showBadges: boolean;
}

/**
 * Where a ref was played (past gameshows) / is planned (following gameshows),
 * limited to shows that share a current-roster member. Replaces the old raw
 * `_players` session strings.
 */
function ProvenanceList({ refValue, ctx, gameshows }: { refValue: string; ctx: OverlapContext; gameshows: Record<string, GameshowConfig> }) {
  const prov = refProvenance(refValue, ctx, gameshows);
  if (!prov.playedIn.length && !prov.plannedIn.length) return null;
  const line = (kind: 'played' | 'planned', s: { id: string; name: string; overlapPlayers: string[] }) => (
    <span key={`${kind}-${s.id}`} className={`planning-session${kind === 'planned' ? ' planned' : ''}`}>
      <span className="planning-session-label">{kind === 'played' ? 'Gespielt' : 'Eingeplant'} · {s.name}</span>
      {s.overlapPlayers.length > 0 && (
        <>: {s.overlapPlayers.map((p, pi) => (
          <span key={pi} className="session-player matched">{p}{pi < s.overlapPlayers.length - 1 ? ', ' : ''}</span>
        ))}</>
      )}
    </span>
  );
  return (
    <div className="planning-sessions">
      {prov.playedIn.map(s => line('played', s))}
      {prov.plannedIn.map(s => line('planned', s))}
    </div>
  );
}

function PlanningOverview({ games, ctx, gameshows, addedRefs, onAdd, showBadges }: PlanningProps) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const result: Array<{
      ref: string; title: string; instance: string | null; type: GameType; overlap: Overlap;
    }> = [];
    for (const g of games) {
      if (g.isSingleInstance) {
        result.push({ ref: g.fileName, title: g.title, instance: null, type: g.type, overlap: classifyOverlap(g.fileName, ctx) });
      } else {
        // The archive instance is never a real planning candidate here, even in the
        // fallback case where the server exposes it as the only selectable instance
        // (that fallback is for the manual add-game picker, not the Planung overview).
        for (const inst of g.instances.filter(i => i !== 'template' && i.toLowerCase() !== 'archive')) {
          const ref = `${g.fileName}/${inst}`;
          result.push({ ref, title: g.title, instance: inst, type: g.type, overlap: classifyOverlap(ref, ctx) });
        }
      }
    }
    const order: Record<Overlap, number> = { fresh: 0, none: 1, planned: 2, partial: 3, full: 4 };
    result.sort((a, b) => {
      const d = order[a.overlap] - order[b.overlap];
      return d !== 0 ? d : a.title.localeCompare(b.title);
    });
    return result;
  }, [games, ctx]);

  const q = search.toLowerCase();
  const filtered = rows.filter(r =>
    !q ||
    r.title.toLowerCase().includes(q) ||
    (r.instance ?? '').toLowerCase().includes(q) ||
    gameTypeMatchesQuery(r.type, q)
  );

  return (
    <div className="planning-overview">
      <input
        className="be-input"
        placeholder="Suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus={!isTouchDevice()}
        style={{ marginBottom: 8 }}
      />
      {filtered.length === 0 ? (
        <div className="be-empty">Keine Spiele gefunden</div>
      ) : (
        <div className="planning-list">
          {filtered.map(row => {
            const badge = OVERLAP_BADGE[row.overlap];
            const isAdded = addedRefs.has(row.ref);
            return (
              <div key={row.ref} className={`planning-row${isAdded ? ' added' : ''}`}>
                <div className="planning-row-main">
                  {showBadges && <span className={`overlap-badge ${badge.className}`} title={overlapTitle(row.overlap, row.ref, ctx, badge.title)}>{badge.label}</span>}
                  <span className="planning-title">{row.title}</span>
                  {row.instance && <span className="planning-instance">{row.instance}</span>}
                  <button
                    className="be-icon-btn planning-add-btn"
                    onClick={() => onAdd(row.ref)}
                    disabled={isAdded}
                    title={isAdded ? 'Bereits hinzugefügt' : `${row.ref} hinzufügen`}
                  >+</button>
                </div>
                {showBadges && <ProvenanceList refValue={row.ref} ctx={ctx} gameshows={gameshows} />}
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
  allGameshows: Record<string, GameshowConfig>;
  /** Id of the active gameshow — the "now" divider for played vs. upcoming. */
  activeGameshow: string;
  isActive: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSetActive: () => void;
  onChange: (updated: GameshowConfig) => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onNavigateToGameshow: (gameshowId: string) => void;
}

export default function GameshowEditor({ id, gameshow, allGameshows, activeGameshow, isActive, expanded, onToggleExpand, onSetActive, onChange, onRename, onDelete, onNavigateToGameshow }: Props) {
  const confirmDialog = useConfirm();
  const [availableGames, setAvailableGames] = useState<GameFileSummary[]>([]);
  const [pickGame, setPickGame] = useState('');
  const [pickInstance, setPickInstance] = useState('');
  const [showPlanning, setShowPlanning] = useState(false);
  const [statsPlayer, setStatsPlayer] = useState<string | null>(null);
  // Inline name editing — click the name to rename in place (like DAM filenames).
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const drag = useDragReorder(gameshow.gameOrder, order => onChange({ ...gameshow, gameOrder: order }));

  useEffect(() => {
    fetchGames().then(setAvailableGames).catch(() => {});
  }, []);

  // Autocomplete pool = every player named in any gameshow's roster.
  const knownPlayers = useMemo(() => {
    const set = new Set<string>();
    for (const gs of Object.values(allGameshows)) {
      for (const p of gs.players ?? []) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allGameshows]);

  const pickedGameData = availableGames.find(g => g.fileName === pickGame);
  const pickIsSingle = pickedGameData?.isSingleInstance ?? false;
  const currentPlayers = useMemo(() => gameshow.players ?? [], [gameshow.players]);
  // Timeline split (played / upcoming-earlier gameshows) for overlap classification.
  const overlapCtx = useMemo(
    () => buildOverlapContext(allGameshows, id, currentPlayers, activeGameshow),
    [allGameshows, id, currentPlayers, activeGameshow],
  );
  // "Now" divider for the player-stats modal: shows before the active one are
  // played, the active one and later are upcoming ("Eingeplant").
  const referenceIndex = useMemo(() => {
    const i = Object.keys(allGameshows).indexOf(activeGameshow);
    return i < 0 ? Object.keys(allGameshows).length : i;
  }, [allGameshows, activeGameshow]);
  // A gameshow that already happened (before the active one). Its overlap badges
  // are planning aids that no longer apply, so they are hidden.
  const isPlayedShow = useMemo(() => {
    const ids = Object.keys(allGameshows);
    const ci = ids.indexOf(id);
    const ai = ids.indexOf(activeGameshow);
    return ai >= 0 && ci >= 0 && ci < ai;
  }, [allGameshows, id, activeGameshow]);
  const badgeCtx = isPlayedShow ? undefined : overlapCtx;
  const addedRefs = useMemo(() => new Set(gameshow.gameOrder), [gameshow.gameOrder]);
  const pickerGames = useMemo(() => availableGames.filter(g => {
    if (g.isSingleInstance) return !addedRefs.has(g.fileName);
    const instances = g.instances.filter(i => i !== 'template');
    if (instances.length === 0) return false;
    return !instances.some(inst => addedRefs.has(`${g.fileName}/${inst}`));
  }), [availableGames, addedRefs]);

  // Total questions across every game referenced in this gameshow's order.
  const totalQuestions = useMemo(() => {
    return gameshow.gameOrder.reduce((sum, ref) => {
      const slashIdx = ref.indexOf('/');
      const gameName = slashIdx >= 0 ? ref.slice(0, slashIdx) : ref;
      const instance = slashIdx >= 0 ? ref.slice(slashIdx + 1) : '';
      const data = availableGames.find(g => g.fileName === gameName);
      if (!data) return sum;
      const count = data.isSingleInstance
        ? (data.questionCount ?? 0)
        : (data.questionCounts?.[instance] ?? 0);
      return sum + count;
    }, 0);
  }, [gameshow.gameOrder, availableGames]);

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
    <div className="backend-card" id={`gs-card-${id}`}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: expanded ? 6 : 0 }}>
        <button
          className="be-icon-btn gs-collapse-toggle"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? 'Gameshow einklappen' : 'Gameshow ausklappen'}
          title={expanded ? 'Einklappen' : 'Ausklappen'}
          style={{ flexShrink: 0 }}
        >
          <span className={`gs-collapse-chevron${expanded ? ' open' : ''}`}>▶</span>
        </button>
        {editingName ? (
          <input
            className="be-input"
            style={{ flex: 1, minWidth: 140, fontSize: 'var(--admin-sz-14, 14px)', fontWeight: 600 }}
            value={editName}
            autoFocus
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { e.preventDefault(); setEditingName(false); }
            }}
            onBlur={() => {
              setEditingName(false);
              onRename(editName);
              // Committing re-renders the gameshow list synchronously, mid-click. The
              // reflow relocates the selection anchor the browser set on the click-out's
              // mousedown, so mouseup drags a stray text selection across the page. Drop
              // it next frame (after mouseup, before paint) so it never becomes visible.
              requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
            }}
            placeholder="Gameshow-Name"
          />
        ) : (
          <span
            className="gs-name-text"
            style={{ flex: 1, minWidth: 140, fontSize: 'var(--admin-sz-14, 14px)', fontWeight: 600 }}
            title="Klicken zum Umbenennen"
            onClick={() => { setEditName(gameshow.name); setEditingName(true); }}
          >{gameshow.name}</span>
        )}
        {!expanded && (
          <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb), max(0.35, var(--text-fade-floor, 0)))', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {gameshow.gameOrder.length} Spiel{gameshow.gameOrder.length !== 1 ? 'e' : ''}
            {' · '}{totalQuestions} Frage{totalQuestions !== 1 ? 'n' : ''}
          </span>
        )}
        {isActive ? (
          <span className="gs-active-badge">✓ Aktiv</span>
        ) : (
          <button className="be-icon-btn" onClick={onSetActive}>Als aktiv setzen</button>
        )}
        <button className="be-delete-btn" onClick={onDelete} title="Gameshow löschen">🗑</button>
      </div>

      {expanded && (
      <>
      <div style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb), max(0.35, var(--text-fade-floor, 0)))', marginBottom: 8 }}>
        ID: <code style={{ color: 'rgba(var(--text-rgb), max(0.55, var(--text-fade-floor, 0)))' }}>{id}</code>
        &nbsp;·&nbsp; {gameshow.gameOrder.length} Spiel{gameshow.gameOrder.length !== 1 ? 'e' : ''}
        &nbsp;·&nbsp; {totalQuestions} Frage{totalQuestions !== 1 ? 'n' : ''}
      </div>

      {/* Players field */}
      <div className="gs-players-row">
        <label className="gs-players-label">Spieler</label>
        <PlayersCombobox
          selected={currentPlayers}
          knownPlayers={knownPlayers}
          onChange={players => onChange({ ...gameshow, players })}
          onPlayerClick={setStatsPlayer}
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
          ctx={overlapCtx}
          gameshows={allGameshows}
          addedRefs={addedRefs}
          onAdd={ref => addGame(ref)}
          showBadges={!isPlayedShow}
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

          const overlap = classifyOverlap(ref, overlapCtx);
          const badge = (!isPlayedShow && (overlap === 'fresh' || currentPlayers.length > 0)) ? OVERLAP_BADGE[overlap] : null;

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
              <span style={{ color: 'rgba(var(--text-rgb), max(0.3, var(--text-fade-floor, 0)))', fontSize: 'var(--admin-sz-11, 11px)', minWidth: 22, flexShrink: 0 }}>{i + 1}.</span>
              {!isPlayedShow && (
                <span
                  className={`overlap-badge ${badge?.className ?? ''}`}
                  style={{ flexShrink: 0, visibility: badge ? 'visible' : 'hidden' }}
                  title={badge ? overlapTitle(overlap, ref, overlapCtx, badge.title) : undefined}
                >
                  {badge?.label ?? 'Ungespielt'}
                </span>
              )}
              <GameCombobox
                games={availableGames}
                value={gameName}
                onChange={newGame => {
                  if (newGame === gameName) { updateEntry(i, newGame, instance); return; }
                  const newData = availableGames.find(g => g.fileName === newGame);
                  const newInstances = (newData?.instances ?? []).filter(k => k !== 'template');
                  const resolved = newData?.isSingleInstance ? ''
                    : newInstances.includes(instance) ? instance
                    : newInstances.length === 1 ? newInstances[0]!
                    : '';
                  updateEntry(i, newGame, resolved);
                }}
                ctx={badgeCtx}
              />
              {gameName && !isSingle && (
                <InstanceCombobox
                  instances={(gameData?.instances ?? []).filter(i => i !== 'template')}
                  value={instance}
                  onChange={inst => updateEntry(i, gameName, inst)}
                  gameData={gameData}
                  ctx={badgeCtx}
                />
              )}
              <button
                className="be-delete-btn"
                onClick={async () => { if (await confirmDialog({ title: 'Spiel aus der Liste entfernen?', confirmLabel: 'Entfernen' })) onChange({ ...gameshow, gameOrder: gameshow.gameOrder.filter((_, idx) => idx !== i) }); }}
                title="Entfernen"
              >🗑</button>
            </div>
          );
        })
      )}

      {/* Add new game */}
      <div className="gs-picker-row">
        <GameCombobox
          games={pickerGames}
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
          ctx={badgeCtx}
        />
      </div>

      <JokersSelector
        enabled={gameshow.enabledJokers ?? []}
        onChange={enabledJokers => onChange({ ...gameshow, enabledJokers })}
      />
      </>
      )}

      {statsPlayer !== null && (
        <PlayerStatsModal
          player={statsPlayer}
          games={availableGames}
          gameshows={allGameshows}
          referenceIndex={referenceIndex}
          onNavigateToGameshow={onNavigateToGameshow}
          onClose={() => setStatsPlayer(null)}
        />
      )}
    </div>
  );
}

// ── Verfügbare Joker ──────────────────────────────────────────────────────────

interface JokersSelectorProps {
  enabled: string[];
  onChange: (ids: string[]) => void;
}

function JokersSelector({ enabled, onChange }: JokersSelectorProps) {
  const { adminTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = (id: string) => {
    if (enabled.includes(id)) {
      onChange(enabled.filter(e => e !== id));
    } else {
      onChange([...enabled, id]);
    }
  };

  return (
    <div className="gs-jokers">
      <button
        type="button"
        className="gs-jokers-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
      >
        <span className={`gs-jokers-chevron${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
        <span>Verfügbare Joker</span>
        <span className="gs-jokers-count">{enabled.length}/{JOKER_CATALOG.length}</span>
      </button>
      {expanded && (
        <div className="gs-jokers-list">
          {JOKER_CATALOG.map(joker => {
            const active = enabled.includes(joker.id);
            return (
              <button
                key={joker.id}
                type="button"
                role="switch"
                aria-checked={active}
                className={`gs-joker-card${active ? ' active' : ''}`}
                onClick={() => toggle(joker.id)}
                title={joker.description}
              >
                <span className="gs-joker-card-icon" aria-hidden="true">
                  <JokerIcon id={joker.id} theme={adminTheme} size={28} />
                </span>
                <span className="gs-joker-card-text">
                  <span className="gs-joker-card-name">{joker.name}</span>
                  <span className="gs-joker-card-desc">{joker.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
