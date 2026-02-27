import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import type { AppConfig, GameConfig, AudioGuessQuestion, ImageGameQuestion, MultiInstanceGameFile } from '../src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const GAMES_DIR = path.join(ROOT_DIR, 'games');

const app = express();
const PORT = process.env.PORT || 3000;

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Serve static asset directories
app.use('/audio-guess', express.static(path.join(ROOT_DIR, 'audio-guess')));
app.use('/image-guess', express.static(path.join(ROOT_DIR, 'image-guess')));
app.use('/images', express.static(path.join(ROOT_DIR, 'images')));
app.use('/audio', express.static(path.join(ROOT_DIR, 'audio')));
app.use('/background-music', express.static(path.join(ROOT_DIR, 'background-music')));

// ── Config helpers ──

async function loadConfig(): Promise<AppConfig> {
  const data = await readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(data) as AppConfig;
}

/**
 * Get the active gameOrder from config.
 * Resolves config.activeGameshow → config.gameshows[active].gameOrder
 */
function getActiveGameOrder(config: AppConfig): string[] {
  const active = config.gameshows[config.activeGameshow];
  if (!active) {
    throw new Error(`Active gameshow "${config.activeGameshow}" not found. Available: ${Object.keys(config.gameshows).join(', ')}`);
  }
  return active.gameOrder;
}

/**
 * Parse a gameOrder entry like "allgemeinwissen/v1" or "trump-oder-hitler"
 * into { gameName, instanceName }.
 */
function parseGameRef(ref: string): { gameName: string; instanceName: string | null } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) return { gameName: ref, instanceName: null };
  return { gameName: ref.slice(0, slashIdx), instanceName: ref.slice(slashIdx + 1) };
}

/**
 * Load a game config from games/<gameName>.json, optionally selecting an instance.
 *
 * Single-instance file: the file IS the GameConfig.
 * Multi-instance file: base config + instances.{name} merged together.
 */
async function loadGameConfig(gameName: string, instanceName: string | null): Promise<GameConfig> {
  const filePath = path.join(GAMES_DIR, `${gameName}.json`);
  const data = await readFile(filePath, 'utf8');
  const fileContent = JSON.parse(data);

  if ('instances' in fileContent && fileContent.instances) {
    // Multi-instance game file
    const { instances, ...base } = fileContent as MultiInstanceGameFile & Record<string, unknown>;
    if (!instanceName) {
      throw new Error(`Game "${gameName}" has multiple instances but no instance was specified. Available: ${Object.keys(instances).join(', ')}`);
    }
    const instance = instances[instanceName];
    if (!instance) {
      throw new Error(`Instance "${instanceName}" not found in game "${gameName}". Available: ${Object.keys(instances).join(', ')}`);
    }
    return { ...base, ...instance } as GameConfig;
  }

  // Single-instance game file
  if (instanceName) {
    throw new Error(`Game "${gameName}" is single-instance but instance "${instanceName}" was specified`);
  }
  return fileContent as GameConfig;
}

// ── API Routes ──

app.get('/api/music-subfolders', async (_req, res) => {
  try {
    const musicDir = path.join(ROOT_DIR, 'audio-guess');
    const entries = await readdir(musicDir, { withFileTypes: true });
    const subfolders = entries.filter(d => d.isDirectory()).map(d => d.name);
    res.json(subfolders);
  } catch {
    res.status(500).json({ error: 'Failed to read audio-guess directory' });
  }
});

app.get('/api/background-music', async (_req, res) => {
  try {
    const musicDir = path.join(ROOT_DIR, 'background-music');
    const files = await readdir(musicDir);
    const audioFiles = files.filter(
      file => /\.(mp3|m4a|wav|ogg|opus)$/i.test(file) && !file.startsWith('.')
    );
    res.json(audioFiles);
  } catch {
    console.warn('No background-music directory found');
    res.json([]);
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const config = await loadConfig();
    res.json({
      pointSystemEnabled: config.pointSystemEnabled !== false,
      teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
      globalRules: config.globalRules || [
        'Es gibt mehrere Spiele.',
        'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
        'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
        'Das Team mit den meisten Punkten gewinnt am Ende.',
      ],
    });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

app.get('/api/game/:index', async (req, res) => {
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    const index = parseInt(req.params.index);

    if (isNaN(index) || index < 0 || index >= gameOrder.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameRef = gameOrder[index];
    const { gameName, instanceName } = parseGameRef(gameRef);

    let gameConfig: GameConfig;
    try {
      gameConfig = await loadGameConfig(gameName, instanceName);
    } catch (err) {
      return res.status(404).json({ error: `Game configuration not found: ${(err as Error).message}` });
    }

    const baseResponse = {
      gameId: gameRef,
      currentIndex: index,
      totalGames: gameOrder.length,
      pointSystemEnabled: config.pointSystemEnabled !== false,
    };

    if (gameConfig.type === 'audio-guess') {
      const questions = await buildAudioGuessQuestions();
      gameConfig.questions = questions;
      res.json({ ...baseResponse, config: gameConfig });
    } else if (gameConfig.type === 'image-game') {
      const questions = await buildImageGameQuestions();
      gameConfig.questions = questions;
      res.json({ ...baseResponse, config: gameConfig });
    } else {
      res.json({ ...baseResponse, config: gameConfig });
    }
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── Dynamic question builders ──

async function buildAudioGuessQuestions(): Promise<AudioGuessQuestion[]> {
  const musicDir = path.join(ROOT_DIR, 'audio-guess');

  let entries;
  try {
    entries = await readdir(musicDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const folders = entries.filter(d => d.isDirectory()).map(d => d.name);
  const results = await Promise.all(
    folders.map(async (folderName): Promise<AudioGuessQuestion | null> => {
      try {
        const folderPath = path.join(musicDir, folderName);
        const audioFiles = await readdir(folderPath);
        if (audioFiles.length === 0) return null;

        const audioFile =
          audioFiles.find(f => f === 'short.wav') ||
          audioFiles.find(f => /\.(mp3|m4a|wav)$/i.test(f));

        if (!audioFile) return null;

        return {
          folder: folderName,
          audioFile,
          answer: folderName.replace(/^Beispiel_/, ''),
          isExample: folderName.startsWith('Beispiel_'),
        };
      } catch {
        return null;
      }
    })
  );

  let questions = results.filter((q): q is AudioGuessQuestion => q !== null);
  const example = questions.find(q => q.isExample);
  questions = questions.filter(q => !q.isExample);
  questions.sort(() => Math.random() - 0.5);
  if (example) questions.unshift(example);
  return questions;
}

async function buildImageGameQuestions(): Promise<ImageGameQuestion[]> {
  const imagesDir = path.join(ROOT_DIR, 'image-guess');

  let files;
  try {
    files = await readdir(imagesDir);
  } catch {
    return [];
  }

  let questions: ImageGameQuestion[] = files
    .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
    .map(file => ({
      image: `/image-guess/${file}`,
      answer: path.basename(file, path.extname(file)).replace(/^Beispiel_/, ''),
      isExample: file.startsWith('Beispiel_'),
    }));

  const example = questions.find(q => q.isExample);
  questions = questions.filter(q => !q.isExample);
  questions.sort(() => Math.random() - 0.5);
  if (example) questions.unshift(example);
  return questions;
}

// ── SPA fallback ──

if (existsSync(clientDist)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ── Start ──

app.listen(PORT, async () => {
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Active gameshow: "${config.activeGameshow}" with ${gameOrder.length} games`);
  } catch (err) {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.warn('Failed to load config on startup:', err);
  }
});
