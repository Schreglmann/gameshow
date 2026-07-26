import { describe, it, expect } from 'vitest';
import type { ScoreLogEntry } from '@/types/game';
import { buildTallyRows, buildPointRows, TOTAL_ROW_KEY } from '@/utils/questionScores';
import { tallyTotals, highestTalliedQuestion } from '@/utils/correctAnswers';

/**
 * The breakdown's row model. These cases are the reason the derivation is a pure
 * function: the interesting behaviour is what counts as a gap and how a re-judge
 * is presented. See specs/gamemaster-question-scores.md.
 */

let idCounter = 0;
function entry(part: Partial<ScoreLogEntry> & { team: 'team1' | 'team2'; delta: number }): ScoreLogEntry {
  idCounter += 1;
  return {
    id: `id-${idCounter}`,
    pointsAfter: 0,
    ts: idCounter,
    gameIndex: 0,
    ...part,
  };
}

describe('tallyTotals / highestTalliedQuestion', () => {
  it('sums the per-question buckets into the game total', () => {
    expect(tallyTotals({
      '1': { team1: 1, team2: 0 },
      '2': { team1: 0, team2: 1 },
      '5': { team1: 2, team2: 3 },
    })).toEqual({ team1: 3, team2: 4 });
  });

  it('treats a missing map as zeroes', () => {
    expect(tallyTotals(undefined)).toEqual({ team1: 0, team2: 0 });
  });

  it('finds the highest question holding a count, ignoring the reserved bucket', () => {
    expect(highestTalliedQuestion({
      '2': { team1: 1, team2: 0 },
      '7': { team1: 0, team2: 0 }, // empty → not "holding data"
      none: { team1: 9, team2: 9 }, // non-numeric key → skipped
    })).toBe(2);
  });
});

