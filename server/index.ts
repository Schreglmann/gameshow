import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { AppConfig, GameConfig, AudioGuessQuestion, ImageGameQuestion } from '../src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Serve static asset directories
app.use('/audio-guess', express.static(path.join(ROOT_DIR, 'audio-guess')));
app.use('/image-guess', express.static(path.join(ROOT_DIR, 'image-guess')));
app.use('/images', express.static(path.join(ROOT_DIR, 'images')));
app.use('/audio', express.static(path.join(ROOT_DIR, 'audio')));
app.use('/background-music', express.static(path.join(ROOT_DIR, 'background-music')));

// ── Config helpers ──

function loadConfig(): AppConfig | null {
  const configPath = path.join(ROOT_DIR, 'config.json');
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data) as AppConfig;
  } catch (err) {
    console.error('Failed to load config:', err);
    return null;
  }
}

// ── API Routes ──

app.get('/api/music-subfolders', (_req, res) => {
  const musicDir = path.join(ROOT_DIR, 'audio-guess');
  fs.readdir(musicDir, { withFileTypes: true }, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read audio-guess directory' });
    }
    const subfolders = files.filter(d => d.isDirectory()).map(d => d.name);
    res.json(subfolders);
  });
});

app.get('/api/background-music', (_req, res) => {
  const musicDir = path.join(ROOT_DIR, 'background-music');
  fs.readdir(musicDir, (err, files) => {
    if (err) {
      console.warn('No background-music directory found');
      return res.json([]);
    }
    const audioFiles = files.filter(
      file => /\.(mp3|m4a|wav|ogg|opus)$/i.test(file) && !file.startsWith('.')
    );
    res.json(audioFiles);
  });
});

app.get('/api/settings', (_req, res) => {
  const config = loadConfig();
  if (!config) {
    return res.status(500).json({ error: 'Failed to load config' });
  }
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
});

app.get('/api/game-order', (_req, res) => {
  const config = loadConfig();
  if (!config) {
    return res.status(500).json({ error: 'Failed to load config' });
  }
  res.json({
    gameOrder: config.gameOrder || [],
    totalGames: config.gameOrder ? config.gameOrder.length : 0,
    pointSystemEnabled: config.pointSystemEnabled !== false,
    teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
  });
});

app.get('/api/game/:index', (req, res) => {
  const configPath = path.join(ROOT_DIR, 'config.json');
  fs.readFile(configPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to load config' });
    }

    const config: AppConfig = JSON.parse(data);
    const index = parseInt(req.params.index);

    if (isNaN(index) || index < 0 || !config.gameOrder || index >= config.gameOrder.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameId = config.gameOrder[index];
    const gameConfig = config.games[gameId] as GameConfig | undefined;

    if (!gameConfig) {
      return res.status(404).json({ error: 'Game configuration not found' });
    }

    const baseResponse = {
      gameId,
      currentIndex: index,
      totalGames: config.gameOrder.length,
      pointSystemEnabled: config.pointSystemEnabled !== false,
    };

    // Dynamic question injection for audio-guess
    if (gameConfig.type === 'audio-guess') {
      const musicDir = path.join(ROOT_DIR, 'audio-guess');
      fs.readdir(musicDir, { withFileTypes: true }, (err, files) => {
        if (err) {
          return res.json({ ...baseResponse, config: gameConfig });
        }

        const folders = files.filter(d => d.isDirectory()).map(d => d.name);

        const promises = folders.map(
          folderName =>
            new Promise<AudioGuessQuestion | null>(resolve => {
              const folderPath = path.join(musicDir, folderName);
              fs.readdir(folderPath, (err, audioFiles) => {
                if (err || audioFiles.length === 0) return resolve(null);

                const audioFile =
                  audioFiles.find(f => f === 'short.wav') ||
                  audioFiles.find(f => /\.(mp3|m4a|wav)$/i.test(f));

                if (!audioFile) return resolve(null);

                const answer = folderName.replace(/^Beispiel_/, '');
                resolve({
                  folder: folderName,
                  audioFile,
                  answer,
                  isExample: folderName.startsWith('Beispiel_'),
                });
              });
            })
        );

        Promise.all(promises).then(results => {
          let questions = results.filter((q): q is AudioGuessQuestion => q !== null);
          const example = questions.find(q => q.isExample);
          questions = questions.filter(q => !q.isExample);
          questions.sort(() => Math.random() - 0.5);
          if (example) questions.unshift(example);
          gameConfig.questions = questions;
          res.json({ ...baseResponse, config: gameConfig });
        });
      });
    }
    // Dynamic question injection for image-game
    else if (gameConfig.type === 'image-game') {
      const imagesDir = path.join(ROOT_DIR, 'image-guess');
      fs.readdir(imagesDir, (err, files) => {
        if (err) {
          return res.json({ ...baseResponse, config: gameConfig });
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
        gameConfig.questions = questions;
        res.json({ ...baseResponse, config: gameConfig });
      });
    } else {
      res.json({ ...baseResponse, config: gameConfig });
    }
  });
});

// SPA fallback — serve index.html for all non-API routes (production only)
if (fs.existsSync(clientDist)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  const config = loadConfig();
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Game configuration loaded with ${config?.gameOrder?.length || 0} games`);
});
