import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand, GamemasterControl } from '@/types/game';
import { teamName, isTeamNameLong } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { ALL_TEAM_KEYS, teamKeys, teamNumber, teamRoster, isTeamKey, type TeamKey } from '@/utils/teams';
import TeamCountWarning from '@/components/screens/TeamCountWarning';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';
import TeamDot from '@/components/common/TeamDot';

export default function HomeScreen() {
  const { state, dispatch, assignTeams } = useGameContext();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState('');
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
  // Whether this show has TEAMS to set up at all. Two things switch it off, and
  // both suppress the entire assignment/overview UI so the host just starts:
  //   0 teams — the point system is off, there is nothing to score.
  //   1 team  — points ARE awarded, but there is no second team to split players
  //             between or compete against: the audience plays the show itself.
  // The server backs this up by forcing `teamRandomizationEnabled` off below two
  // teams. See specs/team-count.md and specs/point-system.md.
  const teamsEnabled = pointSystemEnabled && activeTeams.length > 1;
  // Each joker column in the header pill steals room from the team name, so the
  // long-name check depends on how MANY jokers are enabled (1 vs 3 differ). The
  // name's actual rendered width is measured (not its char count).
  const jokerCount = (state.settings.enabledJokers ?? []).length;
  const jokerNote = jokerCount > 0 ? ` (mit ${jokerCount} Joker${jokerCount === 1 ? '' : 'n'} weniger Platz)` : '';

  // When the active gameshow has a configured roster (`GameshowConfig.players`),
  // prefill the randomization textarea once so the host only has to click "Teams
  // zuweisen". Runs only while the textarea is actually shown (random mode, no
  // teams yet) and only if the host hasn't already typed something — never
  // clobber their input. The ref makes this a one-shot after settings load.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    if (!teamsEnabled || !teamRandomizationEnabled || hasTeams || players.length === 0) return;
    prefilledRef.current = true;
    setNameInput(prev => (prev.trim() === '' ? players.join(', ') : prev));
  }, [players, teamsEnabled, teamRandomizationEnabled, hasTeams]);

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
      ...(isTeamNameLong(gmEditValue, jokerCount)
        ? [{
            type: 'info' as const,
            id: 'rename-hint',
            text: `Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt${jokerNote}.`,
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
  } else if (!hasTeams) {
    gamemasterControls = [
      {
        type: 'input-group',
        id: 'assign-teams',
        // The roster is mirrored both ways: the show's prefilled/typed value seeds
        // the GM field (`value`), and every GM keystroke is echoed back to the show
        // (`emitOnChange` → 'assign-teams:change' → setNameInput) so the frontend
        // textarea reflects GM edits live. See specs/team-management.md.
        inputs: [{ id: 'names', label: 'Namen', inputType: 'text', placeholder: 'Name 1, Name 2, ...', value: nameInput, emitOnChange: true }],
        submitLabel: 'Teams zuweisen',
      },
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  } else {
    gamemasterControls = [
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
    if (cmd.controlId === 'nav-forward' && (!teamsEnabled || hasTeams || !teamRandomizationEnabled)) {
      navigate('/rules');
    } else if (cmd.controlId === 'assign-teams:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM's roster field is reflected in the
      // frontend textarea so the host/spectators see the names being edited.
      setNameInput((cmd.value as Record<string, string>).names ?? '');
    } else if (cmd.controlId === 'assign-teams' && cmd.value && typeof cmd.value === 'object') {
      const names = ((cmd.value as Record<string, string>).names ?? '')
        .split(/[,\n]/).map(n => n.trim()).filter(Boolean);
      if (names.length > 0) assignTeams(names);
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
  }, [teamsEnabled, hasTeams, teamRandomizationEnabled, navigate, assignTeams, addMember, removeMember, dispatch, state.teams, gmEditingTeam]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const names = nameInput
      .split(/[,\n]/)
      .map(n => n.trim())
      .filter(Boolean);
    if (names.length > 0) {
      assignTeams(names);
      setNameInput('');
    }
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

  const canAdvance = !teamsEnabled || hasTeams || !teamRandomizationEnabled;

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
  // hidden — names come from the pool textarea/shuffle. The card stops click
  // propagation so editing the roster (or renaming a team) never triggers the
  // window "click to advance" listener — advancing happens via empty-space
  // clicks, the arrow/space keys, or the gamemaster forward control.
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
          {isTeamNameLong(editValue, jokerCount, activeTeams.length) && (
            <p className="team-name-hint" role="status">
              Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt{jokerNote}.
            </p>
          )}
        </>
      ) : (
        <h2
          className="team-name-editable"
          title="Zum Umbenennen klicken"
          onClick={e => { e.stopPropagation(); startEdit(key); }}
        >
          <TeamDot team={key} />{teamName(state.teams, key)}
        </h2>
      )}
      <ul className="team-members team-members-editable">
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
      ) : teamRandomizationEnabled && !hasTeams ? (
        <>
          <p id="teamAssignmentText">
            Namen eingeben, um sie den Teams zuzuweisen:
          </p>
          <form onSubmit={handleSubmit} className="name-form">
            <textarea
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              placeholder="Name 1, Name 2, ..."
              required
            />
            <button type="submit">Teams zuweisen</button>
          </form>
        </>
      ) : (
        <>
          {!teamRandomizationEnabled && (
            <p id="teamAssignmentText">
              Spieler den Teams zuweisen:
            </p>
          )}
          <div id="teams" data-team-count={activeTeams.length}>
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