describe('buildTallyRows', () => {
  it('lists every question up to the current one, marking the untouched ones', () => {
    const rows = buildTallyRows({ '1': { team1: 1, team2: 0 }, '3': { team1: 0, team2: 1 } }, 3);

    expect(rows.map(r => r.key)).toEqual(['1', '2', '3']);
    expect(rows.map(r => r.hasData)).toEqual([true, false, true]);
    expect(rows[1].label).toBe('Frage 2');
  });

  it('keeps later tallied rows visible after navigating back', () => {
    // Host corrected question 5, then stepped back to question 2. Row 5 must not
    // vanish — hiding a just-corrected row is this feature's worst failure mode.
    const rows = buildTallyRows({ '5': { team1: 1, team2: 0 } }, 2);
    expect(rows.map(r => r.key)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('shows the example and reserved buckets only when they hold data', () => {
    expect(buildTallyRows({ '1': { team1: 1, team2: 0 } }, 1).map(r => r.key)).toEqual(['1']);

    const rows = buildTallyRows(
      { '0': { team1: 1, team2: 0 }, '1': { team1: 1, team2: 0 }, none: { team1: 0, team2: 2 } },
      1,
    );
    expect(rows.map(r => r.key)).toEqual(['0', '1', 'none']);
    expect(rows[0].label).toBe('Beispiel');
    expect(rows[2].label).toBe('ohne Frage');
  });

  it('marks tally rows editable', () => {
    expect(buildTallyRows({ '1': { team1: 1, team2: 0 } }, 1).every(r => r.editable)).toBe(true);
  });

  it('returns no rows before the first question', () => {
    expect(buildTallyRows(undefined, null)).toEqual([]);
  });
});

describe('buildPointRows', () => {
  it('groups deltas by question and nets them per team', () => {
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: 5, questionNumber: 1 }),
        entry({ team: 'team2', delta: -5, questionNumber: 1 }),
        entry({ team: 'team2', delta: 3, questionNumber: 2 }),
      ],
      0,
      2,
    );

    expect(rows.map(r => r.key)).toEqual(['1', '2']);
    expect(rows[0].team1).toEqual({ value: 5, entries: 1 });
    expect(rows[0].team2).toEqual({ value: -5, entries: 1 });
    expect(rows[1].team1).toEqual({ value: 0, entries: 0 });
    expect(rows[1].team2).toEqual({ value: 3, entries: 1 });
  });

  it('ignores entries from other games', () => {
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: 5, questionNumber: 1, gameIndex: 0 }),
        entry({ team: 'team1', delta: 9, questionNumber: 1, gameIndex: 1 }),
      ],
      0,
      1,
    );
    expect(rows[0].team1).toEqual({ value: 5, entries: 1 });
  });

  it('leaves the non-answering team as an untouched cell, not a gap', () => {
    // Every inline-scored game awards ONE team per question, so the other team's
    // empty cell is normal — only a row where neither team scored is a gap.
    const rows = buildPointRows([entry({ team: 'team1', delta: 3, questionNumber: 1 })], 0, 1);
    expect(rows[0].hasData).toBe(true);
    expect(rows[0].team2.entries).toBe(0);
  });

  it('flags a question whose net figure hides several deltas (BetQuiz re-judge)', () => {
    // Transfer mode, question 3: judged right (+10 / −10), then re-judged wrong.
    // BetQuiz's reversal branch is unreachable today, so this double-awards and
    // nets to 0 — the entry count is what stops that reading as "nothing happened".
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: 10, questionNumber: 3 }),
        entry({ team: 'team2', delta: -10, questionNumber: 3 }),
        entry({ team: 'team1', delta: -10, questionNumber: 3 }),
        entry({ team: 'team2', delta: 10, questionNumber: 3 }),
      ],
      0,
      3,
    );

    const row = rows.find(r => r.key === '3')!;
    expect(row.team1).toEqual({ value: 0, entries: 2 });
    expect(row.team2).toEqual({ value: 0, entries: 2 });
    expect(row.hasData).toBe(true);
  });

  it('flags a reversal that over-credits under the ≥0 clamp (FinalQuiz)', () => {
    // Team on 3 points bets 5, judged wrong → clamped delta −3. Corrected to
    // right → reversal +5 then award +5. Net +7 where the truth is +5.
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: -3, questionNumber: 1 }),
        entry({ team: 'team1', delta: 5, questionNumber: 1 }),
        entry({ team: 'team1', delta: 5, questionNumber: 1 }),
      ],
      0,
      1,
    );
    expect(rows[0].team1).toEqual({ value: 7, entries: 3 });
  });

  it('puts question-less (positional) awards in a Gesamt row', () => {
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: 4, questionNumber: 1 }),
        entry({ team: 'team2', delta: 6 }), // no questionNumber → whole-game award
      ],
      0,
      1,
    );

    expect(rows.map(r => r.key)).toEqual(['1', TOTAL_ROW_KEY]);
    const total = rows[1];
    expect(total.label).toBe('Gesamt');
    expect(total.team2).toEqual({ value: 6, entries: 1 });
    // Must NOT be pinned on the last question.
    expect(rows[0].team2.entries).toBe(0);
  });

  it('marks point rows read-only', () => {
    const rows = buildPointRows([entry({ team: 'team1', delta: 1, questionNumber: 1 })], 0, 1);
    expect(rows.every(r => !r.editable)).toBe(true);
  });

  it('covers quizjagd-style alternating turns without false gaps', () => {
    const rows = buildPointRows(
      [
        entry({ team: 'team1', delta: 3, questionNumber: 1 }),
        entry({ team: 'team2', delta: -5, questionNumber: 2 }),
        entry({ team: 'team1', delta: 7, questionNumber: 3 }),
      ],
      0,
      3,
    );
    expect(rows.map(r => r.hasData)).toEqual([true, true, true]);
  });

  it('handles an empty log', () => {
    expect(buildPointRows(undefined, 0, null)).toEqual([]);
    expect(buildPointRows([], 0, 2).map(r => r.hasData)).toEqual([false, false]);
  });
});
