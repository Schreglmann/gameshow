import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStableSeed, clearPlaythroughStore } from '@/utils/gamePlaythroughStore';

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
});
