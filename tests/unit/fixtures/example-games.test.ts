import { describe, it, expect } from 'vitest';
import { EXAMPLE_GAMES } from '../../../server/example-games';
import type { GameType } from '../../../src/types/config';

/**
 * Validates the example-game fixtures (specs/example-games.md) without running
 * media generation: every entry must satisfy the same per-type rules as
 * validate-config.ts, and every media reference must have a matching generator.
 */

const VALID_TYPES: GameType[] = [
  'simple-quiz', 'bet-quiz', 'guessing-game', 'final-quiz', 'audio-guess', 'video-guess',
  'q1', 'four-statements', 'fact-or-fake', 'quizjagd', 'bandle', 'image-guess', 'colorguess', 'ranking',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateQuestion(type: string, q: any): void {
  const hasPrompt = Boolean(q.question || q.questionImage || q.questionAudio);
  switch (type) {
    case 'simple-quiz':
    case 'final-quiz':
      expect(hasPrompt).toBe(true);
      expect(q.answer).toBeTruthy();
      break;
    case 'bet-quiz':
      expect(hasPrompt).toBe(true);
      expect(q.answer).toBeTruthy();
      expect(typeof q.category === 'string' && q.category.trim().length > 0).toBe(true);
      break;
    case 'guessing-game':
      expect(hasPrompt).toBe(true);
      expect(typeof q.answer).toBe('number');
      break;
    case 'q1':
      expect(q.Frage).toBeTruthy();
      expect(Array.isArray(q.trueStatements) && q.trueStatements.length > 0).toBe(true);
      expect(q.wrongStatement).toBeTruthy();
      break;
    case 'four-statements':
      expect(typeof q.topic === 'string' && q.topic.trim().length > 0).toBe(true);
      expect(Array.isArray(q.statements) && q.statements.length <= 4).toBe(true);
      expect(Boolean(q.answer || q.answerImage)).toBe(true);
      break;
    case 'fact-or-fake':
      expect(q.statement).toBeTruthy();
      expect(['FAKT', 'FAKE'].includes(q.answer) || typeof q.isFact === 'boolean').toBe(true);
      break;
    case 'audio-guess':
      expect(q.answer).toBeTruthy();
      expect(q.audio).toBeTruthy();
      break;
    case 'bandle':
      expect(q.answer).toBeTruthy();
      expect(Array.isArray(q.tracks) && q.tracks.length > 0).toBe(true);
      for (const t of q.tracks) { expect(t.label).toBeTruthy(); expect(t.audio).toBeTruthy(); }
      break;
    case 'image-guess':
      expect(q.answer).toBeTruthy();
      expect(q.image).toBeTruthy();
      break;
    case 'colorguess':
      expect(q.answer).toBeTruthy();
      expect(/\.(png|jpe?g|webp|svg)$/i.test(q.image)).toBe(true);
      break;
    case 'ranking':
      expect(typeof q.question === 'string' && q.question.trim().length > 0).toBe(true);
      expect(Array.isArray(q.answers) && q.answers.length > 0).toBe(true);
      break;
  }
}

describe('example-games fixtures', () => {
  it('covers every game type except video-guess, exactly once', () => {
    const types = EXAMPLE_GAMES.map(g => g.gameFile.type).sort();
    const expected = VALID_TYPES.filter(t => t !== 'video-guess').sort();
    expect(types).toEqual(expected);
  });

  it('all fileNames are beispiel-prefixed and unique', () => {
    const names = EXAMPLE_GAMES.map(g => g.fileName);
    for (const n of names) expect(n).toMatch(/^beispiel-/);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(EXAMPLE_GAMES.map(g => [g.fileName, g] as const))('%s', (_name, game) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gf = game.gameFile as any;

    it('has a valid type, non-empty title and a rules array', () => {
      expect(VALID_TYPES).toContain(gf.type);
      expect(typeof gf.title === 'string' && gf.title.length > 0).toBe(true);
      expect(Array.isArray(gf.rules)).toBe(true);
    });

    it('passes the per-type question schema', () => {
      if (gf.type === 'quizjagd') {
        const total = gf.questions.easy.length + gf.questions.medium.length + gf.questions.hard.length;
        expect(total).toBeGreaterThan(0);
        for (const diff of ['easy', 'medium', 'hard'] as const) {
          for (const q of gf.questions[diff]) { expect(q.question).toBeTruthy(); expect(q.answer).toBeTruthy(); }
        }
        // The board plays questionsPerTeam × 2 real questions; each difficulty's first
        // entry is the shared "Beispiel" (skipped at runtime). Guarantee enough usable
        // questions so the game can never dead-end mid-round (see Quizjagd.tsx pickQuestion).
        const usable = (['easy', 'medium', 'hard'] as const).reduce((n, d) => n + Math.max(0, gf.questions[d].length - 1), 0);
        const needed = (gf.questionsPerTeam ?? 10) * 2;
        expect(usable, `quizjagd has ${usable} usable questions but needs ${needed} (questionsPerTeam=${gf.questionsPerTeam})`).toBeGreaterThanOrEqual(needed);
        return;
      }
      expect(Array.isArray(gf.questions) && gf.questions.length > 0).toBe(true);
      for (const q of gf.questions) validateQuestion(gf.type, q);
    });

    it('every media reference has a matching generator entry', () => {
      const refs = [...JSON.stringify(gf).matchAll(/\/(images|audio|videos)\/[^"\\]+/g)].map(m => m[0].slice(1));
      const dests = new Set((game.media ?? []).map(m => m.dest));
      for (const ref of refs) expect(dests, `no generator for media reference /${ref}`).toContain(ref);
    });

    it('every declared media item is referenced by the game', () => {
      const json = JSON.stringify(gf);
      for (const m of game.media ?? []) expect(json, `${m.dest} declared but unused`).toContain(`/${m.dest}`);
    });
  });
});
