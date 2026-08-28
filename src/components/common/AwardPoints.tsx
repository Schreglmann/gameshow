import { useGameContext } from '@/context/GameContext';
import { teamName, joinTeamNames, hasNamedTeams, type TeamNames } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { type TeamKey } from '@/utils/teams';

/**
 * Which teams are marked as winners. A partial record over the ACTIVE teams:
 * a missing/false key is "not selected", every selected team receives points,
 * and two or more selected is the draw. See specs/team-count.md.
 */
export type AwardPointsWinners = Partial<Record<TeamKey, boolean>>;

/** The teams currently selected, in the given display order. */
export function selectedTeams(
  selected: AwardPointsWinners,
  teams: readonly TeamKey[],
): TeamKey[] {
  return teams.filter(t => selected[t] === true);
}

/**
 * The German sentence describing a multi-team award.
 *
 * At two teams — where a draw can only mean "both" — this is the wording the
 * award screen has always used, so nothing about a two-team show changes. With
 * more teams a draw can be partial, so the winners are named unless every active
 * team is in it. See specs/team-count.md.
 */
export function drawHint(
  names: TeamNames,
  picked: readonly TeamKey[],
  active: readonly TeamKey[],
): string {
  if (picked.length === active.length) {
    return active.length === 2
      ? 'Unentschieden — beide Teams erhalten Punkte'
      : 'Unentschieden — alle Teams erhalten Punkte';
  }
  return `Unentschieden — ${joinTeamNames(names, picked)} erhalten Punkte`;
}

/**
 * A verdict the game computed itself (guessing-game's `scoringMode: 'auto'`). The
 * award screen preselects the winner(s) instead of asking, and the host confirms —
 * or overrides by toggling a card. Wins are the reason for the award, never the
 * point value.
 */
export interface AutoAwardVerdict {
  /** Questions won per team. A tied question counts for EVERY tied team, so these need not
   *  add up to `scoredQuestions` — which is why the award screen states a plain count,
   *  not an "x of y" fraction. Surfaced as the gamemaster's standing. */
  wins: Partial<Record<TeamKey, number>>;
  /** Questions that counted (the example question never does). Zero means "no verdict" —
   *  the wrapper then preselects nothing. */
  scoredQuestions: number;
  /** Who receives points — more than one on an overall tie. */
  winners: AwardPointsWinners;
}

interface AwardPointsProps {
  /** The teams currently marked as winners. Two or more = draw, none = nothing picked yet. */
  selected: AwardPointsWinners;
  /** What each team would receive — positional value, Aufholjoker already applied. */
  points: Partial<Record<TeamKey, number>>;
  onToggle: (team: TeamKey) => void;
  onConfirm: () => void;
  /** Third card line per team, already formatted ("2 gewonnene Fragen" /
   *  "3 richtige Antworten"). `null` hides the line on every card. */
  counts?: Partial<Record<TeamKey, string>> | null;
  /** Replaces the generic hint (an untouched auto verdict, WerKenntMehr's prompt). */
  hint?: string;
  /** Extra line under the hint (WerKenntMehr's round tally). */
  note?: string;
  /** Render without the own card surface — for a game embedding the screen in its
   *  own card (WerKenntMehr's summary), where a nested `#awardPointsContainer`
   *  would stack a second surface with the wrong text colour. */
  inline?: boolean;
  /** The `per-correct-answer` point mode: the tally already decided the outcome, so the
   *  cards state it instead of asking. They become inert (no toggle, no `aria-pressed`),
   *  every card shows its points right away, and confirm is never disabled — an empty
   *  tally is a valid result the host must be able to advance past.
   *  See specs/point-system.md. */
  readOnly?: boolean;
}

/**
 * The shared point-award screen: one card per ACTIVE team, each toggled on or off
 * by the host (on the show or from the gamemaster), then a single confirm press
 * books the points and advances. Nothing is selected until the host picks — or
 * until a preselection (an auto verdict, the gamemaster's tally) fills it in.
 * See specs/point-system.md and specs/team-count.md.
 */
