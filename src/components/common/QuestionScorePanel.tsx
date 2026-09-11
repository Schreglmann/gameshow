import { useState } from 'react';
import { useGameContext } from '@/context/GameContext';
import { teamName, hasNamedTeams } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { buildTallyRows, buildPointRows, type BreakdownRow, type ScoreCell } from '@/utils/questionScores';
import type { TeamKey } from '@/utils/teams';
import TeamDot from './TeamDot';

/**
 * Gamemaster per-question breakdown ("Wertung pro Frage"). Answers the question
 * the per-game total can't: which team scored on WHICH question — so a forgotten
 * award shows up as an explicit gap while it is still fixable.
 *
 * Two feeds, one row model: normal games read the manual `+`/`−` tally (counts,
 * correctable in place), inline-scored games aggregate the point audit log (net
 * signed points, read-only — corrections go through the undo in "Letzte
 * Wertungen"). See specs/gamemaster-question-scores.md.
 */
interface QuestionScorePanelProps {
  gameIndex: number;
  /** Question live on the show, or null when none is attributable. */
  currentQuestion: number | null;
  /** True for the inline-scored games — read the point log instead of the tally. */
  inlineScored?: boolean;
  /** Suppress edits while the mirrored GM state may be stale. */
  readOnly?: boolean;
}

export default function QuestionScorePanel({
  gameIndex,
  currentQuestion,
  inlineScored = false,
  readOnly = false,
}: QuestionScorePanelProps) {
  const { state, dispatch } = useGameContext();
  const [collapsed, setCollapsed] = useState(true);

  const rows = inlineScored
    ? buildPointRows(state.teams.scoreHistory, gameIndex, currentQuestion)
    : buildTallyRows(state.correctAnswersByGame[String(gameIndex)], currentQuestion);

  if (rows.length === 0) return null;

  const scoredCount = rows.filter(r => r.hasData).length;
  // GM faces the crowd → mirror the frontend team order, like every other GM panel.
  const order = teamDisplayOrder(
    state.teams.orderSwapped,
    true,
    state.settings.teamMirrorEnabled,
    state.settings.teamCount,
  );

  const update = (question: string, team: TeamKey, delta: number) => {
    dispatch({ type: 'UPDATE_CORRECT_ANSWER', payload: { gameIndex, question, team, delta } });
  };

  return (
    <div className={`gm-qscore${collapsed ? ' collapsed' : ''}`} data-team-count={order.length}>
      <button
        type="button"
        className="gm-qscore-header"
        aria-expanded={!collapsed}
        aria-controls="gm-qscore-body"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="gm-qscore-title">Wertung pro Frage</span>
        <span className="gm-qscore-count" aria-hidden="true">
          {scoredCount}/{rows.length}
        </span>
        <span className="gm-qscore-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {!collapsed && (
        <div id="gm-qscore-body" className="gm-qscore-body">
          <div className="gm-qscore-row gm-qscore-row--head" aria-hidden="true">
            <span className="gm-qscore-label" />
            {order.map(team => (
              <span key={team} className="gm-qscore-team" data-team={team}>
                <TeamDot team={team} />
                {hasNamedTeams(order.length) ? teamName(state.teams, team) : 'Punkte'}
              </span>
            ))}
          </div>
          <ul className="gm-qscore-list">
            {rows.map(row => (
              <li
                key={row.key}
                className={`gm-qscore-row${row.hasData ? '' : ' gm-qscore-row--empty'}`}
              >
                <span className="gm-qscore-label">
                  <span className="gm-qscore-label-text">{row.label}</span>
                  {/* The gap is the whole point of the panel, so it is spelled out
                      rather than left to the dashed border — and it sits under the
                      label so an editable row keeps its correction buttons. */}
                  {!row.hasData && <span className="gm-qscore-label-note">keine Wertung</span>}
                </span>
                {order.map(team => (
                  <span key={team} className="gm-qscore-cell">
                    {row.editable && !readOnly && (
                      <button
                        type="button"
                        className="gm-btn gm-qscore-btn"
                        aria-label={`${row.label} ${teamName(state.teams, team)} minus`}
                        disabled={row.cells[team].value === 0}
                        onClick={() => update(row.key, team, -1)}
                      >
                        −
                      </button>
                    )}
                    <Cell cell={row.cells[team]} signed={inlineScored} />
                    {row.editable && !readOnly && (
                      <button
                        type="button"
                        className="gm-btn gm-qscore-btn"
                        aria-label={`${row.label} ${teamName(state.teams, team)} plus`}
                        onClick={() => update(row.key, team, 1)}
                      >
                        +
                      </button>
                    )}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One team's figure. An untouched cell shows a neutral dash — in every
 * inline-scored game exactly one team is awarded per question, so flagging the
 * other as missing would fire on every row.
 *
 * `entries > 1` means several deltas were netted into this figure (a re-judge, a
 * transfer reversal, an award clamped at 0). That gets marked: presenting the net
 * alone can read as "nothing happened", which is precisely what the host opened
 * this panel to catch.
 */
function Cell({ cell, signed }: { cell: ScoreCell; signed: boolean }) {
  if (cell.entries === 0) {
    return <span className="gm-qscore-value gm-qscore-value--empty">—</span>;
  }
  const tone = cell.value > 0 ? ' positive' : cell.value < 0 ? ' negative' : '';
  // Signed figures use the typographic minus, matching "Letzte Wertungen".
  const text = signed
    ? `${cell.value > 0 ? '+' : cell.value < 0 ? '−' : ''}${Math.abs(cell.value)}`
    : String(cell.value);
  return (
    <span className={`gm-qscore-value${tone}`}>
      {text}
      {cell.entries > 1 && (
        <span className="gm-qscore-repeat" title={`${cell.entries} Wertungen zusammengefasst`}>
          {cell.entries}×
        </span>
      )}
    </span>
  );
}

export type { BreakdownRow };
