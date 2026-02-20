import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';

export default function HomeScreen() {
  const { state, assignTeams } = useGameContext();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState('');
  const { teamRandomizationEnabled } = state.settings;
  const { team1, team2 } = state.teams;
  const hasTeams = team1.length > 0 || team2.length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const names = nameInput
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);
    if (names.length > 0) {
      assignTeams(names);
      setNameInput('');
    }
  };

  return (
    <>
      <div id="homeScreen">
        <h1>Game Show</h1>

        {teamRandomizationEnabled && (
          <>
            <p id="teamAssignmentText">
              Namen eingeben, um sie den Teams zuzuweisen:
            </p>
            <form id="nameForm" onSubmit={handleSubmit} className="name-form">
              <textarea
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="Name 1, Name 2, ..."
                required
              />
              <button type="submit">Teams zuweisen</button>
            </form>

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

        {(hasTeams || !teamRandomizationEnabled) && (
          <button
            id="nextButton"
            className="button-centered"
            onClick={() => navigate('/rules')}
          >
            Weiter
          </button>
        )}
      </div>
    </>
  );
}
