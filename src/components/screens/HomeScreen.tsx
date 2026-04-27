import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';
import CacheStatusBanner from './CacheStatusBanner';
import InstallButton from '@/components/common/InstallButton';

export default function HomeScreen() {
  const { state, assignTeams } = useGameContext();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState('');
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

  const gamemasterControls = teamRandomizationEnabled
    ? [
        {
          type: 'input-group' as const,
          id: 'assign-teams',
          inputs: [{ id: 'names', label: 'Namen', inputType: 'text' as const, placeholder: 'Name 1, Name 2, ...' }],
          submitLabel: 'Teams zuweisen',
        },
        { type: 'nav' as const, id: 'nav', hideBack: true },
      ]
    : [{ type: 'nav' as const, id: 'nav', hideBack: true }];
  useGamemasterControlsSync(gamemasterControls);

  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward' && (hasTeams || !teamRandomizationEnabled)) {
      navigate('/rules');
    } else if (cmd.controlId === 'assign-teams' && cmd.value && typeof cmd.value === 'object') {
      const raw = (cmd.value as Record<string, string>).names ?? '';
      const names = raw.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
      if (names.length > 0) {
        assignTeams(names);
      }
    }
  }, [hasTeams, teamRandomizationEnabled, navigate, assignTeams]));

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

  const canAdvance = hasTeams || !teamRandomizationEnabled;

  useEffect(() => {
    if (!canAdvance) return;
    const handleAdvance = (e: KeyboardEvent | MouseEvent) => {
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
              <div className="team" id="team1">
                <h2>Team 1</h2>
                <ul>
                  {team1.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </div>
              <div className="team" id="team2">
                <h2>Team 2</h2>
                <ul>
                  {team2.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      <InstallButton variant="frontend" />
    </div>
  );
}
