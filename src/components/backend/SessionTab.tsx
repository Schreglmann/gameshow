import { useState, useCallback, useMemo } from 'react';
import { useGameContext } from '@/context/GameContext';
import { isTeamNameLong } from '@/utils/teamNames';
import StatusMessage from './StatusMessage';
import { useConfirm } from './ConfirmContext';

interface StorageItem {
  key: string;
  value: string;
}

/** The six operator-editable fields, each mirroring one part of `TeamState`. */
type FieldKey = 'team1' | 'team2' | 'team1Name' | 'team2Name' | 'team1Points' | 'team2Points';

export default function SessionTab() {
  const { state, dispatch } = useGameContext();
  const confirmDialog = useConfirm();

  // Each joker column in the header pill steals room from the team name, so the
  // long-name check depends on how MANY jokers are enabled (1 vs 3 differ). The
  // name's actual rendered width is measured (not its char count).
  const jokerCount = (state.settings.enabledJokers ?? []).length;
  const jokerNote = jokerCount > 0 ? ` (mit ${jokerCount} Joker${jokerCount === 1 ? '' : 'n'} weniger Platz)` : '';

  // The live values, straight from context. Points are strings so a field can be
  // cleared while editing (an empty string is a valid intermediate state).
  const live = useMemo(() => ({
    team1: state.teams.team1.join(', '),
    team2: state.teams.team2.join(', '),
    team1Name: state.teams.team1Name ?? '',
    team2Name: state.teams.team2Name ?? '',
    team1Points: String(state.teams.team1Points),
    team2Points: String(state.teams.team2Points),
  }), [state.teams]);

  // Uncommitted keystrokes ONLY. Every field the operator is not currently
  // editing falls through to `live`, so the tab keeps showing the real score
  // while games are running. It used to seed all six from a lazy useState and
  // never re-read them, which meant the tab displayed whatever the score was
  // when it was opened, and — because saveSession runs on every blur — pushed
  // that stale snapshot back out over WS, undoing awards on every device.
  const [edits, setEdits] = useState<Partial<Record<FieldKey, string>>>({});
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [showStorage, setShowStorage] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const valueOf = (key: FieldKey): string => edits[key] ?? live[key];
  const editField = (key: FieldKey) => (v: string) => setEdits(prev => ({ ...prev, [key]: v }));

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /**
   * Commit the pending edits onto whatever the team state is RIGHT NOW, so a
   * field the operator never touched can never overwrite a concurrent award.
   * A blur that changed nothing dispatches nothing — no state churn, no
   * broadcast, nothing for the other devices to reconcile.
   */
  const saveSession = useCallback(() => {
    if (Object.keys(edits).length === 0) return;
    const parseMembers = (v: string) => v.split(',').map(n => n.trim()).filter(Boolean);
    const teams = state.teams;
    const next = {
      ...teams,
      ...(edits.team1 !== undefined ? { team1: parseMembers(edits.team1) } : {}),
      ...(edits.team2 !== undefined ? { team2: parseMembers(edits.team2) } : {}),
      ...(edits.team1Name !== undefined ? { team1Name: edits.team1Name.trim() || undefined } : {}),
      ...(edits.team2Name !== undefined ? { team2Name: edits.team2Name.trim() || undefined } : {}),
      ...(edits.team1Points !== undefined ? { team1Points: parseInt(edits.team1Points, 10) || 0 } : {}),
      ...(edits.team2Points !== undefined ? { team2Points: parseInt(edits.team2Points, 10) || 0 } : {}),
    };
    const changed =
      next.team1.join(', ') !== teams.team1.join(', ') ||
      next.team2.join(', ') !== teams.team2.join(', ') ||
      next.team1Name !== teams.team1Name ||
      next.team2Name !== teams.team2Name ||
      next.team1Points !== teams.team1Points ||
      next.team2Points !== teams.team2Points;
    if (changed) {
      dispatch({ type: 'SET_TEAM_STATE', payload: next });
      showMsg('success', 'Gespeichert');
    }
    // Drop the edits either way: the inputs now read from `live`, which the
    // reducer has just updated (or which already matched what was typed).
    setEdits({});
  }, [edits, state.teams, dispatch]);

  const resetPoints = async () => {
    if (await confirmDialog({
      title: 'Möchten Sie wirklich die Punkte beider Teams auf 0 zurücksetzen?',
      confirmLabel: 'Zurücksetzen',
    })) {
      dispatch({ type: 'RESET_POINTS' });
      // Discard pending keystrokes so the fields fall back to the reset values
      // instead of re-submitting the pre-reset numbers on the next blur.
      setEdits({});
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
    setEdits({});
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
              value={valueOf('team1Name')}
              onChange={e => editField('team1Name')(e.target.value)}
              onBlur={saveSession}
            />
            {isTeamNameLong(valueOf('team1Name'), jokerCount) && (
              <p className="be-field-hint" role="status">
                Name ist zu lang – wird im Header auf kleineren Bildschirmen abgekürzt{jokerNote}.
              </p>
            )}
            <label className="be-label">Team 1 Mitglieder</label>
            <input
              className="be-input"
              placeholder="Alice, Bob, ..."
              value={valueOf('team1')}
              onChange={e => editField('team1')(e.target.value)}
              onBlur={saveSession}
            />
            <label className="be-label">Team 1 Punkte</label>
            <input
              className="be-input"
              type="number"
              value={valueOf('team1Points')}
              onChange={e => editField('team1Points')(e.target.value)}
              onBlur={saveSession}
            />
          </div>
          <div>
            <label className="be-label">Team 2 Name (optional)</label>
            <input
              className="be-input"
              placeholder="Team 2"
              value={valueOf('team2Name')}
              onChange={e => editField('team2Name')(e.target.value)}
              onBlur={saveSession}
            />
            {isTeamNameLong(valueOf('team2Name'), jokerCount) && (
              <p className="be-field-hint" role="status">
                Name ist zu lang – wird im Header auf kleineren Bildschirmen abgekürzt{jokerNote}.
              </p>
            )}
            <label className="be-label">Team 2 Mitglieder</label>
            <input
              className="be-input"
              placeholder="Clara, Dave, ..."
              value={valueOf('team2')}
              onChange={e => editField('team2')(e.target.value)}
              onBlur={saveSession}
            />
            <label className="be-label">Team 2 Punkte</label>
            <input
              className="be-input"
              type="number"
              value={valueOf('team2Points')}
              onChange={e => editField('team2Points')(e.target.value)}
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
