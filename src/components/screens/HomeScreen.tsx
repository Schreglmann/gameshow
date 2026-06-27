import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand, GamemasterControl } from '@/types/game';
import { teamName, isTeamNameLong, TEAM_NAME_SOFT_LIMIT } from '@/utils/teamNames';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';

export default function HomeScreen() {
  const { state, dispatch, assignTeams } = useGameContext();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState('');
  // Inline team-name editing on the show: clicking a team heading turns it into
  // an input. `editingRef` mirrors the active edit so the window-level
  // "click anywhere to advance" listener can ignore clicks while renaming.
  const [editingTeam, setEditingTeam] = useState<1 | 2 | null>(null);
  const [editValue, setEditValue] = useState('');
  const editingRef = useRef(false);
  // Guards against a second finishEdit() firing when the focused input unmounts
  // (Enter/Escape sets editingTeam=null → blur fires during React's commit).
  const committingRef = useRef(false);
  // GM-driven rename: which team the gamemaster is currently editing (null = none),
  // plus the value it's typing (mirrored via emitOnChange) so the show can surface
  // the long-name warning in the GM control panel.
  const [gmEditingTeam, setGmEditingTeam] = useState<1 | 2 | null>(null);
  const [gmEditValue, setGmEditValue] = useState('');
  const { teamRandomizationEnabled } = state.settings;
  const { team1, team2 } = state.teams;
  const hasTeams = team1.length > 0 || team2.length > 0;

  // Broadcast screen info to gamemaster
  useGamemasterSync({
    gameTitle: 'Game Show',
    questionNumber: 0,
    totalQuestions: 0,
    answer: '',
    screenLabel: 'Startseite',
  });

  // Gamemaster controls. Before assignment: a single "names" input. After
  // assignment: the two team names as buttons; tapping one swaps to a rename
  // input — mirroring the show's click-to-edit. (No upfront name text fields.)
  let gamemasterControls: GamemasterControl[];
  if (!teamRandomizationEnabled) {
    gamemasterControls = [{ type: 'nav', id: 'nav', hideBack: true }];
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
  } else if (gmEditingTeam === null) {
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
  } else {
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
      ...(isTeamNameLong(gmEditValue)
        ? [{
            type: 'info' as const,
            id: 'rename-hint',
            text: `Über ${TEAM_NAME_SOFT_LIMIT} Zeichen werden im Punkte-Header auf kleineren Bildschirmen abgekürzt.`,
          }]
        : []),
      { type: 'button', id: 'cancel-rename', label: 'Abbrechen' },
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
  }, [hasTeams, teamRandomizationEnabled, navigate, assignTeams, dispatch, state.teams, gmEditingTeam]));

  // Skip this screen entirely when team randomization is disabled
  useEffect(() => {
    if (state.settingsLoaded && !teamRandomizationEnabled) {
      navigate('/rules');
    }
  }, [state.settingsLoaded, teamRandomizationEnabled, navigate]);

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
    // Keep suppressing the "click to advance" listener through the end of the
    // current click cycle (blur fires during mousedown, before the click), then
    // release both guards so the next click advances / a new edit can start.
    setTimeout(() => { editingRef.current = false; committingRef.current = false; }, 0);
  };

  const canAdvance = hasTeams || !teamRandomizationEnabled;

  useEffect(() => {
    if (!canAdvance) return;
    const handleAdvance = (e: KeyboardEvent | MouseEvent) => {
      if (editingRef.current) return; // renaming a team — don't advance
      if (e instanceof KeyboardEvent && e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== ' ') return;
      navigate('/rules');
    };
    window.addEventListener('keydown', handleAdvance);
    window.addEventListener('click', handleAdvance);
    return () => {
      window.removeEventListener('keydown', handleAdvance);
      window.removeEventListener('click', handleAdvance);
    };
  }, [canAdvance, navigate]);

  const renderTeam = (n: 1 | 2, members: string[]) => (
    <div className="team" id={`team${n}`}>
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
          {isTeamNameLong(editValue) && (
            <p className="team-name-hint" role="status">
              Über {TEAM_NAME_SOFT_LIMIT} Zeichen werden im Punkte-Header auf kleineren Bildschirmen abgekürzt.
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
      <ul>
        {members.map((name, i) => (
          <li key={i}>{name}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div id="homeScreen">
      <CacheStatusBanner />
      <h1>Game Show</h1>

      {teamRandomizationEnabled && (
        <>
          {!hasTeams && (
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
          )}

          {hasTeams && (
            <div id="teams">
              {renderTeam(1, team1)}
              {renderTeam(2, team2)}
            </div>
          )}
        </>
      )}

      <InstallButton variant="frontend" />
    </div>
  );
}
