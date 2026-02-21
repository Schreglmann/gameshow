import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSettings, fetchGameData, fetchBackgroundMusic } from '@/services/api';

describe('API Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSettings', () => {
    it('returns settings on success', async () => {
      const mockSettings = {
        pointSystemEnabled: true,
        teamRandomizationEnabled: false,
        globalRules: ['Rule 1', 'Rule 2'],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSettings),
      });

      const result = await fetchSettings();
      expect(result).toEqual(mockSettings);
      expect(fetch).toHaveBeenCalledWith('/api/settings');
    });

    it('throws an error when the response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(fetchSettings()).rejects.toThrow('Failed to fetch settings');
    });

    it('throws when fetch rejects (network error)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(fetchSettings()).rejects.toThrow('Network error');
    });
  });

  describe('fetchGameData', () => {
    it('returns game data for a valid index', async () => {
      const mockData = {
        gameId: 'game1',
        config: { type: 'simple-quiz', title: 'Test Quiz', questions: [] },
        currentIndex: 0,
        totalGames: 3,
        pointSystemEnabled: true,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await fetchGameData(0);
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith('/api/game/0');
    });

    it('constructs the right URL for different indices', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await fetchGameData(5);
      expect(fetch).toHaveBeenCalledWith('/api/game/5');
    });

    it('throws when game is not found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchGameData(99)).rejects.toThrow('Failed to fetch game 99');
    });
  });

  describe('fetchBackgroundMusic', () => {
    it('returns list of music files', async () => {
      const mockFiles = ['track1.mp3', 'track2.opus', 'track3.m4a'];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFiles),
      });

      const result = await fetchBackgroundMusic();
      expect(result).toEqual(mockFiles);
      expect(fetch).toHaveBeenCalledWith('/api/background-music');
    });

    it('throws when the response fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(fetchBackgroundMusic()).rejects.toThrow('Failed to fetch background music');
    });
  });
});
