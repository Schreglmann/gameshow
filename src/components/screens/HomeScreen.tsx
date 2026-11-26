import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand, GamemasterControl } from '@/types/game';
import { teamName, teamNameLongHint } from '@/utils/teamNames';
import { useTeamNameCheck } from '@/hooks/useTeamNameCheck';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { ALL_TEAM_KEYS, teamKeys, teamNumber, teamRoster, isTeamKey, type TeamKey } from '@/utils/teams';
import TeamCountWarning from '@/components/screens/TeamCountWarning';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';
import TeamCardName from '@/components/common/TeamCardName';
import { isInactiveShowTab, onBecameActive } from '@/services/showPresenceState';
import { drawnPlayers, movePlayer, normalizePlayerName, parsePlayerNames, removePlayerByName } from '@/utils/teamDraw';
import { fitRosterLayout, maxRosterColumns } from '@/utils/rosterFit';

/** The player grid before the reveal is alphabetical, so team order can't give the draw away. */
const alphabetical = (names: readonly string[]) => [...names].sort((a, b) => a.localeCompare(b, 'de'));

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
  // Manual team assignment (teamRandomizationEnabled === false): the roster is
  // edited inline as a list of text inputs plus one trailing blank "ghost" slot.
  // We keep a local draft while typing (so a cleared field doesn't vanish
  // mid-keystroke) and commit to SET_TEAMS on blur; the resync effect below
  // mirrors external changes (e.g. the gamemaster) back in when we're not typing.
  const [memberDrafts, setMemberDrafts] = useState<Partial<Record<TeamKey, string[]>>>(() => {
    const drafts: Partial<Record<TeamKey, string[]>> = {};
    for (const key of ALL_TEAM_KEYS) drafts[key] = state.teams[key] ?? [];
    return drafts;
  });
  const [membersEditing, setMembersEditing] = useState(false);
  // GM-driven rename: which team the gamemaster is currently editing (null = none),
  // plus the value it's typing (mirrored via emitOnChange) so the show can surface
  // the long-name warning in the GM control panel.
  const [gmEditingTeam, setGmEditingTeam] = useState<TeamKey | null>(null);
  const [gmEditValue, setGmEditValue] = useState('');
  const { pointSystemEnabled, teamRandomizationEnabled, players, teamCount, showTitle } = state.settings;
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
  // tab, live reload): place the added names and drop the removed ones, the
  // same way the add field and the ✕ do.
  const prevPlayersRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!state.settingsLoaded) return;
    const prev = prevPlayersRef.current;
    prevPlayersRef.current = players;
    if (prev === null || !hiddenDraw || isInactiveShowTab()) return;
    if (prev.join('\n') === players.join('\n')) return;
    const count = (list: readonly string[]) => {
      const m = new Map<string, number>();
      for (const n of list) {
        const k = normalizePlayerName(n).toLowerCase();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const before = count(prev);
    const after = count(players);
    const names = [...drawn];
    for (const [k, n] of before) {
      for (let i = 0; i < n - (after.get(k) ?? 0); i++) {
        const idx = names.findIndex(x => normalizePlayerName(x).toLowerCase() === k);
        if (idx >= 0) names.splice(idx, 1);
      }
    }
    const added = new Map(after);
    for (const [k, n] of before) added.set(k, (added.get(k) ?? 0) - n);
    for (const p of players) {
      const k = normalizePlayerName(p).toLowerCase();
      const left = added.get(k) ?? 0;
      if (left <= 0) continue;
      added.set(k, left - 1);
      names.push(p);
    }
    reconcileTeamDraw(names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, state.settingsLoaded]);

  /** Add one or more (comma-separated) players: each joins the smallest team. */
  const addPlayers = useCallback((raw: string) => {
    const names = parsePlayerNames(raw);
    if (names.length > 0) reconcileTeamDraw([...drawn, ...names]);
  }, [drawn, reconcileTeamDraw]);

  /** Remove one player by name (the show's ✕), wherever the draw put them. */
  const removePlayer = useCallback((name: string) => {
    const patch = removePlayerByName(state.teams, activeTeams, name);
    if (patch) dispatch({ type: 'SET_TEAMS', payload: patch });
  }, [state.teams, activeTeams, dispatch]);

  /** "Teams zuweisen": show the draw as it is — never reshuffles. */
  const revealDraw = useCallback(() => {
    if (drawn.length > 0) revealTeams();
  }, [drawn.length, revealTeams]);

  /** GM popover "→ Team X": move the player at `index` of team `from`. */
  const moveTo = useCallback((from: TeamKey, index: number, to: TeamKey) => {
    const name = teamRoster(state.teams, from)[index];
    if (name === undefined) return;
    const patch = movePlayer(state.teams, from, name, to);
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
    const name = raw.trim();
    if (!name) return;
    dispatch({ type: 'SET_TEAMS', payload: { [key]: [...teamRoster(state.teams, key), name] } });
  }, [dispatch, state.teams]);

  const removeMember = useCallback((key: TeamKey, index: number) => {
    dispatch({
      type: 'SET_TEAMS',
      payload: { [key]: teamRoster(state.teams, key).filter((_, i) => i !== index) },
    });
  }, [dispatch, state.teams]);

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
  // ids keep the roster index, which is what the commands address.
  // See specs/team-management.md ("Verdeckte Auslosung").
  const gmDrawControls: GamemasterControl[] = gmTeamOrder.map(teamKey => {
    const members = teamRoster(state.teams, teamKey);
    const byName = members
      .map((m, i) => ({ m, i }))
      .sort((a, b) => a.m.localeCompare(b.m, 'de'));
    return {
      type: 'button-group',
      id: `draw-${teamKey}`,
      label: `${teamName(state.teams, teamKey)} (${members.length})`,
      layout: 'grid',
      team: teamKey,
      buttons: byName.map(({ m, i }) => ({
        id: `player-${teamKey}-${i}`,
        label: m,
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
    inputs: [{ id: 'name', label: 'Spieler hinzufügen', inputType: 'text', placeholder: 'Name (mehrere mit Komma)' }],
    submitLabel: 'Hinzufügen',
  };
  const gmReshuffleControl: GamemasterControl = { type: 'button', id: 'reshuffle-teams', label: 'Neu mischen' };
  const gmSwapControl: GamemasterControl[] = mirrorEnabled
    ? [{ type: 'button', id: 'swap-teams', label: 'Teams tauschen' }]
    : [];
  const manualTeamControls = (teamKey: TeamKey): GamemasterControl[] => {
    const label = teamName(state.teams, teamKey);
    const members = teamRoster(state.teams, teamKey);
    return [
      {
        type: 'input-group',
        id: `add-${teamKey}`,
        inputs: [{ id: 'name', label: `${label} – Spieler hinzufügen`, inputType: 'text', placeholder: 'Name' }],
        submitLabel: 'Hinzufügen',
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
      ...gmDrawControls,
    ];
  } else {
    // Same layout as before the reveal: the actions on top, in the same slots —
    // "Zuweisung verbergen" (undo the reveal; the draw stays) where "Teams zuweisen"
    // was — then the team cards, then rename / swap / "Weiter" at the bottom.
    gamemasterControls = [
      { type: 'button', id: 'hide-teams', label: 'Zuweisung verbergen' },
      gmReshuffleControl,
      gmAddPlayerControl,
      ...gmDrawControls,
      {
        type: 'button-group',
        id: 'edit-team',
        label: 'Teamname ändern',
        buttons: gmEditTeamButtons,
      },
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

  // ── Inline member editing (show, manual mode) ──
  // Mirror external roster changes into the draft whenever we're not typing.
  // Keyed on EVERY team's roster, so a change to team 3 or 4 resyncs the drafts
  // too — a key covering only team1/team2 left their rosters out of the draft and
  // the show rendered them as empty.
  const teamsKey = ALL_TEAM_KEYS.map(k => (state.teams[k] ?? []).join(' ')).join('|');
  useEffect(() => {
    if (!membersEditing) {
      const drafts: Partial<Record<TeamKey, string[]>> = {};
      for (const key of ALL_TEAM_KEYS) drafts[key] = state.teams[key] ?? [];
      setMemberDrafts(drafts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsKey, membersEditing]);

  // Render one empty "ghost" slot below the last real member so clicking it adds
  // a player; an all-empty roster still shows a single slot.
  const displayMemberSlots = (members: string[]): string[] =>
    members.length === 0 || members[members.length - 1]!.trim() !== '' ? [...members, ''] : members;

  const updateMemberSlot = (key: TeamKey, idx: number, value: string) => {
    setMembersEditing(true);
    setMemberDrafts(prev => {
      const arr = [...(prev[key] ?? [])];
      while (arr.length <= idx) arr.push('');
      arr[idx] = value;
      return { ...prev, [key]: arr };
    });
  };

  // Commit on blur: trim + drop every empty slot (so clearing a name's text
  // removes it), and persist via SET_TEAMS only when something actually changed.
  const commitMembers = () => {
    setMembersEditing(false);
    const clean = (arr: string[]) => arr.map(s => s.trim()).filter(Boolean);
    // Only the teams that actually changed travel — SET_TEAMS is a patch.
    const patch: Partial<Record<TeamKey, string[]>> = {};
    for (const key of activeTeams) {
      const next = clean(memberDrafts[key] ?? []);
      if (next.join(' ') !== teamRoster(state.teams, key).join(' ')) patch[key] = next;
    }
    if (Object.keys(patch).length > 0) dispatch({ type: 'SET_TEAMS', payload: patch });
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
    .map(k => `${(memberDrafts[k] ?? []).join('\u0001')}|${state.teams[`${k}Name`] ?? ''}`)
    .join('\u0002');
  useLayoutEffect(() => {
    const grid = teamsGridRef.current;
    if (!grid) return;
    const next = fitRosterLayout(grid, maxRosterColumns(activeTeams.length));
    setMemberCols(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layoutKey, layoutTick, teamsVisible, activeTeams.length]);

  const renderTeam = (key: TeamKey) => {
    const n = teamNumber(key);
    const members = memberDrafts[key] ?? [];
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
        {(!teamRandomizationEnabled ? displayMemberSlots(members) : members).map((value, idx) => {
          const isGhost = idx >= members.length;
          return (
            <li key={idx} className="team-member-row">
              <input
                className="team-member-input"
                value={value}
                placeholder={isGhost ? '+ Spieler hinzufügen' : undefined}
                aria-label={isGhost ? `Spieler zu Team ${n} hinzufügen` : `Spieler ${idx + 1} · Team ${n}`}
                onClick={e => e.stopPropagation()}
                onFocus={() => { editingRef.current = true; setMembersEditing(true); }}
                onChange={e => updateMemberSlot(key, idx, e.target.value)}
                onBlur={() => { commitMembers(); editingRef.current = false; }}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
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
            <ul className="draw-pool" aria-label="Spieler">
              {alphabetical(drawn).map((name, i) => (
                <li key={`${name}-${i}`} className="draw-pool-name">
                  <span className="draw-pool-label">{name}</span>
                  <button
                    type="button"
                    className="draw-pool-remove"
                    aria-label={`${name} entfernen`}
                    title={`${name} entfernen`}
                    onClick={() => removePlayer(name)}
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
            <input
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              placeholder="Name hinzufügen"
              title="Mehrere Namen mit Komma trennen"
              aria-label="Name hinzufügen"
            />
            <button type="submit" disabled={!addInput.trim()}>Hinzufügen</button>
          </form>
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
