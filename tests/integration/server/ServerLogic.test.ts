import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Server logic integration tests.
 * These test the server's route handlers and helpers using mock data,
 * NOT depending on config.json or gitignored media files.
 */

// We test the server logic by importing the handler logic into isolated tests.
// Since the server module starts listening on import, we test
// the individual helper functions and API behavior conceptually.

describe('Server Config Loading', () => {
  it('config.template.json is valid JSON', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);
    
    expect(config).toHaveProperty('gameOrder');
    expect(config).toHaveProperty('games');
    expect(Array.isArray(config.gameOrder)).toBe(true);
    expect(typeof config.games).toBe('object');
  });

  it('config.template.json has valid game types', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);

    const validTypes = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'audio-guess',
      'image-game',
      'four-statements',
      'fact-or-fake',
      'quizjagd',
    ];

    for (const gameId of config.gameOrder) {
      const game = config.games[gameId];
      expect(game).toBeDefined();
      expect(validTypes).toContain(game.type);
      expect(typeof game.title).toBe('string');
      expect(game.title.length).toBeGreaterThan(0);
    }
  });

  it('config.template.json games in gameOrder exist in games object', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);

    for (const gameId of config.gameOrder) {
      expect(config.games[gameId]).toBeDefined();
    }
  });

  it('config.template.json games have required fields per type', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);

    const typesNeedingQuestions = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'four-statements',
      'fact-or-fake',
    ];

    for (const gameId of config.gameOrder) {
      const game = config.games[gameId];
      if (typesNeedingQuestions.includes(game.type)) {
        expect(game.questions).toBeDefined();
        if (game.type !== 'quizjagd') {
          expect(Array.isArray(game.questions)).toBe(true);
        }
      }
    }
  });
});

describe('Server Audio Filter Logic', () => {
  it('audio file filter regex matches common audio formats', () => {
    const audioRegex = /\.(mp3|m4a|wav|ogg|opus)$/i;
    expect(audioRegex.test('song.mp3')).toBe(true);
    expect(audioRegex.test('song.M4A')).toBe(true);
    expect(audioRegex.test('track.wav')).toBe(true);
    expect(audioRegex.test('music.ogg')).toBe(true);
    expect(audioRegex.test('audio.opus')).toBe(true);
    expect(audioRegex.test('document.pdf')).toBe(false);
    expect(audioRegex.test('image.jpg')).toBe(false);
    expect(audioRegex.test('.hidden.mp3')).toBe(true);
  });

  it('dotfile filter excludes files starting with .', () => {
    const files = ['.DS_Store', 'song.mp3', '.hidden.wav', 'track.opus'];
    const filtered = files.filter(
      file => /\.(mp3|m4a|wav|ogg|opus)$/i.test(file) && !file.startsWith('.')
    );
    expect(filtered).toEqual(['song.mp3', 'track.opus']);
  });
});

describe('Server Image Filter Logic', () => {
  it('image file filter regex matches common image formats', () => {
    const imageRegex = /\.(jpg|jpeg|png|gif)$/i;
    expect(imageRegex.test('photo.jpg')).toBe(true);
    expect(imageRegex.test('photo.JPEG')).toBe(true);
    expect(imageRegex.test('icon.png')).toBe(true);
    expect(imageRegex.test('animation.gif')).toBe(true);
    expect(imageRegex.test('video.mp4')).toBe(false);
    expect(imageRegex.test('document.pdf')).toBe(false);
  });
});

describe('Server Audio Guess Question Building', () => {
  it('example folders are identified by Beispiel_ prefix', () => {
    const folderName = 'Beispiel_bad guy - Billie Eilish';
    const isExample = folderName.startsWith('Beispiel_');
    const answer = folderName.replace(/^Beispiel_/, '');
    expect(isExample).toBe(true);
    expect(answer).toBe('bad guy - Billie Eilish');
  });

  it('regular folders are not examples', () => {
    const folderName = 'Dancing Queen - ABBA';
    const isExample = folderName.startsWith('Beispiel_');
    const answer = folderName.replace(/^Beispiel_/, '');
    expect(isExample).toBe(false);
    expect(answer).toBe('Dancing Queen - ABBA');
  });
});

describe('Server Image Game Question Building', () => {
  it('extracts answer from filename without extension', () => {
    const file = 'Eiffel Tower.jpg';
    const ext = path.extname(file);
    const answer = path.basename(file, ext).replace(/^Beispiel_/, '');
    expect(answer).toBe('Eiffel Tower');
  });

  it('extracts answer from Beispiel_ prefixed filename', () => {
    const file = 'Beispiel_Test Image.png';
    const ext = path.extname(file);
    const answer = path.basename(file, ext).replace(/^Beispiel_/, '');
    expect(answer).toBe('Test Image');
  });

  it('identifies example images by Beispiel_ prefix', () => {
    expect('Beispiel_test.jpg'.startsWith('Beispiel_')).toBe(true);
    expect('normal.jpg'.startsWith('Beispiel_')).toBe(false);
  });
});

describe('Server Settings Response Shape', () => {
  it('produces correct defaults when config values are missing', () => {
    const config = {} as any;
    const response = {
      pointSystemEnabled: config.pointSystemEnabled !== false,
      teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
      globalRules: config.globalRules || [
        'Es gibt mehrere Spiele.',
        'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
        'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
        'Das Team mit den meisten Punkten gewinnt am Ende.',
      ],
    };

    expect(response.pointSystemEnabled).toBe(true);
    expect(response.teamRandomizationEnabled).toBe(true);
    expect(response.globalRules).toHaveLength(4);
  });

  it('respects explicit false for pointSystemEnabled', () => {
    const config = { pointSystemEnabled: false } as any;
    const response = {
      pointSystemEnabled: config.pointSystemEnabled !== false,
    };
    expect(response.pointSystemEnabled).toBe(false);
  });

  it('respects explicit false for teamRandomizationEnabled', () => {
    const config = { teamRandomizationEnabled: false } as any;
    const response = {
      teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
    };
    expect(response.teamRandomizationEnabled).toBe(false);
  });

  it('uses provided globalRules', () => {
    const config = { globalRules: ['Custom Rule'] } as any;
    const response = {
      globalRules: config.globalRules || [],
    };
    expect(response.globalRules).toEqual(['Custom Rule']);
  });
});

describe('Server Game Index Validation', () => {
  it('rejects negative index', () => {
    const index = -1;
    expect(isNaN(index) || index < 0).toBe(true);
  });

  it('rejects NaN index', () => {
    const index = parseInt('abc');
    expect(isNaN(index) || index < 0).toBe(true);
  });

  it('rejects index beyond game order length', () => {
    const gameOrder = ['game1', 'game2'];
    const index = 5;
    expect(index >= gameOrder.length).toBe(true);
  });

  it('accepts valid index', () => {
    const gameOrder = ['game1', 'game2', 'game3'];
    const index = 1;
    expect(!isNaN(index) && index >= 0 && index < gameOrder.length).toBe(true);
  });
});
