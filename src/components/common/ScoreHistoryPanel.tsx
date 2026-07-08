import { useState } from 'react';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';

/**
 * Gamemaster scoring-undo panel. Shows the most recent point mutations (newest
 * first) with a one-tap undo per entry, so a mis-award is corrected without
 * recomputing totals by hand. Reads the audit log that rides the cached
 * gamemaster-team-state channel; dispatching UNDO_SCORE_ENTRY mutates local
 * team state, which re-broadcasts so the show converges. See
 * specs/gamemaster-cockpit.md.
 */
const VISIBLE_ENTRIES = 5;

export default function ScoreHistoryPanel() {
  const { state, dispatch } = useGameContext();
  const [collapsed, setCollapsed] = useState(true);

  const history = state.teams.scoreHistory ?? [];
  if (history.length === 0) return null;

  // Newest first; only the last few are actionable on screen.
  const recent = [...history].slice(-VISIBLE_ENTRIES).reverse();

  return (
    <div className={`gm-score-history${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="gm-score-history-header"
        aria-expanded={!collapsed}
        aria-controls="gm-score-history-body"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="gm-score-history-title">Letzte Wertungen</span>
        <span className="gm-score-history-count" aria-hidden="true">{history.length}</span>
        <span className="gm-score-history-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {!collapsed && (
        <ul id="gm-score-history-body" className="gm-score-history-list">
          {recent.map(entry => {
            const name = teamName(state.teams, entry.team === 'team1' ? 1 : 2);
            const positive = entry.delta > 0;
            return (
              <li key={entry.id} className="gm-score-history-item">
                <span className={`gm-score-delta${positive ? ' positive' : ' negative'}`}>
                  {positive ? '+' : '−'}{Math.abs(entry.delta)}
                </span>
                <span className="gm-score-history-meta">
                  <span className="gm-score-history-team">{name}</span>
                  {typeof entry.gameIndex === 'number' && (
                    <span className="gm-score-history-game">Spiel {entry.gameIndex + 1}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="gm-btn gm-btn--danger gm-score-undo"
                  onClick={() => dispatch({ type: 'UNDO_SCORE_ENTRY', payload: { id: entry.id } })}
                  title="Diese Wertung rückgängig machen"
                >
                  Rückgängig
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
