import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import '@/admin.css';

interface StorageItem {
  key: string;
  value: string;
}

export default function AdminScreen() {
  const [team1Name, setTeam1Name] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [team1Points, setTeam1Points] = useState(0);
  const [team2Points, setTeam2Points] = useState(0);
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [showStorage, setShowStorage] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = useCallback(() => {
    setTeam1Name(localStorage.getItem('team1') || '');
    setTeam2Name(localStorage.getItem('team2') || '');
    setTeam1Points(parseInt(localStorage.getItem('team1Points') || '0', 10));
    setTeam2Points(parseInt(localStorage.getItem('team2Points') || '0', 10));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const saveTeamData = () => {
    try {
      localStorage.setItem('team1', team1Name);
      localStorage.setItem('team2', team2Name);
      localStorage.setItem('team1Points', String(team1Points));
      localStorage.setItem('team2Points', String(team2Points));
      showMsg('success', '✅ Team-Daten erfolgreich gespeichert!');
    } catch (e) {
      showMsg('error', `❌ Fehler beim Speichern: ${(e as Error).message}`);
    }
  };

  const resetPoints = () => {
    if (confirm('Möchten Sie wirklich die Punkte beider Teams auf 0 zurücksetzen?')) {
      localStorage.setItem('team1Points', '0');
      localStorage.setItem('team2Points', '0');
      setTeam1Points(0);
      setTeam2Points(0);
      showMsg('success', '🔄 Punkte wurden zurückgesetzt!');
    }
  };

  const viewAllStorage = () => {
    const items: StorageItem[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      items.push({ key, value: localStorage.getItem(key) || '' });
    }
    setStorageItems(items);
    setShowStorage(!showStorage);
  };

  const clearAllStorage = () => {
    if (
      confirm(
        '⚠️ WARNUNG: Möchten Sie wirklich ALLE LocalStorage-Daten löschen?\n\nDies umfasst:\n- Team-Namen\n- Punktestände\n- Alle anderen gespeicherten Daten\n\nDieser Vorgang kann nicht rückgängig gemacht werden!'
      )
    ) {
      if (confirm('Sind Sie sicher? Letzte Chance zum Abbrechen!')) {
        localStorage.clear();
        loadData();
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
          <label htmlFor="team1NameInput">Team 1 Name:</label>
          <input
            type="text"
            id="team1NameInput"
            placeholder="Team 1 Name eingeben"
            value={team1Name}
            onChange={e => setTeam1Name(e.target.value)}
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
          <label htmlFor="team2NameInput">Team 2 Name:</label>
          <input
            type="text"
            id="team2NameInput"
            placeholder="Team 2 Name eingeben"
            value={team2Name}
            onChange={e => setTeam2Name(e.target.value)}
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
              <p style={{ color: '#fff', textAlign: 'center' }}>LocalStorage ist leer</p>
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
        <div className={`message ${message.type}`} style={{ display: 'block' }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
