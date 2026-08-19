import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';

export interface AwardPointsWinners {
  team1: boolean;
  team2: boolean;
}

/**
 * A verdict the game computed itself (guessing-game's `scoringMode: 'auto'`). The
 * award screen preselects the winner(s) instead of asking, and the host confirms —
 * or overrides by toggling a card. Wins are the reason for the award, never the
 * point value.
 */
export interface AutoAwardVerdict {
  /** Questions won per team. A tied question counts for BOTH teams, so these need not
   *  add up to `scoredQuestions` — which is why the award screen states a plain count,
   *  not an "x of y" fraction. Surfaced as the gamemaster's standing. */
  team1Wins: number;
  team2Wins: number;
  /** Questions that counted (the example question never does). Zero means "no verdict" —
   *  the wrapper then preselects nothing. */
  scoredQuestions: number;
  /** Who receives points — both true on an overall tie. */
  winners: AwardPointsWinners;
}

interface AwardPointsProps {
  /** The teams currently marked as winners. Both = draw, neither = nothing picked yet. */
  selected: AwardPointsWinners;
  /** What each team would receive — positional value, Aufholjoker already applied. */
  points: { team1: number; team2: number };
  onToggle: (team: 'team1' | 'team2') => void;
  onConfirm: () => void;
  /** Third card line per team, already formatted ("2 gewonnene Fragen" /
   *  "3 richtige Antworten"). `null` hides the line on both cards. */
  counts?: { team1: string; team2: string } | null;
  /** Replaces the generic hint (an untouched auto verdict, WerKenntMehr's prompt). */
  hint?: string;
  /** Extra line under the hint (WerKenntMehr's round tally). */
  note?: string;
  /** Render without the own card surface — for a game embedding the screen in its
   *  own card (WerKenntMehr's summary), where a nested `#awardPointsContainer`
   *  would stack a second surface with the wrong text colour. */
  inline?: boolean;
}

/**
 * The shared point-award screen: one card per team, each toggled on or off by the
 * host (on the show or from the gamemaster), then a single confirm press books the
 * points and advances. Nothing is selected until the host picks — or until a
 * preselection (an auto verdict, the gamemaster's tally) fills it in.
 * See specs/point-system.md.
 */
export default function AwardPoints({ selected, points, onToggle, onConfirm, counts, hint, note, inline }: AwardPointsProps) {
  const { state } = useGameContext();
  const armed = state.teams.doubleNextGame;
  // The armed team's positional points double for this award (Aufholjoker).
  const badge = (team: 'team1' | 'team2') =>
    armed === team ? <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span> : null;
  // Crowd-facing surface → follow the frontend team order (see specs/team-order-mirror.md).
  const order = teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled);
  const anySelected = selected.team1 || selected.team2;

  const defaultHint = !anySelected
    ? 'Welches Team hat gewonnen?'
    : selected.team1 && selected.team2
      ? 'Unentschieden — beide Teams erhalten Punkte'
      : `${teamName(state.teams, selected.team1 ? 1 : 2)} hat gewonnen`;

  const body = (
    <>
      <h2>Punkte vergeben</h2>
      <p className="award-points-hint">{hint ?? defaultHint}</p>
      {note && <p className="award-points-note">{note}</p>}
      <div className="award-teams">
        {order.map(team => {
          const isSelected = selected[team];
          const pts = points[team];
          return (
            <button
              type="button"
              key={team}
              className={`award-team-card${isSelected ? ' is-selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onToggle(team)}
            >
              <span className="award-team-card-name">
                {teamName(state.teams, team === 'team1' ? 1 : 2)}
                {badge(team)}
              </span>
              {/* No points before anything is picked — until then nobody knows who gets what. */}
              {anySelected && (
                <span className="award-team-card-points">
                  {isSelected && pts > 0 ? `+${pts} ${pts === 1 ? 'Punkt' : 'Punkte'}` : '0 Punkte'}
                </span>
              )}
              {counts && <span className="award-team-card-count">{counts[team]}</span>}
            </button>
          );
        })}
      </div>
      <button
        className="quiz-button award-confirm"
        disabled={!anySelected}
        onClick={onConfirm}
      >
        Punkte vergeben &amp; weiter
      </button>
    </>
  );

  if (inline) return body;
  return (
    <div id="awardPointsContainer" className="quiz-container">
      {body}
    </div>
  );
}
