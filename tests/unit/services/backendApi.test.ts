import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchGames,
  fetchGame,
  saveGame,
  createGame,
  deleteGame,
  fetchConfig,
  saveConfig,
  fetchAssets,
  uploadAsset,
  deleteAsset,
} from '@/services/backendApi';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockOkResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockErrorResponse(status: number, errorBody: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(errorBody),
  } as Response);
}

describe('backendApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── Games ──

  describe('fetchGames', () => {
    it('calls GET /api/backend/games', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ games: [] }));
      await fetchGames();
      expect(mockFetch).toHaveBeenCalledWith('/api/backend/games', undefined);
    });

    it('returns the games array from the response', async () => {
      const games = [{ fileName: 'quiz', type: 'simple-quiz', title: 'Quiz', instances: [], isSingleInstance: true }];
      mockFetch.mockReturnValue(mockOkResponse({ games }));
      const result = await fetchGames();
      expect(result).toEqual(games);
    });

    it('throws error when response is not ok', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'Internal error' }));
      await expect(fetchGames()).rejects.toThrow('Internal error');
    });

    it('uses statusText when error body has no error field', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(404, {}));
      await expect(fetchGames()).rejects.toThrow('Error');
    });
  });

  describe('fetchGame', () => {
    it('calls GET /api/backend/games/{fileName}', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ type: 'simple-quiz' }));
      await fetchGame('my-quiz');
      expect(mockFetch).toHaveBeenCalledWith('/api/backend/games/my-quiz', undefined);
    });

    it('URL-encodes the fileName', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await fetchGame('my quiz!');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('my quiz!')),
        undefined
      );
    });

    it('returns parsed game data', async () => {
      const data = { type: 'simple-quiz', title: 'Test' };
      mockFetch.mockReturnValue(mockOkResponse(data));
      const result = await fetchGame('test');
      expect(result).toEqual(data);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(404, { error: 'Not found' }));
      await expect(fetchGame('missing')).rejects.toThrow('Not found');
    });
  });

  describe('saveGame', () => {
    it('calls PUT /api/backend/games/{fileName}', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await saveGame('my-quiz', { type: 'simple-quiz' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/games/my-quiz',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('sends JSON body with game data', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      const gameData = { type: 'simple-quiz', title: 'My Quiz' };
      await saveGame('my-quiz', gameData);
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual(gameData);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'Write error' }));
      await expect(saveGame('test', {})).rejects.toThrow('Write error');
    });
  });

  describe('createGame', () => {
    it('calls POST /api/backend/games', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await createGame('new-quiz', { type: 'simple-quiz' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/games',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends fileName and gameFile in JSON body', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      const gameFile = { type: 'guessing-game' };
      await createGame('my-game', gameFile);
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(options.body);
      expect(body.fileName).toBe('my-game');
      expect(body.gameFile).toEqual(gameFile);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(400, { error: 'Already exists' }));
      await expect(createGame('existing', {})).rejects.toThrow('Already exists');
    });
  });

  describe('deleteGame', () => {
    it('calls DELETE /api/backend/games/{fileName}', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await deleteGame('my-quiz');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/games/my-quiz',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('URL-encodes the fileName', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await deleteGame('my quiz');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('my quiz')),
        expect.any(Object)
      );
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(404, { error: 'Not found' }));
      await expect(deleteGame('missing')).rejects.toThrow('Not found');
    });
  });

  // ── Config ──

  describe('fetchConfig', () => {
    it('calls GET /api/backend/config', async () => {
      const config = { activeGameshow: 'gs1', gameshows: {} };
      mockFetch.mockReturnValue(mockOkResponse(config));
      await fetchConfig();
      expect(mockFetch).toHaveBeenCalledWith('/api/backend/config', undefined);
    });

    it('returns parsed config', async () => {
      const config = { activeGameshow: 'gs1', gameshows: {}, pointSystemEnabled: true };
      mockFetch.mockReturnValue(mockOkResponse(config));
      const result = await fetchConfig();
      expect(result).toEqual(config);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'DB error' }));
      await expect(fetchConfig()).rejects.toThrow('DB error');
    });
  });

  describe('saveConfig', () => {
    it('calls PUT /api/backend/config', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await saveConfig({ activeGameshow: 'gs1', gameshows: {} });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/config',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('sends JSON body with config', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      const config = { activeGameshow: 'gs1', gameshows: {}, pointSystemEnabled: false };
      await saveConfig(config);
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual(config);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'Write error' }));
      await expect(saveConfig({ activeGameshow: '', gameshows: {} })).rejects.toThrow('Write error');
    });
  });

  // ── Assets ──

  describe('fetchAssets', () => {
    it('calls GET /api/backend/assets/{category}', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ files: [] }));
      await fetchAssets('images');
      expect(mockFetch).toHaveBeenCalledWith('/api/backend/assets/images', undefined);
    });

    it('calls correct URL for audio category', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ subfolders: [] }));
      await fetchAssets('audio');
      expect(mockFetch).toHaveBeenCalledWith('/api/backend/assets/audio', undefined);
    });

    it('returns parsed asset list response', async () => {
      const data = { files: ['a.jpg', 'b.png'], subfolders: [] };
      mockFetch.mockReturnValue(mockOkResponse(data));
      const result = await fetchAssets('images');
      expect(result).toEqual(data);
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'FS error' }));
      await expect(fetchAssets('images')).rejects.toThrow('FS error');
    });
  });

  describe('uploadAsset', () => {
    it('calls POST /api/backend/assets/{category}/upload', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ fileName: 'test.jpg' }));
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
      await uploadAsset('images', file);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/assets/images/upload',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('includes file in FormData body', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ fileName: 'test.jpg' }));
      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      await uploadAsset('images', file);
      const options = mockFetch.mock.calls[0][1];
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('file')).toBe(file);
    });

    it('appends subfolder as query param when provided', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ fileName: 'test.mp3' }));
      const file = new File([''], 'test.mp3', { type: 'audio/mpeg' });
      await uploadAsset('audio', file, 'Beatles');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('subfolder=Beatles'),
        expect.any(Object)
      );
    });

    it('URL-encodes the subfolder name', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ fileName: 'test.mp3' }));
      const file = new File([''], 'test.mp3');
      await uploadAsset('audio', file, 'My Folder');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('subfolder=My%20Folder'),
        expect.any(Object)
      );
    });

    it('returns the uploaded fileName', async () => {
      mockFetch.mockReturnValue(mockOkResponse({ fileName: 'uploaded-test.jpg' }));
      const file = new File([''], 'test.jpg');
      const result = await uploadAsset('images', file);
      expect(result).toBe('uploaded-test.jpg');
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(500, { error: 'Upload failed' }));
      const file = new File([''], 'test.jpg');
      await expect(uploadAsset('images', file)).rejects.toThrow('Upload failed');
    });
  });

  describe('deleteAsset', () => {
    it('calls DELETE /api/backend/assets/{category}/{filePath}', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await deleteAsset('images', 'photo.jpg');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/assets/images/photo.jpg',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('handles subfolder paths for audio', async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));
      await deleteAsset('audio', 'Beatles/hey-jude.mp3');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/backend/assets/audio/Beatles/hey-jude.mp3',
        expect.any(Object)
      );
    });

    it('throws error on failure', async () => {
      mockFetch.mockReturnValue(mockErrorResponse(404, { error: 'Not found' }));
      await expect(deleteAsset('images', 'missing.jpg')).rejects.toThrow('Not found');
    });
  });

  // ── Error handling edge cases ──

  describe('error handling', () => {
    it('falls back to statusText when json parsing fails', async () => {
      mockFetch.mockReturnValue(
        Promise.resolve({
          ok: false,
          statusText: 'Bad Gateway',
          json: () => Promise.reject(new Error('parse error')),
        } as unknown as Response)
      );
      await expect(fetchGames()).rejects.toThrow('Bad Gateway');
    });

    it('propagates network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));
      await expect(fetchGames()).rejects.toThrow('Network failure');
    });
  });
});
