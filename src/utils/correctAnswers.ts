import type { CorrectAnswersByQuestion, QuestionTally } from '@/types/game';
import { ALL_TEAM_KEYS, type TeamKey } from '@/utils/teams';

/**
 * Helpers for the manual correct-answer tally, which is stored PER QUESTION
 * (`correctAnswersByQuestion[gameIndex][questionKey]`). The per-game total the
 * host reads next to the +/− buttons is derived here rather than stored, so the
 * two can never drift apart. See specs/gamemaster-question-scores.md.
 *
 * A tally is a `Partial<Record<TeamKey, number>>` (only the teams that scored
 * get a key), so nothing outside this module may index it directly — the
 * accessors below fill a missing team with 0. See specs/team-count.md.
 */

/** Every team's count, missing entries filled with 0. */
export function fullTally(tally: QuestionTally | undefined): Record<TeamKey, number> {
  const out = {} as Record<TeamKey, number>;
  for (const key of ALL_TEAM_KEYS) out[key] = tally?.[key] ?? 0;
  return out;
}

/** One team's count in a tally (0 when absent). */
export function tallyCount(tally: QuestionTally | undefined, team: TeamKey): number {
  return tally?.[team] ?? 0;
}

/** Sum a game's per-question buckets into its overall tally. */
export function tallyTotals(byQuestion: CorrectAnswersByQuestion | undefined): Record<TeamKey, number> {
  const totals = fullTally(undefined);
  if (!byQuestion) return totals;
  for (const entry of Object.values(byQuestion)) {
    for (const key of ALL_TEAM_KEYS) totals[key] += entry[key] ?? 0;
  }
  return totals;
}

/** One question's bucket, or zeroes when it holds nothing yet. */
export function questionTally(
  byQuestion: CorrectAnswersByQuestion | undefined,
  questionKey: string,
): Record<TeamKey, number> {
  return fullTally(byQuestion?.[questionKey]);
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
    if (ALL_TEAM_KEYS.every(k => (entry[k] ?? 0) === 0)) continue;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Which team(s) lead a game's tally — the award screen's preselection. `null`
 * when nothing was tallied at all (nobody kept score), so the host gets an empty
 * selection instead of a made-up winner. Several teams on an equal top count are
 * ALL returned, which the award screen reads as a draw between them.
 * See specs/point-system.md.
 */
export function tallyLeader(
  byQuestion: CorrectAnswersByQuestion | undefined,
  teams: readonly TeamKey[],
): TeamKey[] | null {
  if (teams.length === 0) return null;
  const totals = tallyTotals(byQuestion);
  const max = Math.max(...teams.map(t => totals[t]));
  if (max === 0) return null;
  return teams.filter(t => totals[t] === max);
}
