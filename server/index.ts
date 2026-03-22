import express from 'express';
import path from 'path';
import os from 'os';
import { existsSync } from 'fs';
import { readdir, readFile, writeFile, unlink, rename, mkdir, rm, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import type { AppConfig, GameConfig, AudioGuessQuestion, MultiInstanceGameFile, GameFileSummary, AssetCategory } from '../src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const GAMES_DIR = path.join(ROOT_DIR, 'games');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Log all error responses to the terminal
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) {
      const msg = typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: string }).error
        : JSON.stringify(body);
      console.error(`[${res.statusCode}] ${_req.method} ${_req.path} — ${msg}`);
    }
    return origJson(body);
  };
  next();
});

// Multer: upload to temp dir, then move to target
const upload = multer({ dest: os.tmpdir() });

// ── Security helpers ──

const ALLOWED_CATEGORIES: AssetCategory[] = ['audio', 'images', 'audio-guess', 'background-music'];

function isSafeFileName(name: string): boolean {
  return !name.includes('..') && !name.includes('\0') && name.length > 0;
}

async function detectJsonIndent(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf8');
    const match = content.match(/\n( +)"/);
    return match ? match[1].length : 2;
  } catch {
    return 2;
  }
}

// Like isSafeFileName but allows '/' for nested subfolder paths
function isSafePath(p: string): boolean {
  if (!p || p.includes('\0') || path.isAbsolute(p)) return false;
  return p.split('/').every(seg => seg.length > 0 && seg !== '..' && seg !== '.');
}

interface FolderListing { name: string; files: string[]; subfolders: FolderListing[]; }

async function listFolderRecursive(dir: string): Promise<FolderListing> {
  const name = path.basename(dir);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e =>
        listFolderRecursive(path.join(dir, e.name))
      )
    );
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
    return { name, files, subfolders };
  } catch {
    return { name, files: [], subfolders: [] };
  }
}

function isSafeCategory(cat: string): cat is AssetCategory {
  return ALLOWED_CATEGORIES.includes(cat as AssetCategory);
}

// Resolve category to filesystem directory
function categoryDir(category: AssetCategory): string {
  return path.join(ROOT_DIR, category);
}

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Serve static asset directories
app.use('/audio-guess', express.static(path.join(ROOT_DIR, 'audio-guess')));
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

// ── Admin Backend API ──

// GET /api/backend/games — list all game files (excluding templates)
app.get('/api/backend/games', async (_req, res) => {
  try {
    const files = await readdir(GAMES_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_'));

    const summaries: GameFileSummary[] = await Promise.all(
      jsonFiles.map(async (file): Promise<GameFileSummary> => {
        const data = await readFile(path.join(GAMES_DIR, file), 'utf8');
        const content = JSON.parse(data);
        const fileName = file.replace('.json', '');
        const isSingleInstance = !('instances' in content && content.instances);
        const instancePlayers: Record<string, string[]> = {};
        if (!isSingleInstance && content.instances) {
          for (const [key, inst] of Object.entries(content.instances as Record<string, { _players?: string[] }>)) {
            if (inst._players) instancePlayers[key] = inst._players;
          }
        }
        return {
          fileName,
          type: content.type,
          title: content.title,
          instances: isSingleInstance ? [] : Object.keys(content.instances),
          isSingleInstance,
          instancePlayers: Object.keys(instancePlayers).length > 0 ? instancePlayers : undefined,
        };
      })
    );

    summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    res.json({ games: summaries });
  } catch (err) {
    res.status(500).json({ error: `Failed to list games: ${(err as Error).message}` });
  }
});

// GET /api/backend/games/:fileName — return raw game file JSON
app.get('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    const data = await readFile(path.join(GAMES_DIR, `${fileName}.json`), 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: 'Game not found' });
  }
});

// PUT /api/backend/games/:fileName — write game file (atomic)
app.put('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  const tmpPath = `${filePath}.tmp`;
  try {
    const indent = await detectJsonIndent(filePath);
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent), 'utf8');
    await rename(tmpPath, filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save game: ${(err as Error).message}` });
  }
});

// POST /api/backend/games — create new game file
app.post('/api/backend/games', async (req, res) => {
  const { fileName, gameFile } = req.body as { fileName: string; gameFile: unknown };
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  if (existsSync(filePath)) return res.status(409).json({ error: 'Game already exists' });
  try {
    await writeFile(filePath, JSON.stringify(gameFile, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create game: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/games/:fileName — delete game file
app.delete('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    await unlink(path.join(GAMES_DIR, `${fileName}.json`));
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Game not found' });
  }
});

// GET /api/backend/config — return full config.json
app.get('/api/backend/config', async (_req, res) => {
  try {
    const data = await readFile(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// PUT /api/backend/config — write config.json (atomic)
app.put('/api/backend/config', async (req, res) => {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  try {
    const indent = await detectJsonIndent(CONFIG_PATH);
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent), 'utf8');
    await rename(tmpPath, CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save config: ${(err as Error).message}` });
  }
});

