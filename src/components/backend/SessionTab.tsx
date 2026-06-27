import { useState, useCallback } from 'react';
import { useGameContext } from '@/context/GameContext';
import { isTeamNameLong, TEAM_NAME_SOFT_LIMIT } from '@/utils/teamNames';
import StatusMessage from './StatusMessage';
import { useConfirm } from './ConfirmContext';

interface StorageItem {
  key: string;
  value: string;
}

export default function SessionTab() {
  const { state, dispatch } = useGameContext();
  const confirmDialog = useConfirm();

  const [team1Input, setTeam1Input] = useState(() => state.teams.team1.join(', '));
  const [team2Input, setTeam2Input] = useState(() => state.teams.team2.join(', '));
  const [team1Name, setTeam1Name] = useState(() => state.teams.team1Name ?? '');
  const [team2Name, setTeam2Name] = useState(() => state.teams.team2Name ?? '');
  const [team1Points, setTeam1Points] = useState(() => state.teams.team1Points);
  const [team2Points, setTeam2Points] = useState(() => state.teams.team2Points);
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [showStorage, setShowStorage] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const saveSession = useCallback(() => {
    const team1 = team1Input.split(',').map(n => n.trim()).filter(Boolean);
    const team2 = team2Input.split(',').map(n => n.trim()).filter(Boolean);
    dispatch({
      type: 'SET_TEAM_STATE',
      payload: {
        team1,
        team2,
        team1Name: team1Name.trim() || undefined,
        team2Name: team2Name.trim() || undefined,
        team1Points,
        team2Points,
        team1JokersUsed: state.teams.team1JokersUsed,
        team2JokersUsed: state.teams.team2JokersUsed,
      },
    });
    showMsg('success', 'Gespeichert');
  }, [team1Input, team2Input, team1Name, team2Name, team1Points, team2Points, state.teams.team1JokersUsed, state.teams.team2JokersUsed, dispatch]);

  const resetPoints = async () => {
    if (await confirmDialog({
      title: 'Möchten Sie wirklich die Punkte beider Teams auf 0 zurücksetzen?',
      confirmLabel: 'Zurücksetzen',
    })) {
      dispatch({ type: 'RESET_POINTS' });
      setTeam1Points(0);
      setTeam2Points(0);
      setTeam1Name('');
      setTeam2Name('');
      showMsg('success', '🔄 Punkte wurden zurückgesetzt!');
    }
  };

  const viewAllStorage = useCallback(() => {
    const items: StorageItem[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      items.push({ key, value: localStorage.getItem(key) || '' });
    }
    setStorageItems(items);
    setShowStorage(prev => !prev);
  }, []);

  const clearAllStorage = async () => {
    if (!(await confirmDialog({
      title: '⚠️ Wirklich ALLE LocalStorage-Daten löschen?',
      description: 'Dieser Vorgang kann nicht rückgängig gemacht werden!',
    }))) return;
    // CLEAR_ALL wipes localStorage AND resets in-memory state in one
    // reducer pass. Without the in-memory reset, the next input blur
    // would restore the old names via saveSession, and the show tab
    // would keep broadcasting them over WebSocket.
    dispatch({ type: 'CLEAR_ALL' });
    setTeam1Input('');
    setTeam2Input('');
    setTeam1Name('');
    setTeam2Name('');
    setTeam1Points(0);
    setTeam2Points(0);
    setShowStorage(false);
    showMsg('success', '🗑️ Alle LocalStorage-Daten wurden gelöscht!');
  };

  return (
    <div>
      <StatusMessage message={message} />

      <div className="backend-card">
        <h3>Team Verwaltung</h3>
        <div className="session-team-grid">
          <div>
            <label className="be-label">Team 1 Name (optional)</label>
            <input
              className="be-input"
              placeholder="Team 1"
              value={team1Name}
              onChange={e => setTeam1Name(e.target.value)}
              onBlur={saveSession}
            />
            {isTeamNameLong(team1Name) && (
              <p className="be-field-hint" role="status">
                Über {TEAM_NAME_SOFT_LIMIT} Zeichen – wird im Header auf kleineren Bildschirmen abgekürzt.
              </p>
            )}
            <label className="be-label">Team 1 Mitglieder</label>
            <input
              className="be-input"
              placeholder="Alice, Bob, ..."
              value={team1Input}
              onChange={e => setTeam1Input(e.target.value)}
              onBlur={saveSession}
            />
            <label className="be-label">Team 1 Punkte</label>
            <input
              className="be-input"
              type="number"
              value={team1Points}
              onChange={e => setTeam1Points(parseInt(e.target.value, 10) || 0)}
              onBlur={saveSession}
            />
          </div>
          <div>
            <label className="be-label">Team 2 Name (optional)</label>
            <input
              className="be-input"
              placeholder="Team 2"
              value={team2Name}
              onChange={e => setTeam2Name(e.target.value)}
              onBlur={saveSession}
            />
            {isTeamNameLong(team2Name) && (
              <p className="be-field-hint" role="status">
                Über {TEAM_NAME_SOFT_LIMIT} Zeichen – wird im Header auf kleineren Bildschirmen abgekürzt.
              </p>
            )}
            <label className="be-label">Team 2 Mitglieder</label>
            <input
              className="be-input"
              placeholder="Clara, Dave, ..."
              value={team2Input}
              onChange={e => setTeam2Input(e.target.value)}
              onBlur={saveSession}
            />
            <label className="be-label">Team 2 Punkte</label>
            <input
              className="be-input"
              type="number"
              value={team2Points}
              onChange={e => setTeam2Points(parseInt(e.target.value, 10) || 0)}
              onBlur={saveSession}
            />
          </div>
        </div>
        <div className="be-actions">
          <button className="admin-button secondary" onClick={resetPoints}>🔄 Punkte zurücksetzen</button>
        </div>
      </div>

      <div className="backend-card">
        <h3>LocalStorage</h3>
        <div className="be-actions" style={{ marginTop: 0 }}>
          <button className="be-icon-btn" onClick={viewAllStorage}>
            {showStorage ? 'Verbergen' : 'Anzeigen'}
          </button>
          <button className="be-icon-btn danger" onClick={clearAllStorage}>🗑️ Alles löschen</button>
        </div>
        {showStorage && (
          <div className="be-storage-viewer">
            {storageItems.length === 0 ? (
              <div className="be-empty" style={{ padding: '10px 0' }}>LocalStorage ist leer</div>
            ) : (
              storageItems.map(item => (
                <div key={item.key} className="be-storage-item">
                  <span className="be-storage-key">{item.key}:</span>
                  <span className="be-storage-value">{item.value}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
