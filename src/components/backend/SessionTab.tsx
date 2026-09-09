import { useState, useCallback, useMemo } from 'react';
import { useGameContext } from '@/context/GameContext';
import { isTeamNameLong } from '@/utils/teamNames';
import { ALL_TEAM_KEYS, teamKeys, teamNumber, teamPoints, teamRoster, type TeamKey } from '@/utils/teams';
import type { TeamState } from '@/types/game';
import StatusMessage from './StatusMessage';
import { useConfirm } from './ConfirmContext';
import TeamDot from '@/components/common/TeamDot';

interface StorageItem {
  key: string;
  value: string;
}

/**
 * The operator-editable fields, three per team (roster, name, points), for
 * however many teams the active gameshow runs with. See specs/team-count.md.
 */
type FieldKey = TeamKey | `${TeamKey}Name` | `${TeamKey}Points`;

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
  const live = useMemo(() => {
    const values = {} as Record<FieldKey, string>;
    for (const key of ALL_TEAM_KEYS) {
      values[key] = teamRoster(state.teams, key).join(', ');
      values[`${key}Name`] = state.teams[`${key}Name`] ?? '';
      values[`${key}Points`] = String(teamPoints(state.teams, key));
    }
    return values;
  }, [state.teams]);

  // Only the teams this gameshow actually plays with get editors.
  const activeTeams = useMemo(() => teamKeys(state.settings.teamCount), [state.settings.teamCount]);

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
    const next: TeamState = { ...teams };
    let changed = false;
    for (const key of ALL_TEAM_KEYS) {
      const roster = edits[key];
      if (roster !== undefined) {
        const parsed = parseMembers(roster);
        if (parsed.join(', ') !== teamRoster(teams, key).join(', ')) changed = true;
        next[key] = parsed;
      }
      const name = edits[`${key}Name`];
      if (name !== undefined) {
        const trimmed = name.trim() || undefined;
        if (trimmed !== teams[`${key}Name`]) changed = true;
        next[`${key}Name`] = trimmed;
      }
      const points = edits[`${key}Points`];
      if (points !== undefined) {
        const parsed = parseInt(points, 10) || 0;
        if (parsed !== teamPoints(teams, key)) changed = true;
        next[`${key}Points`] = parsed;
      }
    }
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
      title: 'Möchten Sie wirklich die Punkte aller Teams auf 0 zurücksetzen?',
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
        <div className="session-team-grid" data-team-count={activeTeams.length}>
          {activeTeams.map(key => {
            const n = teamNumber(key);
            return (
              <div key={key} className="session-team-block" data-team={key}>
                <label className="be-label"><TeamDot team={key} />Team {n} Name (optional)</label>
                <input
                  className="be-input"
                  placeholder={`Team ${n}`}
                  value={valueOf(`${key}Name`)}
                  onChange={e => editField(`${key}Name`)(e.target.value)}
                  onBlur={saveSession}
                />
                {isTeamNameLong(valueOf(`${key}Name`), jokerCount, activeTeams.length) && (
                  <p className="be-field-hint" role="status">
                    Name ist zu lang – wird im Header auf kleineren Bildschirmen abgekürzt{jokerNote}.
                  </p>
                )}
                <label className="be-label">Team {n} Mitglieder</label>
                <input
                  className="be-input"
                  placeholder={n === 1 ? 'Alice, Bob, ...' : 'Clara, Dave, ...'}
                  value={valueOf(key)}
                  onChange={e => editField(key)(e.target.value)}
                  onBlur={saveSession}
                />
                <label className="be-label">Team {n} Punkte</label>
                <input
                  className="be-input"
                  type="number"
                  value={valueOf(`${key}Points`)}
                  onChange={e => editField(`${key}Points`)(e.target.value)}
                  onBlur={saveSession}
                />
              </div>
            );
          })}
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
