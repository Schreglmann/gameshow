import { useGameContext } from '@/context/GameContext';
import { teamName, hasNamedTeams } from '@/utils/teamNames';
import { teamRoster, type TeamKey } from '@/utils/teams';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { tallyTotals, questionTally } from '@/utils/correctAnswers';
import { NO_QUESTION_KEY } from '@/types/game';
import TeamDot from './TeamDot';

interface CorrectAnswersTrackerProps {
  gameIndex: number;
  /**
   * Question key the `+`/`−` buttons write against — `String(scoringQuestion)`,
   * or `NO_QUESTION_KEY` when the show has no attributable question live. The
   * tally is stored per question so the breakdown panel can show which question
   * a count came from. See specs/gamemaster-question-scores.md.
   */
  question?: string;
  /**
   * True when the playing game fills the tally itself (guessing-game's automatic
   * scoring). The counts still show — they are the running standing — but the `+`/`−`
   * buttons are left out entirely: a dead button invites the host to wonder whether
   * they or the show award a question.
   */
  readOnly?: boolean;
}

export default function CorrectAnswersTracker({
  gameIndex,
  question = NO_QUESTION_KEY,
  readOnly = false,
}: CorrectAnswersTrackerProps) {
  const { state, dispatch } = useGameContext();
  const byQuestion = state.correctAnswersByGame[String(gameIndex)];
  // The big number stays the GAME total (the host's habitual read); it is summed
  // from the per-question buckets rather than stored, so the two can't drift.
  const total = tallyTotals(byQuestion);
  const current = questionTally(byQuestion, question);

  const update = (team: TeamKey, delta: number) => {
    dispatch({ type: 'UPDATE_CORRECT_ANSWER', payload: { gameIndex, question, team, delta } });
  };

  const questionLabel =
    question === NO_QUESTION_KEY
      ? 'ohne Frage'
      : question === '0'
        ? 'Beispiel'
        : `Frage ${question}`;

  const renderTeam = (team: TeamKey, label: string, members: string[]) => (
    <div className="gm-correct-team" data-team={team} key={team}>
      <div className="gm-correct-label"><TeamDot team={team} />{label}</div>
      {members.length > 0 && (
        <div className="gm-correct-members">{members.join(', ')}</div>
      )}
      <div className="gm-correct-row">
        {!readOnly && (
          <button
            className="gm-btn gm-correct-btn"
            onClick={() => update(team, -1)}
            aria-label={`${label} minus`}
            // Gated on THIS question's bucket, not the total: `−` writes to the
            // current question, and the reducer no-ops at 0 — so gating on the
            // total would make a tap on a visible non-zero number do nothing.
            disabled={current[team] === 0}
          >
            −
          </button>
        )}
        <div className="gm-correct-count">{total[team]}</div>
        {!readOnly && (
          <button
            className="gm-btn gm-correct-btn"
            onClick={() => update(team, 1)}
            aria-label={`${label} plus`}
          >
            +
          </button>
        )}
      </div>
      {/* Names the question the buttons write to and what it already holds — this
          is what makes both the attribution and a disabled `−` legible without
          expanding the breakdown panel. */}
      <div className="gm-correct-question">
        {questionLabel} · {current[team]}
      </div>
    </div>
  );

  return (
    <div className="gm-correct-panel" data-team-count={state.settings.teamCount}>
      {/* GM faces the crowd → mirror the frontend team order. */}
      {teamDisplayOrder(
        state.teams.orderSwapped,
        true,
        state.settings.teamMirrorEnabled,
        state.settings.teamCount,
      ).map(team =>
        // At 0-1 teams there is no team to name — the audience is the only
        // counter on screen. See specs/team-count.md.
        renderTeam(
          team,
          hasNamedTeams(state.settings.teamCount) ? teamName(state.teams, team) : 'Richtig',
          teamRoster(state.teams, team),
        ),
      )}
    </div>
  );
}
