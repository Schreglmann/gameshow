import { describe, it, expect } from 'vitest';
import { validateQuizjagd } from '../../../validate-config';

/**
 * quizjagd holds three difficulty pools rather than a flat `questions` array,
 * so it fell through every branch of the validator: a malformed file passed
 * `npm run validate` and only failed in front of the audience.
 */

const q = (n: number) => ({ question: `F${n}`, answer: `A${n}` });
/** A pool with `n` playable questions (index 0 is the Beispielfrage). */
const pool = (n: number) => Array.from({ length: n + 1 }, (_, i) => q(i));

describe('validateQuizjagd', () => {
  it('accepts a well-formed structured game', () => {
    const errors = validateQuizjagd('quizjagd', {
      questionsPerTeam: 2,
      questions: { easy: pool(2), medium: pool(2), hard: pool(2) },
    });
    expect(errors).toEqual([]);
  });

  it('accepts the flat difficulty-tagged form', () => {
    const flat = [
      ...pool(2).map(x => ({ ...x, difficulty: 3 })),
      ...pool(2).map(x => ({ ...x, difficulty: 5 })),
      ...pool(2).map(x => ({ ...x, difficulty: 7 })),
    ];
    expect(validateQuizjagd('quizjagd', { questionsPerTeam: 2, questions: flat })).toEqual([]);
  });

  it('rejects a missing questions block', () => {
    expect(validateQuizjagd('quizjagd', {})).toContain('Game "quizjagd": missing "questions"');
  });

  it('rejects a pool that is not an array', () => {
    const errors = validateQuizjagd('quizjagd', {
      questions: { easy: pool(2), medium: 'nope', hard: pool(2) },
    });
    expect(errors.some(e => e.includes('"questions.medium" must be an array'))).toBe(true);
  });

  it('rejects an empty pool', () => {
    const errors = validateQuizjagd('quizjagd', {
      questionsPerTeam: 1,
      questions: { easy: pool(4), medium: [], hard: pool(4) },
    });
    expect(errors.some(e => e.includes('difficulty pool "medium" is empty'))).toBe(true);
  });

  it('rejects a question missing its answer', () => {
    const bad = { question: 'F', answer: '' };
    const errors = validateQuizjagd('quizjagd', {
      questionsPerTeam: 1,
      questions: { easy: [q(0), bad, q(2)], medium: pool(2), hard: pool(2) },
    });
    expect(errors.some(e => e.includes('easy question 1: missing "answer"'))).toBe(true);
  });

  it('rejects an out-of-range difficulty in the flat form', () => {
    const errors = validateQuizjagd('quizjagd', {
      questions: [{ ...q(0), difficulty: 4 }],
    });
    expect(errors.some(e => e.includes('"difficulty" must be 3, 5 or 7'))).toBe(true);
  });

  // The hard-lock this check exists to prevent: pools run dry before both teams
  // finish, and the show sits on the difficulty screen with every button greyed
  // out and no forward path.
  it('warns when the pools cannot supply questionsPerTeam × teamCount questions', () => {
    // A WARNING, not an error: one game file can be referenced by gameshows with
    // different team counts, so the shortfall is a property of the pairing, not of
    // the file. See specs/team-count.md.
    const warnings: string[] = [];
    const errors = validateQuizjagd('quizjagd', {
      questionsPerTeam: 10,
      // 5 playable per pool = 15 playable, but 20 are needed at 2 teams.
      questions: { easy: pool(5), medium: pool(5), hard: pool(5) },
    }, 2, warnings);
    expect(errors).toEqual([]);
    expect(warnings.some(w => w.includes('only 15 playable question(s)') && w.includes('needs 20'))).toBe(true);
  });

  it('scales the needed supply with the team count', () => {
    const at4: string[] = [];
    validateQuizjagd('quizjagd', {
      questionsPerTeam: 10,
      questions: { easy: pool(11), medium: pool(11), hard: pool(11) }, // 30 playable
    }, 4, at4);
    expect(at4.some(w => w.includes('with 4 teams needs 40'))).toBe(true);

    // The same file is fine for a three-team show (30 needed, 30 playable).
    const at3: string[] = [];
    validateQuizjagd('quizjagd', {
      questionsPerTeam: 10,
      questions: { easy: pool(11), medium: pool(11), hard: pool(11) },
    }, 3, at3);
    expect(at3).toEqual([]);
  });

  it('skips the supply check entirely when the show has no teams', () => {
    const warnings: string[] = [];
    validateQuizjagd('quizjagd', {
      questionsPerTeam: 10,
      questions: { easy: pool(2), medium: pool(2), hard: pool(2) },
    }, 0, warnings);
    expect(warnings).toEqual([]);
  });

  it('accounts for the per-pool Beispielfrage in the supply check', () => {
    // Exactly 20 playable (7+7+6) for questionsPerTeam=10 → nothing reported.
    const errors = validateQuizjagd('quizjagd', {
      questionsPerTeam: 10,
      questions: { easy: pool(7), medium: pool(7), hard: pool(6) },
    });
    expect(errors).toEqual([]);
  });

  it('defaults questionsPerTeam to 10 and the team count to 2 when omitted', () => {
    const warnings: string[] = [];
    validateQuizjagd('quizjagd', {
      questions: { easy: pool(2), medium: pool(2), hard: pool(2) },
    }, undefined, warnings);
    expect(warnings.some(w => w.includes('needs 20'))).toBe(true);
  });
});
