import { describe, it, expect } from 'vitest';
import {
  parseGameRef,
  pruneGameOrder,
  isRefToGame,
  isRefToInstance,
  requalifyBareRefs,
} from '../../../server/game-order.js';
import type { AppConfig } from '../../../src/types/config.js';

function makeConfig(gameOrders: Record<string, string[]>): AppConfig {
  const gameshows: AppConfig['gameshows'] = {};
  for (const [key, gameOrder] of Object.entries(gameOrders)) {
    gameshows[key] = { name: key, gameOrder };
  }
  return { activeGameshow: Object.keys(gameOrders)[0] ?? '', gameshows };
}

describe('parseGameRef', () => {
  it('parses a bare single-instance ref', () => {
    expect(parseGameRef('trump-oder-hitler')).toEqual({ gameName: 'trump-oder-hitler', instanceName: null });
  });

  it('parses an instance-qualified ref', () => {
    expect(parseGameRef('allgemeinwissen/v1')).toEqual({ gameName: 'allgemeinwissen', instanceName: 'v1' });
  });

  it('splits only on the first slash', () => {
    expect(parseGameRef('a/b/c')).toEqual({ gameName: 'a', instanceName: 'b/c' });
  });
});

describe('pruneGameOrder — delete whole game (isRefToGame)', () => {
  it('drops the bare ref to the game', () => {
    const config = makeConfig({ main: ['a', 'b', 'c'] });
    const removed = pruneGameOrder(config, isRefToGame('b'));
    expect(removed).toEqual([{ gameshow: 'main', ref: 'b' }]);
    expect(config.gameshows.main.gameOrder).toEqual(['a', 'c']);
  });

  it('drops every instance-qualified ref to the game', () => {
    const config = makeConfig({ main: ['quiz/v1', 'other', 'quiz/v2', 'quiz/v3'] });
    const removed = pruneGameOrder(config, isRefToGame('quiz'));
    expect(removed.map(r => r.ref)).toEqual(['quiz/v1', 'quiz/v2', 'quiz/v3']);
    expect(config.gameshows.main.gameOrder).toEqual(['other']);
  });

  it('cleans the ref across multiple gameshows', () => {
    const config = makeConfig({
      a: ['quiz/v1', 'keep'],
      b: ['keep2', 'quiz/v2'],
      c: ['only-keep'],
    });
    const removed = pruneGameOrder(config, isRefToGame('quiz'));
    expect(removed).toEqual([
      { gameshow: 'a', ref: 'quiz/v1' },
      { gameshow: 'b', ref: 'quiz/v2' },
    ]);
    expect(config.gameshows.a.gameOrder).toEqual(['keep']);
    expect(config.gameshows.b.gameOrder).toEqual(['keep2']);
    expect(config.gameshows.c.gameOrder).toEqual(['only-keep']);
  });

  it('does not match a different game that shares a prefix', () => {
    const config = makeConfig({ main: ['quiz', 'quiz-extra', 'quiz/v1'] });
    const removed = pruneGameOrder(config, isRefToGame('quiz'));
    expect(removed.map(r => r.ref)).toEqual(['quiz', 'quiz/v1']);
    expect(config.gameshows.main.gameOrder).toEqual(['quiz-extra']);
  });

  it('returns [] and leaves order untouched when nothing matches', () => {
    const config = makeConfig({ main: ['a', 'b'] });
    const removed = pruneGameOrder(config, isRefToGame('missing'));
    expect(removed).toEqual([]);
    expect(config.gameshows.main.gameOrder).toEqual(['a', 'b']);
  });
});

describe('pruneGameOrder — delete single instance (isRefToInstance)', () => {
  it('drops only the targeted instance ref, keeping siblings', () => {
    const config = makeConfig({ main: ['quiz/v1', 'quiz/v2', 'quiz/v3'] });
    const removed = pruneGameOrder(config, isRefToInstance('quiz', 'v2'));
    expect(removed).toEqual([{ gameshow: 'main', ref: 'quiz/v2' }]);
    expect(config.gameshows.main.gameOrder).toEqual(['quiz/v1', 'quiz/v3']);
  });

  it('does not drop the bare game ref when deleting an instance', () => {
    const config = makeConfig({ main: ['quiz', 'quiz/v1'] });
    const removed = pruneGameOrder(config, isRefToInstance('quiz', 'v1'));
    expect(removed.map(r => r.ref)).toEqual(['quiz/v1']);
    expect(config.gameshows.main.gameOrder).toEqual(['quiz']);
  });
});

describe('requalifyBareRefs — single→multi conversion', () => {
  it('re-points the bare ref to /v1', () => {
    const config = makeConfig({ main: ['a', 'quiz', 'b'] });
    const rewritten = requalifyBareRefs(config, 'quiz', 'v1');
    expect(rewritten).toEqual([{ gameshow: 'main', ref: 'quiz/v1' }]);
    expect(config.gameshows.main.gameOrder).toEqual(['a', 'quiz/v1', 'b']);
  });

  it('leaves already-qualified refs to the same game untouched', () => {
    const config = makeConfig({ main: ['quiz/v2', 'quiz/v3'] });
    const rewritten = requalifyBareRefs(config, 'quiz', 'v1');
    expect(rewritten).toEqual([]);
    expect(config.gameshows.main.gameOrder).toEqual(['quiz/v2', 'quiz/v3']);
  });

  it('rewrites bare refs across multiple gameshows but leaves other games alone', () => {
    const config = makeConfig({
      a: ['quiz', 'other'],
      b: ['quiz', 'quiz/v5'],
      c: ['unrelated'],
    });
    const rewritten = requalifyBareRefs(config, 'quiz', 'v1');
    expect(rewritten).toEqual([
      { gameshow: 'a', ref: 'quiz/v1' },
      { gameshow: 'b', ref: 'quiz/v1' },
    ]);
    expect(config.gameshows.a.gameOrder).toEqual(['quiz/v1', 'other']);
    expect(config.gameshows.b.gameOrder).toEqual(['quiz/v1', 'quiz/v5']);
    expect(config.gameshows.c.gameOrder).toEqual(['unrelated']);
  });

  it('does not match a different game sharing a prefix', () => {
    const config = makeConfig({ main: ['quiz', 'quiz-extra'] });
    requalifyBareRefs(config, 'quiz', 'v1');
    expect(config.gameshows.main.gameOrder).toEqual(['quiz/v1', 'quiz-extra']);
  });

  it('is safe when config has no gameshows', () => {
    const config = { activeGameshow: '', gameshows: {} } as AppConfig;
    expect(requalifyBareRefs(config, 'quiz', 'v1')).toEqual([]);
  });
});

describe('pruneGameOrder — edge cases', () => {
  it('handles a gameshow with an empty gameOrder', () => {
    const config = makeConfig({ main: [] });
    expect(pruneGameOrder(config, isRefToGame('x'))).toEqual([]);
  });

  it('handles config with no gameshows', () => {
    const config = { activeGameshow: '', gameshows: {} } as AppConfig;
    expect(pruneGameOrder(config, isRefToGame('x'))).toEqual([]);
  });

  it('skips a gameshow whose gameOrder is missing/non-array', () => {
    const config = { activeGameshow: 'main', gameshows: { main: { name: 'main' } } } as unknown as AppConfig;
    expect(pruneGameOrder(config, isRefToGame('x'))).toEqual([]);
  });
});
