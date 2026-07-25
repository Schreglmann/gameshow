import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { tallyTotals, questionTally } from '@/utils/correctAnswers';
import { NO_QUESTION_KEY } from '@/types/game';

interface CorrectAnswersTrackerProps {
  gameIndex: number;
  /**
   * Question key the `+`/`−` buttons write against — `String(scoringQuestion)`,
   * or `NO_QUESTION_KEY` when the show has no attributable question live. The
   * tally is stored per question so the breakdown panel can show which question
   * a count came from. See specs/gamemaster-question-scores.md.
   */
  question?: string;
}

export default function CorrectAnswersTracker({
  gameIndex,
  question = NO_QUESTION_KEY,
}: CorrectAnswersTrackerProps) {
  const { state, dispatch } = useGameContext();
  const byQuestion = state.correctAnswersByGame[String(gameIndex)];
  // The big number stays the GAME total (the host's habitual read); it is summed
  // from the per-question buckets rather than stored, so the two can't drift.
  const total = tallyTotals(byQuestion);
  const current = questionTally(byQuestion, question);

  const update = (team: 'team1' | 'team2', delta: number) => {
    dispatch({ type: 'UPDATE_CORRECT_ANSWER', payload: { gameIndex, question, team, delta } });
  };

  const questionLabel =
    question === NO_QUESTION_KEY
      ? 'ohne Frage'
      : question === '0'
        ? 'Beispiel'
        : `Frage ${question}`;

  const renderTeam = (team: 'team1' | 'team2', label: string, members: string[]) => (
    <div className="gm-correct-team" key={team}>
      <div className="gm-correct-label">{label}</div>
      {members.length > 0 && (
        <div className="gm-correct-members">{members.join(', ')}</div>
      )}
      <div className="gm-correct-row">
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
        <div className="gm-correct-count">{total[team]}</div>
        <button
          className="gm-btn gm-correct-btn"
          onClick={() => update(team, 1)}
          aria-label={`${label} plus`}
        >
          +
        </button>
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
    <div className="gm-correct-panel">
      {/* GM faces the crowd → mirror the frontend team order. */}
      {teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled).map(team =>
        renderTeam(team, teamName(state.teams, team === 'team1' ? 1 : 2), state.teams[team]),
      )}
    </div>
  );
}
