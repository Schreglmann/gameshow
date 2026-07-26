import type { CorrectAnswersByQuestion, ScoreLogEntry } from '@/types/game';
import { NO_QUESTION_KEY } from '@/types/game';
import { highestTalliedQuestion } from '@/utils/correctAnswers';

/**
 * Row model for the gamemaster's per-question breakdown ("Wertung pro Frage").
 *
 * Two feeds produce the same rows: the manual `+`/`−` tally (normal games) and
 * the real point deltas of the inline-scored games. Kept pure and out of the
 * component so the tricky part — aggregating a re-judge, and deciding what
 * counts as a gap — is unit-testable. See specs/gamemaster-question-scores.md.
 */

export interface ScoreCell {
  /** Count (tally feed) or net signed points (score-log feed). */
  value: number;
  /**
   * How many source records fed this cell. `> 1` means the net figure hides
   * several deltas — a re-judge, a transfer reversal, an award clamped at 0 —
   * so the panel marks it instead of presenting the net as the whole story.
   */
  entries: number;
}

export interface BreakdownRow {
  /** Question key: `'0'` example, `'1'`… questions, `'none'`, `'total'`. */
  key: string;
  label: string;
  /** Tally rows can be corrected in place; point rows are undone elsewhere. */
  editable: boolean;
  team1: ScoreCell;
  team2: ScoreCell;
  /** False → nothing was recorded for either team ("keine Wertung"). */
  hasData: boolean;
}

/** Row key for whole-game (positional) awards, which carry no question. */
export const TOTAL_ROW_KEY = 'total';

const EMPTY_CELL: ScoreCell = { value: 0, entries: 0 };

export function questionLabel(key: string): string {
  if (key === NO_QUESTION_KEY) return 'ohne Frage';
  if (key === TOTAL_ROW_KEY) return 'Gesamt';
  if (key === '0') return 'Beispiel';
  return `Frage ${key}`;
}

function makeRow(key: string, team1: ScoreCell, team2: ScoreCell, editable: boolean): BreakdownRow {
  return {
    key,
    label: questionLabel(key),
    editable,
    team1,
    team2,
    hasData: team1.entries > 0 || team2.entries > 0,
  };
}

/**
 * The numeric questions a row list must cover: 1 … max(live question, highest
 * question holding data). Taking the max is what keeps a row the host just
 * corrected visible after navigating BACK to an earlier question — the row list
 * must never shrink out from under a correction.
 */
function questionRange(currentQuestion: number | null, highestWithData: number): number[] {
  const last = Math.max(currentQuestion ?? 0, highestWithData);
  const out: number[] = [];
  for (let n = 1; n <= last; n += 1) out.push(n);
  return out;
}

/** Rows from the manual correct-answer tally (normal games). */
export function buildTallyRows(
  byQuestion: CorrectAnswersByQuestion | undefined,
  currentQuestion: number | null,
): BreakdownRow[] {
  const cell = (key: string, team: 'team1' | 'team2'): ScoreCell => {
    const value = byQuestion?.[key]?.[team] ?? 0;
    return { value, entries: value > 0 ? 1 : 0 };
  };
  const rowFor = (key: string) => makeRow(key, cell(key, 'team1'), cell(key, 'team2'), true);

  const rows: BreakdownRow[] = [];
  const example = rowFor('0');
  if (example.hasData) rows.push(example);
  for (const n of questionRange(currentQuestion, highestTalliedQuestion(byQuestion))) {
    rows.push(rowFor(String(n)));
  }
  const unattributed = rowFor(NO_QUESTION_KEY);
  if (unattributed.hasData) rows.push(unattributed);
  return rows;
}

/** Rows from the point audit log (inline-scored games), for one game. */
export function buildPointRows(
  history: ScoreLogEntry[] | undefined,
  gameIndex: number,
  currentQuestion: number | null,
): BreakdownRow[] {
  const byKey = new Map<string, { team1: ScoreCell; team2: ScoreCell }>();
  let highestWithData = 0;

  for (const entry of history ?? []) {
    if (entry.gameIndex !== gameIndex) continue;
    // A whole-game positional award carries no question — it belongs in "Gesamt",
    // never pinned on whichever question happened to be last.
    const key = entry.questionNumber === undefined ? TOTAL_ROW_KEY : String(entry.questionNumber);
    if (entry.questionNumber !== undefined && entry.questionNumber > highestWithData) {
      highestWithData = entry.questionNumber;
    }
    const cells = byKey.get(key) ?? { team1: { ...EMPTY_CELL }, team2: { ...EMPTY_CELL } };
    const cell = cells[entry.team];
    cell.value += entry.delta;
    cell.entries += 1;
    byKey.set(key, cells);
  }

  const rowFor = (key: string) => {
    const cells = byKey.get(key);
    return makeRow(key, cells?.team1 ?? EMPTY_CELL, cells?.team2 ?? EMPTY_CELL, false);
  };

  const rows: BreakdownRow[] = [];
  const example = rowFor('0');
  if (example.hasData) rows.push(example);
  for (const n of questionRange(currentQuestion, highestWithData)) rows.push(rowFor(String(n)));
  const total = rowFor(TOTAL_ROW_KEY);
  if (total.hasData) rows.push(total);
  return rows;
}
