import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStableSeed,
  getPlayOrder,
  setPlayOrder,
  getHighWater,
  noteHighWater,
  clearPlaythroughStore,
  hydratePlaythroughStore,
  parseSnapshot,
  setShowPosition,
  noteShowPhase,
  getShowPosition,
  peekBootResume,
  bootResumePhase,
  bootResumeCursor,
  clearBootResume,
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

  // sessionStorage persistence + the reload-resume token. See specs/crash-recovery.md.
  describe('persistence across a reload', () => {
    const questions = [{ question: 'Beispiel' }, { question: 'A' }, { question: 'B' }, { question: 'C' }];

    /** Simulates a reload: module state is rebuilt from sessionStorage only. */
    function reload() {
      hydratePlaythroughStore();
    }

    it('restores seed, order, high-water and cursor', () => {
      const seed = getStableSeed('game-a', () => 777);
      const order = reconcileOrder(null, questions, { seed, randomize: true });
      setPlayOrder('game-a', order);
      noteHighWater('game-a', 3);
      noteHighWater('game-a', 2);
      reload();
      expect(getStableSeed('game-a', () => 1)).toBe(777);
      expect(getPlayOrder('game-a', () => 1)).toEqual(order);
      expect(getHighWater('game-a')).toBe(3);
    });

    it('arms the boot-resume token from the saved position', () => {
      getStableSeed('game-a', () => 1);
      setShowPosition(4, 'game-a');
      noteShowPhase(4, 'game');
      noteHighWater('game-a', 2);
      reload();
      expect(peekBootResume()).toEqual({ gameIndex: 4, gameId: 'game-a', phase: 'game', cursor: 2 });
      expect(bootResumePhase(4)).toBe('game');
      expect(bootResumePhase(5)).toBeNull();
      expect(bootResumeCursor('game-a')).toBe(2);
      expect(bootResumeCursor('game-b')).toBeNull();
    });

    it('has no cursor to resume outside the game phase', () => {
      getStableSeed('game-a', () => 1);
      setShowPosition(4, 'game-a');
      noteShowPhase(4, 'rules');
      reload();
      expect(bootResumePhase(4)).toBe('rules');
      expect(bootResumeCursor('game-a')).toBeNull();
    });

    it('clearBootResume drops the token but keeps the saved state', () => {
      setShowPosition(1, 'game-a');
      reload();
      clearBootResume();
      expect(peekBootResume()).toBeNull();
      expect(getShowPosition()).toEqual({ gameIndex: 1, gameId: 'game-a', phase: 'landing' });
    });

    it('a new game starts at landing, the same game keeps its phase', () => {
      setShowPosition(1, 'game-a');
      noteShowPhase(1, 'game');
      setShowPosition(1, 'game-a');
      expect(getShowPosition()?.phase).toBe('game');
      setShowPosition(2, 'game-b');
      expect(getShowPosition()?.phase).toBe('landing');
    });

    it('ignores a phase for a game that is not the current position', () => {
      setShowPosition(1, 'game-a');
      noteShowPhase(2, 'points');
      expect(getShowPosition()?.phase).toBe('landing');
    });

    it('starts empty when there is nothing stored', () => {
      reload();
      expect(peekBootResume()).toBeNull();
      expect(getShowPosition()).toBeNull();
    });

    it('survives corrupt storage', () => {
      sessionStorage.setItem('show:playthrough', '{nope');
      expect(() => reload()).not.toThrow();
      expect(peekBootResume()).toBeNull();
    });

    it('drops malformed entries and positions', () => {
      const snap = parseSnapshot(JSON.stringify({
        entries: [['ok', { seed: 5, order: null, highWater: 2, cursor: 1 }], ['bad', { seed: 'x' }], 'junk'],
        position: { gameIndex: -1, gameId: 'ok', phase: 'game' },
      }));
      expect([...snap.entries.keys()]).toEqual(['ok']);
      expect(snap.position).toBeNull();
      expect(parseSnapshot(JSON.stringify({ position: { gameIndex: 0, gameId: 'ok', phase: 'warp' } })).position).toBeNull();
    });

    it('clearPlaythroughStore also clears storage', () => {
      setShowPosition(1, 'game-a');
      clearPlaythroughStore();
      reload();
      expect(getShowPosition()).toBeNull();
    });
  });
});