// GET /api/backend/asset-usages — find games that reference a given asset path
app.get('/api/backend/asset-usages', async (req, res) => {
  const { category, file } = req.query as { category?: string; file?: string };
  if (!category || !file || !isSafeCategory(category)) return res.json({ games: [] });
  const searchPath = `/${category}/${file}`;
  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const usages: { fileName: string; title: string }[] = [];
    for (const gf of gameFiles) {
      const data = await readFile(path.join(GAMES_DIR, gf), 'utf8');
      if (data.includes(searchPath)) {
        const content = JSON.parse(data);
        usages.push({ fileName: gf.replace('.json', ''), title: content.title || gf });
      }
    }
    res.json({ games: usages });
  } catch (err) {
    res.status(500).json({ error: `Failed to search usages: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/move — rename file/folder and rewrite game references
app.post('/api/backend/assets/:category/move', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { from, to } = req.body as { from?: string; to?: string };
  if (!from || !to || !isSafePath(from) || !isSafePath(to)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const dir = categoryDir(category);
  const fromFull = path.join(dir, from);
  const toFull = path.join(dir, to);
  try {
    // Check if destination already exists as a directory (naming collision).
    // This happens when moving the last file out of a folder that shares the file's name,
    // e.g. moving "Foo/Foo.jpg" to root — toFull "Foo.jpg" is still a directory at this point.
    let destIsDir = false;
    try { destIsDir = (await stat(toFull)).isDirectory(); } catch { /* toFull doesn't exist */ }

    if (destIsDir) {
      const tmpPath = `${toFull}.__moving__`;
      await rename(fromFull, tmpPath);
      try {
        const remaining = await readdir(path.dirname(fromFull));
        if (remaining.length === 0) await rm(path.dirname(fromFull), { recursive: true });
      } catch { /* ignore cleanup errors */ }
      await rename(tmpPath, toFull);
    } else {
      await mkdir(path.dirname(toFull), { recursive: true });
      await rename(fromFull, toFull);
    }

    // Rewrite game references: replace /<category>/<from> → /<category>/<to>
    const fromUrl = `/${category}/${from}`;
    const toUrl = `/${category}/${to}`;
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const gf of gameFiles) {
      const fp = path.join(GAMES_DIR, gf);
      const data = await readFile(fp, 'utf8');
      if (data.includes(fromUrl)) {
        const tmpPath = `${fp}.tmp`;
        await writeFile(tmpPath, data.split(fromUrl).join(toUrl), 'utf8');
        await rename(tmpPath, fp);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to move: ${(err as Error).message}` });
  }
});

// GET /api/backend/assets/:category — list files/subfolders
app.get('/api/backend/assets/:category', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const dir = categoryDir(category);

  try {
    if (!existsSync(dir)) {
      return res.json(category === 'audio-guess' ? { subfolders: [] } : { files: [] });
    }

    const entries = await readdir(dir, { withFileTypes: true });

    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e =>
        listFolderRecursive(path.join(dir, e.name))
      )
    );
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
    res.json({ files, subfolders });
  } catch (err) {
    res.status(500).json({ error: `Failed to list assets: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload — upload file
app.post('/api/backend/assets/:category/upload', upload.single('file'), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const subfolder = (req.query.subfolder as string) || '';
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  const baseDir = subfolder
    ? path.join(categoryDir(category), subfolder)
    : categoryDir(category);

  try {
    await mkdir(baseDir, { recursive: true });
    const destPath = path.join(baseDir, req.file.originalname);
    await rename(req.file.path, destPath);
    res.json({ fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/assets/:category — delete a file (path in body or via wildcard)
// Using a wildcard route to support subfolder paths like audio-guess/FolderName/file.wav
app.delete('/api/backend/assets/:category/*', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const filePath = (req.params as Record<string, string>)['0'];
  if (!filePath || filePath.includes('..') || filePath.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const fullPath = path.join(categoryDir(category), filePath);

  try {
    const stat = await import('fs/promises').then(m => m.stat(fullPath));
    if (stat.isDirectory()) {
      await rm(fullPath, { recursive: true });
    } else {
      await unlink(fullPath);
    }
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

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
