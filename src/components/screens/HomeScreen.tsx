import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand, GamemasterControl } from '@/types/game';
import { teamName, isTeamNameLong } from '@/utils/teamNames';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';

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
  const [editingTeam, setEditingTeam] = useState<1 | 2 | null>(null);
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
  const [memberDrafts, setMemberDrafts] = useState<{ team1: string[]; team2: string[] }>({
    team1: state.teams.team1,
    team2: state.teams.team2,
  });
  const [membersEditing, setMembersEditing] = useState(false);
  // GM-driven rename: which team the gamemaster is currently editing (null = none),
  // plus the value it's typing (mirrored via emitOnChange) so the show can surface
  // the long-name warning in the GM control panel.
  const [gmEditingTeam, setGmEditingTeam] = useState<1 | 2 | null>(null);
  const [gmEditValue, setGmEditValue] = useState('');
  const { teamRandomizationEnabled } = state.settings;
  const { team1, team2 } = state.teams;
  const hasTeams = team1.length > 0 || team2.length > 0;
  // Each joker column in the header pill steals room from the team name, so the
  // long-name check depends on how MANY jokers are enabled (1 vs 3 differ). The
  // name's actual rendered width is measured (not its char count).
  const jokerCount = (state.settings.enabledJokers ?? []).length;
  const jokerNote = jokerCount > 0 ? ` (mit ${jokerCount} Joker${jokerCount === 1 ? '' : 'n'} weniger Platz)` : '';

  // Broadcast screen info to gamemaster
  useGamemasterSync({
    gameTitle: 'Game Show',
    questionNumber: 0,
    totalQuestions: 0,
    answer: '',
    screenLabel: 'Startseite',
  });

  // ── Manual member add / remove (both show + GM go through these) ──
  // Members-only update via SET_TEAMS; names/points/jokers are preserved and the
  // change auto-syncs to GM/admin over the gamemaster-team-state WS channel.
  const addMember = useCallback((n: 1 | 2, raw: string) => {
    const name = raw.trim();
    if (!name) return;
    dispatch({
      type: 'SET_TEAMS',
      payload: {
        team1: n === 1 ? [...state.teams.team1, name] : state.teams.team1,
        team2: n === 2 ? [...state.teams.team2, name] : state.teams.team2,
      },
    });
  }, [dispatch, state.teams]);

  const removeMember = useCallback((n: 1 | 2, index: number) => {
    dispatch({
      type: 'SET_TEAMS',
      payload: {
        team1: n === 1 ? state.teams.team1.filter((_, i) => i !== index) : state.teams.team1,
        team2: n === 2 ? state.teams.team2.filter((_, i) => i !== index) : state.teams.team2,
      },
    });
  }, [dispatch, state.teams]);

  // Gamemaster controls. A rename in progress takes over regardless of mode.
  // Manual mode → per-team add-player inputs + tap-to-remove member lists.
  // Random mode → pool-name entry (before assignment) or rename buttons (after).
  let gamemasterControls: GamemasterControl[];
  if (gmEditingTeam !== null) {
    gamemasterControls = [
      {
        type: 'input-group',
        id: 'rename-team',
        inputs: [{
          id: 'teamName',
          label: `Name Team ${gmEditingTeam}`,
          inputType: 'text',
          placeholder: `Team ${gmEditingTeam}`,
          value: (gmEditingTeam === 1 ? state.teams.team1Name : state.teams.team2Name) ?? '',
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
      {
        type: 'input-group',
        id: 'add-team1',
        inputs: [{ id: 'name', label: `${teamName(state.teams, 1)} – Spieler hinzufügen`, inputType: 'text', placeholder: 'Name' }],
        submitLabel: 'Hinzufügen',
      },
      ...(team1.length > 0
        ? [{
            type: 'button-group' as const,
            id: 'members-team1',
            label: `${teamName(state.teams, 1)} – zum Entfernen tippen`,
            buttons: team1.map((m, i) => ({ id: `rm-team1-${i}`, label: m, variant: 'danger' as const })),
          }]
        : []),
      {
        type: 'input-group',
        id: 'add-team2',
        inputs: [{ id: 'name', label: `${teamName(state.teams, 2)} – Spieler hinzufügen`, inputType: 'text', placeholder: 'Name' }],
        submitLabel: 'Hinzufügen',
      },
      ...(team2.length > 0
        ? [{
            type: 'button-group' as const,
            id: 'members-team2',
            label: `${teamName(state.teams, 2)} – zum Entfernen tippen`,
            buttons: team2.map((m, i) => ({ id: `rm-team2-${i}`, label: m, variant: 'danger' as const })),
          }]
        : []),
      {
        type: 'button-group',
        id: 'edit-team',
        label: 'Teamname ändern',
        buttons: [
          { id: 'edit-team1', label: teamName(state.teams, 1), variant: 'primary' },
          { id: 'edit-team2', label: teamName(state.teams, 2), variant: 'primary' },
        ],
      },
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  } else if (!hasTeams) {
    gamemasterControls = [
      {
        type: 'input-group',
        id: 'assign-teams',
        inputs: [{ id: 'names', label: 'Namen', inputType: 'text', placeholder: 'Name 1, Name 2, ...' }],
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
        buttons: [
          { id: 'edit-team1', label: teamName(state.teams, 1), variant: 'primary' },
          { id: 'edit-team2', label: teamName(state.teams, 2), variant: 'primary' },
        ],
      },
      { type: 'nav', id: 'nav', hideBack: true },
    ];
  }
  useGamemasterControlsSync(gamemasterControls);

  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward' && (hasTeams || !teamRandomizationEnabled)) {
      navigate('/rules');
    } else if (cmd.controlId === 'assign-teams' && cmd.value && typeof cmd.value === 'object') {
      const names = ((cmd.value as Record<string, string>).names ?? '')
        .split(/[,\n]/).map(n => n.trim()).filter(Boolean);
      if (names.length > 0) assignTeams(names);
    } else if (cmd.controlId === 'add-team1' && cmd.value && typeof cmd.value === 'object') {
      addMember(1, (cmd.value as Record<string, string>).name ?? '');
    } else if (cmd.controlId === 'add-team2' && cmd.value && typeof cmd.value === 'object') {
      addMember(2, (cmd.value as Record<string, string>).name ?? '');
    } else if (cmd.controlId.startsWith('rm-team1-')) {
      removeMember(1, parseInt(cmd.controlId.slice('rm-team1-'.length), 10));
    } else if (cmd.controlId.startsWith('rm-team2-')) {
      removeMember(2, parseInt(cmd.controlId.slice('rm-team2-'.length), 10));
    } else if (cmd.controlId === 'edit-team1') {
      setGmEditValue(state.teams.team1Name ?? '');
      setGmEditingTeam(1);
    } else if (cmd.controlId === 'edit-team2') {
      setGmEditValue(state.teams.team2Name ?? '');
      setGmEditingTeam(2);
    } else if (cmd.controlId === 'cancel-rename') {
      setGmEditingTeam(null);
    } else if (cmd.controlId === 'rename-team:change' && cmd.value && typeof cmd.value === 'object') {
      setGmEditValue((cmd.value as Record<string, string>).teamName ?? '');
    } else if (cmd.controlId === 'rename-team' && cmd.value && typeof cmd.value === 'object') {
      const newName = (cmd.value as Record<string, string>).teamName ?? '';
      if (gmEditingTeam) {
        dispatch({
          type: 'SET_TEAM_NAMES',
          payload: {
            team1Name: gmEditingTeam === 1 ? newName : state.teams.team1Name,
            team2Name: gmEditingTeam === 2 ? newName : state.teams.team2Name,
          },
        });
      }
      setGmEditingTeam(null);
    }
  }, [hasTeams, teamRandomizationEnabled, navigate, assignTeams, addMember, removeMember, dispatch, state.teams, gmEditingTeam]));

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
  const startEdit = (n: 1 | 2) => {
    editingRef.current = true;
    setEditValue((n === 1 ? state.teams.team1Name : state.teams.team2Name) ?? '');
    setEditingTeam(n);
  };
  const finishEdit = (commit: boolean) => {
    if (committingRef.current) return; // already finishing (e.g. blur after Enter)
    committingRef.current = true;
    if (commit && editingTeam) {
      dispatch({
        type: 'SET_TEAM_NAMES',
        payload: {
          team1Name: editingTeam === 1 ? editValue : state.teams.team1Name,
          team2Name: editingTeam === 2 ? editValue : state.teams.team2Name,
        },
      });
    }
    setEditingTeam(null);
    editingRef.current = false;
    setTimeout(() => { committingRef.current = false; }, 0);
  };

  // ── Inline member editing (show, manual mode) ──
  // Mirror external roster changes into the draft whenever we're not typing.
  const teamsKey = `${state.teams.team1.join(' ')}|${state.teams.team2.join(' ')}`;
  useEffect(() => {
    if (!membersEditing) {
      setMemberDrafts({ team1: state.teams.team1, team2: state.teams.team2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsKey, membersEditing]);

  // Render one empty "ghost" slot below the last real member so clicking it adds
  // a player; an all-empty roster still shows a single slot.
  const displayMemberSlots = (members: string[]): string[] =>
    members.length === 0 || members[members.length - 1]!.trim() !== '' ? [...members, ''] : members;

  const updateMemberSlot = (n: 1 | 2, idx: number, value: string) => {
    setMembersEditing(true);
    setMemberDrafts(prev => {
      const key = n === 1 ? 'team1' : 'team2';
      const arr = [...prev[key]];
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
    const t1 = clean(memberDrafts.team1);
    const t2 = clean(memberDrafts.team2);
    if (t1.join(' ') !== state.teams.team1.join(' ') ||
        t2.join(' ') !== state.teams.team2.join(' ')) {
      dispatch({ type: 'SET_TEAMS', payload: { team1: t1, team2: t2 } });
    }
  };

  const canAdvance = hasTeams || !teamRandomizationEnabled;

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
  // random shuffle: each member plus one trailing blank "ghost" slot is a text
  // input. Typing in the blank slot adds a player; clearing a name's text and
  // blurring removes it. The card stops click propagation so editing the roster
  // (or renaming a team) never triggers the window "click to advance" listener —
  // advancing happens via empty-space clicks, the arrow/space keys, or the
  // gamemaster forward control.
  const renderTeam = (n: 1 | 2, members: string[]) => (
    <div className="team" id={`team${n}`} onClick={e => e.stopPropagation()}>
      {editingTeam === n ? (
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
          {isTeamNameLong(editValue, jokerCount) && (
            <p className="team-name-hint" role="status">
              Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt{jokerNote}.
            </p>
          )}
        </>
      ) : (
        <h2
          className="team-name-editable"
          title="Zum Umbenennen klicken"
          onClick={e => { e.stopPropagation(); startEdit(n); }}
        >
          {teamName(state.teams, n)}
        </h2>
      )}
      <ul className="team-members team-members-editable">
        {displayMemberSlots(members).map((value, idx) => {
          const isGhost = idx >= members.length;
          return (
            <li key={idx} className="team-member-row">
              <input
                className="team-member-input"
                value={value}
                placeholder="+ Spieler hinzufügen"
                aria-label={isGhost ? `Spieler zu Team ${n} hinzufügen` : `Spieler ${idx + 1} · Team ${n}`}
                onClick={e => e.stopPropagation()}
                onFocus={() => { editingRef.current = true; setMembersEditing(true); }}
                onChange={e => updateMemberSlot(n, idx, e.target.value)}
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

  return (
    <div id="homeScreen">
      <CacheStatusBanner />
      <h1>Game Show</h1>

      {teamRandomizationEnabled && !hasTeams ? (
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
          <div id="teams">
            {renderTeam(1, memberDrafts.team1)}
            {renderTeam(2, memberDrafts.team2)}
          </div>
        </>
      )}

      <InstallButton variant="frontend" />
    </div>
  );
}
