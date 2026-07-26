import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStableSeed,
  getPlayOrder,
  setPlayOrder,
  getHighWater,
  noteHighWater,
  clearPlaythroughStore,
} from '@/utils/gamePlaythroughStore';
import { reconcileOrder } from '@/utils/questionOrder';

describe('gamePlaythroughStore', () => {
  beforeEach(() => {
    clearPlaythroughStore();
  });

  it('returns the same seed for the same gameId and only generates once', () => {
    const gen = vi.fn(() => 12345);
    const first = getStableSeed('georgs-quiz/v1', gen);
    const second = getStableSeed('georgs-quiz/v1', () => 99999);
    expect(first).toBe(12345);
    expect(second).toBe(12345); // second gen ignored — stored seed reused
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('generates independent seeds for different gameIds', () => {
    const a = getStableSeed('game-a', () => 1);
    const b = getStableSeed('game-b', () => 2);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('clearPlaythroughStore forgets stored seeds', () => {
    getStableSeed('game-a', () => 1);
    clearPlaythroughStore();
    const regen = getStableSeed('game-a', () => 42);
    expect(regen).toBe(42); // regenerated after clear
  });

  describe('play order', () => {
    const questions = [{ question: 'Beispiel' }, { question: 'A' }, { question: 'B' }];

    it('has no order before the first deal', () => {
      expect(getPlayOrder('game-a', () => 1)).toBeNull();
    });

    it('stores and returns the reconciled order', () => {
      const seed = getStableSeed('game-a', () => 1);
      const order = reconcileOrder(null, questions, { seed, randomize: true });
      setPlayOrder('game-a', order);
      expect(getPlayOrder('game-a', () => 1)).toBe(order);
    });

    it('keeps orders independent per gameId', () => {
      const order = reconcileOrder(null, questions, { seed: getStableSeed('game-a', () => 1) });
      setPlayOrder('game-a', order);
      expect(getPlayOrder('game-b', () => 2)).toBeNull();
    });

    it('survives a remount, so back-navigation replays the same deck', () => {
      const seed = getStableSeed('game-a', () => 1);
      const order = reconcileOrder(null, questions, { seed, randomize: true });
      setPlayOrder('game-a', order);
      // A remount re-reads rather than re-dealing.
      expect(getPlayOrder('game-a', () => 999)).toBe(order);
    });

    it('is forgotten on clear', () => {
      setPlayOrder('game-a', reconcileOrder(null, questions, { seed: getStableSeed('game-a', () => 1) }));
      clearPlaythroughStore();
      expect(getPlayOrder('game-a', () => 1)).toBeNull();
    });

    it('ignores a write for a game that was never seeded', () => {
      setPlayOrder('ghost', reconcileOrder(null, questions, { seed: 1 }));
      expect(getPlayOrder('ghost', () => 1)).toBeNull();
    });
  });

  describe('high-water mark', () => {
    it('starts at zero and only ever rises', () => {
      getStableSeed('game-a', () => 1);
      expect(getHighWater('game-a')).toBe(0);
      noteHighWater('game-a', 3);
      noteHighWater('game-a', 1); // back-navigation must not lower it
      expect(getHighWater('game-a')).toBe(3);
    });

    it('reports zero for an unknown game', () => {
      expect(getHighWater('never-played')).toBe(0);
    });
  });
});
