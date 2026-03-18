import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import '@/admin.css';

interface StorageItem {
  key: string;
  value: string;
}

export default function AdminScreen() {
  const { state, dispatch } = useGameContext();

  // Teams displayed as comma-separated strings for editing
  const [team1Input, setTeam1Input] = useState('');
  const [team2Input, setTeam2Input] = useState('');
  const [team1Points, setTeam1Points] = useState(0);
  const [team2Points, setTeam2Points] = useState(0);
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [showStorage, setShowStorage] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync from context state
  useEffect(() => {
    setTeam1Input(state.teams.team1.join(', '));
    setTeam2Input(state.teams.team2.join(', '));
    setTeam1Points(state.teams.team1Points);
    setTeam2Points(state.teams.team2Points);
  }, [state.teams]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const saveTeamData = () => {
    try {
      const team1 = team1Input.split(',').map(n => n.trim()).filter(Boolean);
      const team2 = team2Input.split(',').map(n => n.trim()).filter(Boolean);
      dispatch({
        type: 'SET_TEAM_STATE',
        payload: { team1, team2, team1Points, team2Points },
      });
      showMsg('success', '✅ Team-Daten erfolgreich gespeichert!');
    } catch (e) {
      showMsg('error', `❌ Fehler beim Speichern: ${(e as Error).message}`);
    }
  };

  const resetPoints = () => {
    if (confirm('Möchten Sie wirklich die Punkte beider Teams auf 0 zurücksetzen?')) {
      dispatch({ type: 'RESET_POINTS' });
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

  const clearAllStorage = () => {
    if (
      confirm(
        '⚠️ WARNUNG: Möchten Sie wirklich ALLE LocalStorage-Daten löschen?\n\nDies umfasst:\n- Team-Namen\n- Punktestände\n- Alle anderen gespeicherten Daten\n\nDieser Vorgang kann nicht rückgängig gemacht werden!'
      )
    ) {
      if (confirm('Sind Sie sicher? Letzte Chance zum Abbrechen!')) {
        localStorage.clear();
        setShowStorage(false);
        showMsg('success', '🗑️ Alle LocalStorage-Daten wurden gelöscht!');
      }
    }
  };

  return (
    <div className="admin-container">
      <Link to="/" className="back-link">
        ← Zurück zur Startseite
      </Link>

      {/* Team Management */}
      <div className="admin-section">
        <h2>🎮 Team Verwaltung</h2>

        <div className="admin-input-group">
          <label htmlFor="team1NameInput">Team 1 Mitglieder (kommagetrennt):</label>
          <input
            type="text"
            id="team1NameInput"
            placeholder="Alice, Bob, ..."
            value={team1Input}
            onChange={e => setTeam1Input(e.target.value)}
          />
        </div>

        <div className="admin-input-group">
          <label htmlFor="team1PointsInput">Team 1 Punkte:</label>
          <input
            type="number"
            id="team1PointsInput"
            placeholder="0"
            value={team1Points}
            onChange={e => setTeam1Points(parseInt(e.target.value, 10) || 0)}
          />
        </div>

        <div className="admin-input-group">
          <label htmlFor="team2NameInput">Team 2 Mitglieder (kommagetrennt):</label>
          <input
            type="text"
            id="team2NameInput"
            placeholder="Clara, Dave, ..."
            value={team2Input}
            onChange={e => setTeam2Input(e.target.value)}
          />
        </div>

        <div className="admin-input-group">
          <label htmlFor="team2PointsInput">Team 2 Punkte:</label>
          <input
            type="number"
            id="team2PointsInput"
            placeholder="0"
            value={team2Points}
            onChange={e => setTeam2Points(parseInt(e.target.value, 10) || 0)}
          />
        </div>

        <div className="button-group">
          <button onClick={saveTeamData} className="admin-button primary">
            💾 Speichern
          </button>
          <button onClick={resetPoints} className="admin-button secondary">
            🔄 Punkte zurücksetzen
          </button>
        </div>
      </div>

      {/* LocalStorage Management */}
      <div className="admin-section">
        <h2>🗄️ LocalStorage Verwaltung</h2>

        <div className="button-group">
          <button onClick={viewAllStorage} className="admin-button secondary">
            👁️ Alle Daten anzeigen
          </button>
          <button onClick={clearAllStorage} className="admin-button danger">
            🗑️ Alle Daten löschen
          </button>
        </div>

        {showStorage && (
          <div className="storage-viewer">
            {storageItems.length === 0 ? (
              <p className="storage-empty">LocalStorage ist leer</p>
            ) : (
              storageItems.map(item => (
                <div key={item.key} className="storage-item">
                  <span>
                    <span className="storage-item-key">{item.key}:</span>
                    <span className="storage-item-value">{item.value}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
