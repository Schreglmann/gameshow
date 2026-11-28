import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand, GamemasterControl, RosterPlayer } from '@/types/game';
import type { LivePlayersRequest, Player } from '@/types/config';
import { syncLivePlayers } from '@/services/api';
import SuggestInput from '@/components/common/SuggestInput';
import { teamName, teamNameLongHint } from '@/utils/teamNames';
import { useTeamNameCheck } from '@/hooks/useTeamNameCheck';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { teamKeys, teamNumber, teamRoster, isTeamKey, type TeamKey } from '@/utils/teams';
import TeamCountWarning from '@/components/screens/TeamCountWarning';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';
import TeamCardName from '@/components/common/TeamCardName';
import { isInactiveShowTab, onBecameActive } from '@/services/showPresenceState';
import { drawnPlayers, movePlayer, removePlayer as removeFromDraw } from '@/utils/teamDraw';
import {
  additionFeedback,
  adminLabel,
  checkAdditions,
  displayNames,
  fullName,
  knownPlayers,
  nameKey,
  normalizeWhitespace,
  parsePlayerInput,
  parsePlayerNames,
  playerSuggestions,
  rosterSignature,
  samePlayer,
  shownName,
  type AdditionCheck,
} from '@/utils/playerNames';
import { useRosterDisplayNames } from '@/hooks/useRosterDisplayNames';
import { fitRosterLayout, maxRosterColumns } from '@/utils/rosterFit';

/** Up to this many players the pre-reveal name grid uses larger chips. */
const DRAW_POOL_LARGE_MAX = 12;

/**
 * React key for a roster row that follows the PLAYER, not the position, so a
 * focused input stays with its player when the GM removes someone above it.
 */
