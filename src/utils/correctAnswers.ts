import type { CorrectAnswersByQuestion, QuestionTally } from '@/types/game';

/**
 * Helpers for the manual correct-answer tally, which is stored PER QUESTION
 * (`correctAnswersByQuestion[gameIndex][questionKey]`). The per-game total the
 * host reads next to the +/− buttons is derived here rather than stored, so the
 * two can never drift apart. See specs/gamemaster-question-scores.md.
 */

const EMPTY: QuestionTally = { team1: 0, team2: 0 };

/** Sum a game's per-question buckets into its overall tally. */
export function tallyTotals(byQuestion: CorrectAnswersByQuestion | undefined): QuestionTally {
  if (!byQuestion) return EMPTY;
  let team1 = 0;
  let team2 = 0;
  for (const entry of Object.values(byQuestion)) {
    team1 += entry.team1;
    team2 += entry.team2;
  }
  return { team1, team2 };
}

/** One question's bucket, or zeroes when it holds nothing yet. */
export function questionTally(
  byQuestion: CorrectAnswersByQuestion | undefined,
  questionKey: string,
): QuestionTally {
  return byQuestion?.[questionKey] ?? EMPTY;
}

/**
 * The highest NUMERIC question key holding a non-zero count, or 0 when there is
 * none. Used to extend the breakdown's row range so a row the host corrected
 * stays visible after navigating back to an earlier question.
 */
export function highestTalliedQuestion(byQuestion: CorrectAnswersByQuestion | undefined): number {
  if (!byQuestion) return 0;
  let max = 0;
  for (const [key, entry] of Object.entries(byQuestion)) {
    const n = Number(key);
    if (!Number.isInteger(n)) continue; // skips the reserved 'none' bucket
    if (entry.team1 === 0 && entry.team2 === 0) continue;
    if (n > max) max = n;
  }
  return max;
}