export default function AwardPoints({ selected, points, onToggle, onConfirm, counts, hint, note, inline, readOnly }: AwardPointsProps) {
  const { state } = useGameContext();
  const armed = state.teams.doubleNextGame;
  // The armed team's positional points double for this award (Aufholjoker).
  const badge = (team: TeamKey) =>
    armed === team ? <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span> : null;
  // Crowd-facing surface → follow the frontend team order (see specs/team-order-mirror.md).
  const order = teamDisplayOrder(
    state.teams.orderSwapped,
    false,
    state.settings.teamMirrorEnabled,
    state.settings.teamCount,
  );
  const picked = selectedTeams(selected, order);

  // Below two teams there is no team to name — the audience plays the show
  // itself. The show never reaches this screen at 1 team (BaseGameWrapper skips
  // it: there is no winner to choose), but the admin/theme showcase can still
  // render it, and a nameless card must read sensibly there too.
  // See specs/team-count.md.
  const named = hasNamedTeams(state.settings.teamCount);
  const defaultHint = readOnly
    // Nothing was chosen here — the gamemaster's tally decided it. State the rule
    // rather than a winner: in this mode every team is paid its own count.
    ? 'Jede richtige Antwort zählt 1 Punkt'
    : picked.length === 0
    // With a single team there is nothing to choose BETWEEN — the question is
    // whether the round was won at all.
    ? (order.length === 1
      ? (named ? `Hat ${teamName(state.teams, order[0]!)} die Runde gewonnen?` : 'Wurde die Runde gewonnen?')
      : 'Welches Team hat gewonnen?')
    : picked.length === 1
      ? (named ? `${teamName(state.teams, picked[0]!)} hat gewonnen` : 'Runde gewonnen')
      : drawHint(state.teams, picked, order);

  const body = (
    <>
      <h2>Punkte vergeben</h2>
      <p className="award-points-hint">{hint ?? defaultHint}</p>
      {note && <p className="award-points-note">{note}</p>}
      <div className="award-teams" data-team-count={order.length}>
        {order.map(team => {
          const isSelected = selected[team] === true;
          const pts = points[team] ?? 0;
          const content = (
            <>
              {/* Below two teams there is no name to put here — the card IS the
                  round's points. Its value carries the whole meaning, so it is
                  shown from the start rather than only once something is picked
                  (the solo card arrives preselected anyway). */}
              {(named || badge(team)) && (
                <span className="award-team-card-name">
                  {named ? teamName(state.teams, team) : null}
                  {badge(team)}
                </span>
              )}
              {/* No points before anything is picked — until then nobody knows who
                  gets what. Read-only is the exception: nothing is being picked, so
                  the numbers ARE the screen. */}
              {(picked.length > 0 || !named || readOnly) && (
                <span className="award-team-card-points">
                  {pts > 0 && (isSelected || readOnly) ? `+${pts} ${pts === 1 ? 'Punkt' : 'Punkte'}` : '0 Punkte'}
                </span>
              )}
              {counts && <span className="award-team-card-count">{counts[team] ?? ''}</span>}
            </>
          );
          const className = `award-team-card${isSelected ? ' is-selected' : ''}${readOnly ? ' is-readonly' : ''}`;
          // A read-only card is a statement, not a control: no button element, so it
          // is neither focusable nor announced as pressable.
          return readOnly
            ? <div key={team} className={className}>{content}</div>
            : (
              <button
                type="button"
                key={team}
                className={className}
                aria-pressed={isSelected}
                onClick={() => onToggle(team)}
              >
                {content}
              </button>
            );
        })}
      </div>
      <button
        className="quiz-button award-confirm"
        // Never blocked in read-only: an empty tally means nobody scored, which the
        // host still has to be able to confirm and move past.
        disabled={!readOnly && picked.length === 0}
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
