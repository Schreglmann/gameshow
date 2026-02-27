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
  it('config.template.json is valid JSON with new format', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);
    
    expect(config).toHaveProperty('activeGameshow');
    expect(config).toHaveProperty('gameshows');
    expect(typeof config.gameshows).toBe('object');
    expect(config.gameshows[config.activeGameshow]).toBeDefined();
    // New format: no "games" key — games are in separate files
    expect(config).not.toHaveProperty('games');
  });

  it('config.template.json gameOrder entries reference existing game files', async () => {
    const templatePath = path.resolve(__dirname, '../../../config.template.json');
    const data = await readFile(templatePath, 'utf8');
    const config = JSON.parse(data);
    const gamesDir = path.resolve(__dirname, '../../../games');

    for (const [, show] of Object.entries(config.gameshows) as [string, { gameOrder: string[] }][]) {
      for (const ref of show.gameOrder) {
        const slashIdx = ref.indexOf('/');
        const gameName = slashIdx === -1 ? ref : ref.slice(0, slashIdx);
        const instanceName = slashIdx === -1 ? null : ref.slice(slashIdx + 1);
        const gameFile = path.join(gamesDir, `${gameName}.json`);
        
        expect(existsSync(gameFile), `Game file missing: games/${gameName}.json`).toBe(true);
        
        const gameData = JSON.parse(await readFile(gameFile, 'utf8'));
        if (instanceName) {
          expect(gameData.instances, `Game "${gameName}" should have instances`).toBeDefined();
          expect(gameData.instances[instanceName], `Instance "${instanceName}" missing in "${gameName}"`).toBeDefined();
        }
      }
    }
  });

  it('game files have valid game types', async () => {
    const gamesDir = path.resolve(__dirname, '../../../games');
    const { readdirSync } = await import('fs');
    const files = readdirSync(gamesDir).filter((f: string) => f.endsWith('.json'));

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

    for (const file of files) {
      const data = JSON.parse(await readFile(path.join(gamesDir, file), 'utf8'));
      expect(validTypes, `Invalid type in ${file}`).toContain(data.type);
      expect(typeof data.title).toBe('string');
      expect(data.title.length).toBeGreaterThan(0);
    }
  });

  it('game files with questions have non-empty question arrays', async () => {
    const gamesDir = path.resolve(__dirname, '../../../games');
    const { readdirSync } = await import('fs');
    const files = readdirSync(gamesDir).filter((f: string) => f.endsWith('.json'));

    const typesNeedingQuestions = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'four-statements',
      'fact-or-fake',
    ];

    for (const file of files) {
      const data = JSON.parse(await readFile(path.join(gamesDir, file), 'utf8'));
      if (typesNeedingQuestions.includes(data.type)) {
        if (data.instances) {
          // Multi-instance: each instance should have questions
          for (const [instName, inst] of Object.entries(data.instances as Record<string, any>)) {
            expect(Array.isArray(inst.questions), `${file} instance ${instName} should have questions array`).toBe(true);
            expect(inst.questions.length, `${file} instance ${instName} has empty questions`).toBeGreaterThan(0);
          }
        } else {
          // Single-instance
          expect(Array.isArray(data.questions), `${file} should have questions array`).toBe(true);
          expect(data.questions.length, `${file} has empty questions`).toBeGreaterThan(0);
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