function playerRowKeys(players: readonly RosterPlayer[]): string[] {
  const seen = new Map<string, number>();
  return players.map(p => {
    const base = p.id ?? nameKey(p);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/** A roster input being edited on the show: who it was, and the text so far. */
interface SlotEdit {
  team: TeamKey;
  /** The player being edited; `null` for the "+ Spieler hinzufügen" ghost slot. */
  original: RosterPlayer | null;
  text: string;
}

export default function HomeScreen() {
  const { state, dispatch, assignTeams, reconcileTeamDraw, revealTeams } = useGameContext();
  const navigate = useNavigate();
  const [addInput, setAddInput] = useState('');
  // Inline editing on the show (team names AND member rosters): while any field
  // is focused, `editingRef` is true. The window-level "click anywhere to
  // advance" listener uses this — but the click that ENDS editing (clicking on
  // empty space) must not advance, and by the time that `click` fires the field
  // has already blurred (`editingRef` back to false). So the listener snapshots
  // `editingRef` at pointer-DOWN (capture phase, before the blur) and swallows
  // the click if we were editing; only a second click advances. See the effect.
  const [editingTeam, setEditingTeam] = useState<TeamKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const editingRef = useRef(false);
  // Guards against a second finishEdit() firing when the focused input unmounts
  // (Enter/Escape sets editingTeam=null → blur fires during React's commit).
  const committingRef = useRef(false);
  // Inline roster editing (manual mode, and after the reveal): only the input
  // being typed in holds a draft; every other row renders straight from state,
  // so GM changes show up immediately. Committed to SET_TEAMS on blur.
  const [slotEdit, setSlotEdit] = useState<SlotEdit | null>(null);
  // Feedback for an add or an edit ("schon dabei", first-name clash). Shown on
  // the show and as a GM info line, cleared after a while. See specs/players.md.
  const [addFeedback, setAddFeedback] = useState<{ text: string; n: number } | null>(null);
  const feedbackCounter = useRef(0);
  const reportAddition = useCallback((result: AdditionCheck) => {
    const text = additionFeedback(result);
    feedbackCounter.current += 1;
    setAddFeedback(text ? { text, n: feedbackCounter.current } : null);
  }, []);
  useEffect(() => {
    if (!addFeedback) return;
    const timer = setTimeout(() => setAddFeedback(null), 8000);
    return () => clearTimeout(timer);
  }, [addFeedback]);
  // Show/GM labels: first name, plus a surname prefix where two share one.
  const playerLabels = useRosterDisplayNames();
  // GM-driven rename: which team the gamemaster is currently editing (null = none),
  // plus the value it's typing (mirrored via emitOnChange) so the show can surface
  // the long-name warning in the GM control panel.
  const [gmEditingTeam, setGmEditingTeam] = useState<TeamKey | null>(null);
  const [gmEditValue, setGmEditValue] = useState('');
  // After the reveal the GM renames a team on its card header instead: the name
  // being typed there (mirrored via `<id>:change`), for the long-name warning.
  const [gmCardDraft, setGmCardDraft] = useState<{ team: TeamKey; value: string } | null>(null);
  const { pointSystemEnabled, teamRandomizationEnabled, players, teamCount, showTitle } = state.settings;
  // What a typed name is matched against, and what the add fields suggest:
  // the whole registry (the gameshow's players first). See specs/players.md.
  const known = useMemo(() => knownPlayers(state.settings), [state.settings]);
  // The teams this gameshow runs with (0-4). Everything below iterates this list
  // instead of naming team1/team2. See specs/team-count.md.
  const activeTeams = useMemo(() => teamKeys(teamCount), [teamCount]);
  const hasTeams = activeTeams.some(key => teamRoster(state.teams, key).length > 0);
  const teamsRevealed = state.teams.teamsRevealed === true;
  // Whether this show has TEAMS to set up at all. Two things switch it off, and
  // both suppress the entire assignment/overview UI so the host just starts:
  //   0 teams — the point system is off, there is nothing to score.
  //   1 team  — points ARE awarded, but there is no second team to split players
  //             between or compete against: the audience plays the show itself.
  // The server backs this up by forcing `teamRandomizationEnabled` off below two
  // teams. See specs/team-count.md and specs/point-system.md.
  const teamsEnabled = pointSystemEnabled && activeTeams.length > 1;
  // Each joker column in the header pill steals room from the team name, so the
  // long-name check depends on how MANY jokers are enabled (1 vs 3 differ), on
  // the team count (a 3-4 team pill is capped to half its side) and on the show's
  // length (the counter's width). The name's actual rendered width is measured
  // (not its char count). No theme here: the show's <html> already carries it.
  const jokerCount = (state.settings.enabledJokers ?? []).length;
  const isNameLong = useTeamNameCheck({ jokerCount, teamCount: activeTeams.length, totalGames: state.settings.totalGames });

  // ── Hidden draw (random mode) ──
  // The draw lives in the normal rosters — the only list of names — and is made
  // in the background as soon as this screen has its settings; `teamsRevealed`
  // keeps it off the show until "Teams zuweisen". Adding or removing a player
  // keeps everyone else where they are. See specs/team-management.md
  // ("Verdeckte Auslosung").
  const hiddenDraw = teamsEnabled && teamRandomizationEnabled && !teamsRevealed;
  // In manual mode the rosters are always on screen; in random mode only once revealed.
  const teamsVisible = !teamRandomizationEnabled || teamsRevealed;
  const drawn = useMemo(() => drawnPlayers(state.teams, activeTeams), [state.teams, activeTeams]);
  const drawEmpty = drawn.length === 0;
  // Autocomplete candidates: every registry player not in the draw yet.
  const suggestions = useMemo(() => playerSuggestions(known, drawn), [known, drawn]);
  // The grid before the reveal is alphabetical by label, so team order can't give the draw away.
  const drawPool = useMemo(() => {
    const labels = displayNames(drawn);
    const keys = playerRowKeys(drawn);
    return drawn
      .map((player, i) => ({ player, label: labels[i]!, key: keys[i]! }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [drawn]);

  // An inactive show tab must not author a draw; re-run once it takes over.
  const [activeTick, setActiveTick] = useState(0);
  useEffect(() => onBecameActive(() => setActiveTick(t => t + 1)), []);

  // Draw the configured players once, on load, when there is no draw yet. A
  // reload with a draw in place keeps it — and does not bring back players the
  // gamemaster removed.
  const initialDrawRef = useRef(false);
  useEffect(() => {
    if (initialDrawRef.current || !state.settingsLoaded || !hiddenDraw || isInactiveShowTab()) return;
    initialDrawRef.current = true;
    if (drawEmpty && players.length > 0) reconcileTeamDraw(players);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settingsLoaded, hiddenDraw, activeTick]);

  // Configured players changed at runtime before the reveal (admin Gameshows
  // tab, live reload): follow by id — removed ids drop out, new ids join the
  // smallest team, renamed players are updated in place. See specs/players.md.
  const prevPlayersRef = useRef<Player[] | null>(null);
  useEffect(() => {
    if (!state.settingsLoaded) return;
    const prev = prevPlayersRef.current;
    prevPlayersRef.current = players;
    if (prev === null || !hiddenDraw || isInactiveShowTab()) return;
    if (rosterSignature(prev) === rosterSignature(players)) return;
    const current = new Map(players.map(p => [p.id, p]));
    const removed = new Set(prev.filter(p => !current.has(p.id)).map(p => p.id));
    const list: RosterPlayer[] = drawn
      .filter(p => !(p.id && removed.has(p.id)))
      .map(p => (p.id && current.get(p.id)) || p);
    for (const p of players) {
      if (prev.some(q => q.id === p.id)) continue;
      const idx = list.findIndex(q => samePlayer(q, p));
      if (idx < 0) list.push(p);
      else if (!list[idx]!.id) list[idx] = p; // a typed "Anna Müller" becomes the configured one
    }
    reconcileTeamDraw(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, state.settingsLoaded]);

  /**
   * Write adds and removes into the active gameshow's players (a new name
   * becomes a registry player with only the nickname). Fire and forget: the
   * live draw never waits for it, and a failed write leaves it as it is. Only
   * the active show tab writes. See specs/players.md ("Sync to the gameshow").
   */
  const syncToGameshow = useCallback((added: readonly RosterPlayer[], removed: readonly RosterPlayer[]) => {
    if (isInactiveShowTab()) return;
    const request: LivePlayersRequest = {};
    if (added.length > 0) {
      request.add = added.map(p => (p.id
        ? { id: p.id }
        : { firstName: p.firstName, lastName: p.lastName, nickname: shownName(p) }));
    }
    const removeIds = removed.flatMap(p => (p.id ? [p.id] : []));
    if (removeIds.length > 0) request.remove = removeIds;
    if (!request.add && !request.remove) return;
    syncLivePlayers(request).catch(err => {
      console.warn('[players] Gameshow-Spieler nicht aktualisiert:', err);
    });
  }, []);

  /**
   * Add one or more (comma-separated) players: each joins the smallest team.
   * An autocomplete pick arrives as its label (`Michael „Michi“ Huber`), which
   * resolves to that registry player. A player already in the draw is
   * refused. See specs/players.md.
   */
  const addPlayers = useCallback((raw: string) => {
    const { players: incoming, ambiguous } = parsePlayerNames(raw, known);
    if (incoming.length === 0 && ambiguous.length === 0) return;
    const result: AdditionCheck = { ...checkAdditions(drawn, incoming), ambiguous };
    reportAddition(result);
    if (result.accepted.length > 0) {
      reconcileTeamDraw([...drawn, ...result.accepted]);
      syncToGameshow(result.accepted, []);
    }
  }, [drawn, known, reconcileTeamDraw, reportAddition, syncToGameshow]);

  /** Remove one player (the show's ✕), wherever the draw put them. */
  const removePlayer = useCallback((player: RosterPlayer) => {
    const patch = removeFromDraw(state.teams, activeTeams, player);
    if (!patch) return;
    dispatch({ type: 'SET_TEAMS', payload: patch });
    syncToGameshow([], [player]);
  }, [state.teams, activeTeams, dispatch, syncToGameshow]);

  /** "Teams zuweisen": show the draw as it is — never reshuffles. */
  const revealDraw = useCallback(() => {
    if (drawn.length > 0) revealTeams();
  }, [drawn.length, revealTeams]);

  /** GM popover "→ Team X": move the player at `index` of team `from`. */
  const moveTo = useCallback((from: TeamKey, index: number, to: TeamKey) => {
    const player = teamRoster(state.teams, from)[index];
    if (player === undefined) return;
    const patch = movePlayer(state.teams, from, player, to);
    if (patch) dispatch({ type: 'SET_TEAMS', payload: patch });
  }, [dispatch, state.teams]);

  /** "Neu mischen": redraw everyone in the draw (or the configured players if it is empty). */
  const reshuffle = useCallback(() => {
    const pool = drawn.length > 0 ? drawn : players;
    if (pool.length > 0) assignTeams(pool);
  }, [drawn, players, assignTeams]);

  // Broadcast screen info to gamemaster
  useGamemasterSync({
    gameTitle: showTitle,
    questionNumber: 0,
    totalQuestions: 0,
    answer: '',
    screenLabel: 'Startseite',
  });

  // ── Manual member add / remove (both show + GM go through these) ──
  // Members-only update via SET_TEAMS; names/points/jokers are preserved and the
  // change auto-syncs to GM/admin over the gamemaster-team-state WS channel.
  // SET_TEAMS is a patch, so only the edited team travels — the others keep
  // their rosters untouched.
  const addMember = useCallback((key: TeamKey, raw: string) => {
    const { players: incoming, ambiguous } = parsePlayerNames(raw, known);
    if (incoming.length === 0 && ambiguous.length === 0) return;
    // Unique across the whole draw, not just this team.
    const result: AdditionCheck = { ...checkAdditions(drawn, incoming), ambiguous };
    reportAddition(result);
    if (result.accepted.length === 0) return;
    dispatch({ type: 'SET_TEAMS', payload: { [key]: [...teamRoster(state.teams, key), ...result.accepted] } });
    syncToGameshow(result.accepted, []);
  }, [dispatch, state.teams, drawn, known, reportAddition, syncToGameshow]);

  const removeMember = useCallback((key: TeamKey, index: number) => {
    const roster = teamRoster(state.teams, key);
    const removed = roster[index];
    if (removed === undefined) return;
    dispatch({ type: 'SET_TEAMS', payload: { [key]: roster.filter((_, i) => i !== index) } });
    syncToGameshow([], [removed]);
  }, [dispatch, state.teams, syncToGameshow]);

  // Gamemaster controls. A rename in progress takes over regardless of mode.
  // Manual mode → per-team add-player inputs + tap-to-remove member lists.
  // Random mode → pool-name entry (before assignment) or rename buttons (after).
  //
  // The GM faces the crowd, so every team-keyed control follows the mirrored
  // order (control IDs stay team-keyed — only display order flips). When the
  // feature is disabled the natural team1→team2 order is used and the swap
  // control is hidden. See specs/team-order-mirror.md.
  const mirrorEnabled = state.settings.teamMirrorEnabled;
  const gmTeamOrder = teamDisplayOrder(state.teams.orderSwapped, true, mirrorEnabled, teamCount);
  const gmEditTeamButtons = gmTeamOrder.map(teamKey => ({
    id: `edit-${teamKey}`,
    label: teamName(state.teams, teamKey),
    variant: 'primary' as const,
  }));
  // Random mode: every team as a card of player buttons — the GM's preview of
  // the draw. Tapping a player opens a popover next to the name with
  // "→ <other team>" for every other team and "Entfernen" (the button `menu`).
  // Within a card the names are alphabetical so one is quick to find among 30+;
  // ids keep the roster index, which is what the commands address. After the
  // reveal the card header (the team name) is tapped to rename the team.
  // See specs/team-management.md ("Verdeckte Auslosung").
  const gmDrawControls: GamemasterControl[] = gmTeamOrder.map(teamKey => {
    const members = teamRoster(state.teams, teamKey);
    const labels = playerLabels[teamKey];
    const byName = members
      .map((_, i) => ({ m: labels[i] ?? '', i }))
      .sort((a, b) => a.m.localeCompare(b.m, 'de'));
    return {
      type: 'button-group',
      id: `draw-${teamKey}`,
      label: `${teamName(state.teams, teamKey)} (${members.length})`,
      layout: 'grid',
      team: teamKey,
      ...(teamsRevealed
        ? {
            rename: {
              id: `team-name-${teamKey}`,
              value: state.teams[`${teamKey}Name`] ?? '',
              placeholder: `Team ${teamNumber(teamKey)}`,
              ariaLabel: `Name Team ${teamNumber(teamKey)}`,
              ...(gmCardDraft?.team === teamKey && isNameLong(gmCardDraft.value)
                ? { hint: teamNameLongHint(jokerCount) }
                : {}),
            },
          }
        : {}),
      buttons: byName.map(({ m, i }) => ({
        id: `player-${teamKey}-${i}`,
        label: m,
        // The popover names the player in full (`Michael „Michi“ Huber`).
        menuTitle: members[i] ? adminLabel(members[i]) : m,
        menu: [
          ...gmTeamOrder
            .filter(k => k !== teamKey)
            .map(k => ({ id: `mvto-${teamKey}-${i}-${k}`, label: `→ ${teamName(state.teams, k)}` })),
          { id: `rm-${teamKey}-${i}`, label: 'Entfernen', variant: 'danger' as const },
        ],
      })),
    };
  });
  const gmAddPlayerControl: GamemasterControl = {
    type: 'input-group',
    id: 'add-player',
    inputs: [{ id: 'name', label: 'Spieler hinzufügen', inputType: 'text', placeholder: 'Name (mehrere mit Komma)', suggestions }],
    submitLabel: 'Hinzufügen',
    clearOnSubmit: true,
  };
  // "Schon dabei" / first-name clash after an add, right under the add fields.
  const gmFeedbackControls: GamemasterControl[] = addFeedback
    ? [{ type: 'info', id: 'add-player-hint', text: addFeedback.text }]
    : [];
  const gmReshuffleControl: GamemasterControl = { type: 'button', id: 'reshuffle-teams', label: 'Neu mischen' };
  const gmSwapControl: GamemasterControl[] = mirrorEnabled
    ? [{ type: 'button', id: 'swap-teams', label: 'Teams tauschen' }]
    : [];
  const manualTeamControls = (teamKey: TeamKey): GamemasterControl[] => {
    const label = teamName(state.teams, teamKey);
    const members = playerLabels[teamKey];
    return [
      {
        type: 'input-group',
        id: `add-${teamKey}`,
        inputs: [{ id: 'name', label: `${label} – Spieler hinzufügen`, inputType: 'text', placeholder: 'Name', suggestions }],
        submitLabel: 'Hinzufügen',
        clearOnSubmit: true,
      },
      ...(members.length > 0
        ? [{
            type: 'button-group' as const,
            id: `members-${teamKey}`,
            label: `${label} – zum Entfernen tippen`,
            buttons: members.map((m, i) => ({ id: `rm-${teamKey}-${i}`, label: m, variant: 'danger' as const })),
          }]
        : []),
    ];
  };
  let gamemasterControls: GamemasterControl[];
  if (!teamsEnabled) {
    // No teams (point system off) → the GM only needs to advance the show.
    gamemasterControls = [{ type: 'nav', id: 'nav', hideBack: true }];
  } else if (gmEditingTeam !== null) {
    gamemasterControls = [
      {
        type: 'input-group',
        id: 'rename-team',
        inputs: [{
          id: 'teamName',
          label: `Name Team ${teamNumber(gmEditingTeam)}`,
          inputType: 'text',
          placeholder: `Team ${teamNumber(gmEditingTeam)}`,
          value: state.teams[`${gmEditingTeam}Name`] ?? '',
          emitOnChange: true,
        }],
        submitLabel: 'Speichern',
      },
      ...(isNameLong(gmEditValue)
        ? [{
            type: 'info' as const,
            id: 'rename-hint',
            text: teamNameLongHint(jokerCount),
          }]
        : []),
      { type: 'button', id: 'cancel-rename', label: 'Abbrechen' },
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  } else if (!teamRandomizationEnabled) {
    gamemasterControls = [
      ...gmFeedbackControls,
      ...gmTeamOrder.flatMap(manualTeamControls),
      {
        type: 'button-group',
        id: 'edit-team',
        label: 'Teamname ändern',
        buttons: gmEditTeamButtons,
      },
      ...gmSwapControl,
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  } else if (!teamsRevealed) {
    // No "Weiter" here: advancing is blocked until the reveal, so it would only
    // compete with "Teams zuweisen". The actions sit ABOVE the team cards, so
    // the GM never has to scroll past 30+ names to reveal or reshuffle.
    gamemasterControls = [
      {
        type: 'info',
        id: 'draw-preview',
        text: 'Vorschau – auf der Show noch verborgen. Spieler antippen zum Verschieben oder Entfernen.',
      },
      { type: 'button', id: 'reveal-teams', label: 'Teams zuweisen', variant: 'primary', disabled: drawEmpty },
      gmReshuffleControl,
      gmAddPlayerControl,
      ...gmFeedbackControls,
      ...gmDrawControls,
    ];
  } else {
    // Same layout as before the reveal: the actions on top, in the same slots —
    // "Zuweisung verbergen" (undo the reveal; the draw stays) where "Teams zuweisen"
    // was — then the team cards (tap a card's name to rename the team), then
    // swap / "Weiter" at the bottom.
    gamemasterControls = [
      { type: 'button', id: 'hide-teams', label: 'Zuweisung verbergen' },
      gmReshuffleControl,
      gmAddPlayerControl,
      ...gmFeedbackControls,
      ...gmDrawControls,
      ...gmSwapControl,
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  }
  useGamemasterControlsSync(gamemasterControls);

  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward' && (!teamsEnabled || teamsVisible)) {
      navigate('/rules');
    } else if (cmd.controlId === 'reshuffle-teams') {
      reshuffle();
    } else if (cmd.controlId === 'reveal-teams') {
      revealDraw();
    } else if (cmd.controlId === 'hide-teams') {
      // Back to the hidden draw: only the flag moves, the rosters stay as they are.
      dispatch({ type: 'SET_TEAMS_REVEALED', payload: { revealed: false } });
    } else if (cmd.controlId === 'add-player' && cmd.value && typeof cmd.value === 'object') {
      addPlayers((cmd.value as Record<string, string>).name ?? '');

    } else if (cmd.controlId.startsWith('mvto-')) {
      // `mvto-<from>-<index>-<to>` from a player's popover.
      const [, from, index, to] = cmd.controlId.split('-');
      if (from && to && isTeamKey(from) && isTeamKey(to)) moveTo(from, parseInt(index ?? '', 10), to);
    } else if (cmd.controlId.startsWith('add-team') && cmd.value && typeof cmd.value === 'object') {
      const key = cmd.controlId.slice('add-'.length);
      if (isTeamKey(key)) addMember(key, (cmd.value as Record<string, string>).name ?? '');
    } else if (cmd.controlId.startsWith('rm-team')) {
      // `rm-<teamKey>-<index>`
      const rest = cmd.controlId.slice('rm-'.length);
      const dash = rest.lastIndexOf('-');
      const key = rest.slice(0, dash);
      if (isTeamKey(key)) removeMember(key, parseInt(rest.slice(dash + 1), 10));
    } else if (cmd.controlId === 'swap-teams') {
      dispatch({ type: 'SET_TEAM_ORDER', payload: { swapped: !state.teams.orderSwapped } });
    } else if (cmd.controlId.startsWith('edit-team')) {
      const key = cmd.controlId.slice('edit-'.length);
      if (isTeamKey(key)) {
        setGmEditValue(state.teams[`${key}Name`] ?? '');
        setGmEditingTeam(key);
      }
    } else if (cmd.controlId.startsWith('team-name-') && cmd.value && typeof cmd.value === 'object') {
      // The rename on a GM team card: `team-name-<key>` saves, `…:change` mirrors the draft.
      const [id, suffix] = cmd.controlId.split(':');
      const key = id!.slice('team-name-'.length);
      if (!isTeamKey(key)) return;
      const name = (cmd.value as Record<string, string>).name ?? '';
      if (suffix === 'change') {
        setGmCardDraft({ team: key, value: name });
      } else if (suffix === undefined) {
        dispatch({ type: 'SET_TEAM_NAMES', payload: { [`${key}Name`]: name } });
        setGmCardDraft(null);
      }
    } else if (cmd.controlId === 'cancel-rename') {
      setGmEditingTeam(null);
    } else if (cmd.controlId === 'rename-team:change' && cmd.value && typeof cmd.value === 'object') {
      setGmEditValue((cmd.value as Record<string, string>).teamName ?? '');
    } else if (cmd.controlId === 'rename-team' && cmd.value && typeof cmd.value === 'object') {
      const newName = (cmd.value as Record<string, string>).teamName ?? '';
      if (gmEditingTeam) {
        dispatch({ type: 'SET_TEAM_NAMES', payload: { [`${gmEditingTeam}Name`]: newName } });
      }
      setGmEditingTeam(null);
    }
  }, [teamsEnabled, teamsVisible, navigate, revealDraw, reshuffle, addPlayers, moveTo, addMember, removeMember, dispatch, state.teams, gmEditingTeam]));

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addPlayers(addInput);
    setAddInput('');
  };


  // ── Inline team-name editing (show) ──
  const startEdit = (key: TeamKey) => {
    editingRef.current = true;
    setEditValue(state.teams[`${key}Name`] ?? '');
    setEditingTeam(key);
  };
  const finishEdit = (commit: boolean) => {
    if (committingRef.current) return; // already finishing (e.g. blur after Enter)
    committingRef.current = true;
    if (commit && editingTeam) {
      dispatch({ type: 'SET_TEAM_NAMES', payload: { [`${editingTeam}Name`]: editValue } });
    }
    setEditingTeam(null);
    editingRef.current = false;
    setTimeout(() => { committingRef.current = false; }, 0);
  };

  // ── Inline member editing (show) ──
  // A row shows the player's label; focusing it switches to the full name.
  // On blur the edited player is found by identity (the GM may have changed
  // the roster meanwhile), so the edit can never hit the wrong row.
  const startSlotEdit = (team: TeamKey, original: RosterPlayer | null) => {
    editingRef.current = true;
    setSlotEdit({ team, original, text: original ? fullName(original) : '' });
  };

  const commitSlotEdit = () => {
    const edit = slotEdit;
    setSlotEdit(null);
    if (!edit) return;
    const text = normalizeWhitespace(edit.text);
    if (edit.original === null) {
      // The "+ Spieler hinzufügen" ghost slot (a comma list works too).
      if (text) addMember(edit.team, text);
      return;
    }
    const original = edit.original;
    const roster = teamRoster(state.teams, edit.team);
    const idx = roster.findIndex(p => samePlayer(p, original));
    if (idx < 0 || text === fullName(original)) return;
    if (!text) {
      // Clearing the text removes the player.
      removeMember(edit.team, idx);
      return;
    }
    const edited = parsePlayerInput(text, known);
    if (!edited) {
      // A nickname several registry players share: say so, keep the player.
      reportAddition({ accepted: [], duplicates: [], clashes: [], ambiguous: [text] });
      return;
    }
    // The same registry player (case aside): their names come from the
    // registry — rename them in the admin. Nothing to change here.
    if (original.id && samePlayer(edited, original)) return;
    const result = checkAdditions(drawn.filter(p => p !== roster[idx]), [edited]);
    reportAddition(result);
    if (result.accepted.length === 0) return; // a duplicate — the field reverts
    dispatch({ type: 'SET_TEAMS', payload: { [edit.team]: roster.map((p, i) => (i === idx ? edited : p)) } });
    // Another player now (not just a spelling fix): the gameshow swaps them too.
    if (!samePlayer(original, edited)) syncToGameshow([edited], [original]);
  };

  /** Enter or Escape in a roster input ends the edit (blur commits it). */
  const slotKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  const canAdvance = !teamsEnabled || teamsVisible;

  useEffect(() => {
    if (!canAdvance) return;
    // Snapshot whether a field was being edited at pointer-DOWN — captured before
    // the pointerdown's default action blurs that field. The subsequent `click`
    // (which fires after the blur, when `editingRef` is already false) is then
    // swallowed, so clicking out of a field ends the edit WITHOUT advancing; only
    // a second click (with nothing focused) proceeds to the rules.
    let editingAtPointerDown = false;
    const onPointerDown = () => { editingAtPointerDown = editingRef.current; };
    const handleKeydown = (e: KeyboardEvent) => {
      if (editingRef.current) return; // typing in a field — don't advance
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== ' ') return;
      navigate('/rules');
    };
    const handleClick = () => {
      if (editingRef.current || editingAtPointerDown) return; // this click just ended an edit
      navigate('/rules');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('click', handleClick);
    };
  }, [canAdvance, navigate]);

  // The roster is edited inline in BOTH modes — manual assignment AND after a
  // random shuffle: each member is a text input (click to edit, clear the text to
  // remove). In MANUAL mode a trailing blank "ghost" slot is appended so you can
  // add players by typing into it (teams were formed outside the show — you build
  // them by hand here and/or on the gamemaster). In RANDOM mode the ghost slot is
  // hidden — players come from the draw and the GM's add field. The card stops click
  // propagation so editing the roster (or renaming a team) never triggers the
  // window "click to advance" listener — advancing happens via empty-space
  // clicks, the arrow/space keys, or the gamemaster forward control.
  // Member columns per card, MEASURED: one column of names while the card fits
  // the screen without scrolling, more only when it does not; a multi-column
  // card keeps the 1-column font unless a name does not fit its cell. Refit
  // whenever what is shown (names, team names, team count) or the viewport
  // changes. See src/utils/rosterFit.ts and specs/team-management.md.
  const teamsGridRef = useRef<HTMLDivElement>(null);
  const [memberCols, setMemberCols] = useState<Record<string, number>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    const refit = () => setLayoutTick(t => t + 1);
    window.addEventListener('resize', refit);
    // The theme's web font changes every width; fit again once it is in.
    document.fonts?.ready.then(refit).catch(() => {});
    return () => window.removeEventListener('resize', refit);
  }, []);
  const layoutKey = activeTeams
    .map(k => `${playerLabels[k].join('\u0001')}|${slotEdit?.team === k ? slotEdit.text : ''}|${state.teams[`${k}Name`] ?? ''}`)
    .join('\u0002');
  useLayoutEffect(() => {
    const grid = teamsGridRef.current;
    if (!grid) return;
    const next = fitRosterLayout(grid, maxRosterColumns(activeTeams.length));
    setMemberCols(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layoutKey, layoutTick, teamsVisible, activeTeams.length]);

  const renderTeam = (key: TeamKey) => {
    const n = teamNumber(key);
    const members = teamRoster(state.teams, key);
    const labels = playerLabels[key];
    const rowKeys = playerRowKeys(members);
    // In manual mode one trailing blank "ghost" slot adds a player.
    const slots: (RosterPlayer | null)[] = !teamRandomizationEnabled ? [...members, null] : members;
    return (
    <div className="team" id={`${key}`} data-team={key} key={key} onClick={e => e.stopPropagation()}>
      {editingTeam === key ? (
        <>
          <input
            className="team-name-edit-input"
            autoFocus
            value={editValue}
            placeholder={`Team ${n}`}
            aria-label={`Name Team ${n}`}
            onChange={e => setEditValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
              else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
            }}
            onBlur={() => finishEdit(true)}
          />
          {isNameLong(editValue) && (
            <p className="team-name-hint" role="status">{teamNameLongHint(jokerCount)}</p>
          )}
        </>
      ) : (
        <TeamCardName
          team={key}
          name={teamName(state.teams, key)}
          onClick={e => { e.stopPropagation(); startEdit(key); }}
        />
      )}
      <ul className="team-members team-members-editable" data-columns={memberCols[key] ?? 1}>
        {slots.map((player, idx) => {
          const isGhost = player === null;
          const editing = slotEdit !== null && slotEdit.team === key && (
            isGhost ? slotEdit.original === null : slotEdit.original !== null && samePlayer(slotEdit.original, player)
          );
          const value = editing ? slotEdit.text : isGhost ? '' : labels[idx] ?? '';
          return (
            <li key={isGhost ? 'ghost' : rowKeys[idx]} className="team-member-row">
              {isGhost ? (
                // The add slot suggests registry players; a pick fills in the
                // name, Enter (or leaving the field) adds it.
                <SuggestInput
                  className="team-member-input"
                  value={value}
                  suggestions={suggestions}
                  placeholder="+ Spieler hinzufügen"
                  aria-label={`Spieler zu Team ${n} hinzufügen`}
                  onClick={e => e.stopPropagation()}
                  onFocus={() => startSlotEdit(key, null)}
                  onValueChange={text => {
                    setSlotEdit(prev => (prev ? { ...prev, text } : { team: key, original: null, text }));
                  }}
                  onBlur={() => { commitSlotEdit(); editingRef.current = false; }}
                  onKeyDown={slotKeyDown}
                />
              ) : (
                <input
                  className="team-member-input"
                  value={value}
                  aria-label={`Spieler ${idx + 1} · Team ${n}`}
                  onClick={e => e.stopPropagation()}
                  onFocus={() => startSlotEdit(key, player)}
                  onChange={e => {
                    const text = e.target.value;
                    setSlotEdit(prev => (prev ? { ...prev, text } : { team: key, original: player, text }));
                  }}
                  onBlur={() => { commitSlotEdit(); editingRef.current = false; }}
                  onKeyDown={slotKeyDown}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
    );
  };

  return (
    <div id="homeScreen">
      <CacheStatusBanner />
      <h1>{showTitle}</h1>
      <TeamCountWarning />

      {!teamsEnabled ? (
        // Point system off → no teams. Just a start prompt; advancing is handled
        // by the window click/key listener (and the GM forward control).
        <p id="startPrompt">Zum Starten klicken</p>
      ) : hiddenDraw ? (
        <div className="draw-setup">
          <p className="draw-pool-count">
            {drawEmpty ? 'Noch keine Spieler' : `${drawn.length} Spieler · die Teams werden gleich ausgelost`}
          </p>
          {!drawEmpty && (
            <ul
              className="draw-pool"
              aria-label="Spieler"
              data-size={drawn.length <= DRAW_POOL_LARGE_MAX ? 'large' : undefined}
            >
              {drawPool.map(({ player, label, key }) => (
                <li key={key} className="draw-pool-name">
                  <span className="draw-pool-label" title={fullName(player)}>{label}</span>
                  <button
                    type="button"
                    className="draw-pool-remove"
                    aria-label={`${label} entfernen`}
                    title={`${label} entfernen`}
                    onClick={() => removePlayer(player)}
                  >
                    {/* An SVG, not the "×" character: the glyph sits off-centre in its
                        line box in most theme fonts. */}
                    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAdd} className="name-form draw-add-form">
            <SuggestInput
              value={addInput}
              onValueChange={setAddInput}
              suggestions={suggestions}
              placeholder="Name"
              title="Mehrere Namen mit Komma trennen"
              aria-label="Name hinzufügen"
            />
            <button type="submit" disabled={!addInput.trim()}>Hinzufügen</button>
          </form>
          {addFeedback && (
            <p className="draw-add-feedback" role="status" key={addFeedback.n}>{addFeedback.text}</p>
          )}
          <button
            type="button"
            className="draw-reveal-button"
            disabled={drawEmpty}
            onClick={e => {
              // The reveal makes the screen advanceable, and React attaches the
              // window "click to continue" listener while THIS click is still
              // bubbling — which then fired and skipped straight to the rules,
              // so the audience never saw the teams.
              e.stopPropagation();
              revealDraw();
            }}
          >
            Teams zuweisen
          </button>
        </div>
      ) : (
        <>
          {!teamRandomizationEnabled && (
            <p id="teamAssignmentText">
              Spieler den Teams zuweisen:
            </p>
          )}
          <div id="teams" ref={teamsGridRef} data-team-count={activeTeams.length}>
            {/* Crowd-facing setup screen → follow the frontend team order. */}
            {teamDisplayOrder(state.teams.orderSwapped, false, mirrorEnabled, teamCount).map(renderTeam)}
          </div>
          {addFeedback && (
            <p className="draw-add-feedback team-edit-feedback" role="status" key={addFeedback.n}>{addFeedback.text}</p>
          )}
          {hasTeams && mirrorEnabled && (
            <button
              type="button"
              className="swap-teams-button"
              onClick={e => {
                e.stopPropagation();
                dispatch({ type: 'SET_TEAM_ORDER', payload: { swapped: !state.teams.orderSwapped } });
              }}
              aria-label="Teams tauschen"
              title="Vertauscht, welches Team links steht (Frontend + gespiegelt auf dem Gamemaster)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.5 21 3 16.5m0 0 4.5-4.5M3 16.5h13.5" />
                <path d="M16.5 3 21 7.5m0 0-4.5 4.5M7.5 7.5H21" />
              </svg>
            </button>
          )}
        </>
      )}

      <InstallButton variant="frontend" />
    </div>
  );
}
