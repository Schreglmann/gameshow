import express from 'express';
import path from 'path';
import os from 'os';
import { existsSync, statSync } from 'fs';
import { readdir, readFile, writeFile, unlink, rename, mkdir, rm, stat, copyFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import type { AppConfig, GameConfig, MultiInstanceGameFile, GameFileSummary, AssetCategory } from '../src/types/config.js';
import { isAudioFile, normalizeAudioFile } from './normalize.js';
import { fetchAndSavePoster, videoFilenameToSlug, MOVIE_POSTERS_SUBDIR } from './movie-posters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const GAMES_DIR = path.join(ROOT_DIR, 'games');

// ── Asset path resolution (NAS vs local fallback) ──
const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets');
const NAS_MARKER = path.join(ROOT_DIR, '.nas-active');

// Returns true only when the user has activated NAS mode (.nas-active marker)
// AND the NAS volume is actually reachable right now.
// Checked per-request so unexpected disconnects fall back to local-assets automatically.
function isNasMounted(): boolean {
  if (!existsSync(NAS_MARKER)) return false;
  try {
    return statSync(NAS_BASE).isDirectory();
  } catch {
    return false;
  }
}

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

const ALLOWED_CATEGORIES: AssetCategory[] = ['audio', 'images', 'background-music', 'videos'];

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

// Resolve category to filesystem directory (NAS or local-assets, checked dynamically)
function categoryDir(category: AssetCategory): string {
  return path.join(isNasMounted() ? NAS_BASE : LOCAL_ASSETS_BASE, category);
}

// Always resolves to local-assets (used for mirroring when NAS is mounted)
function localCategoryDir(category: AssetCategory): string {
  return path.join(LOCAL_ASSETS_BASE, category);
}

// When NAS is mounted, mirror a write operation to local-assets.
// Failures are logged but never propagate — the NAS write already succeeded.
async function mirrorToLocal(op: () => Promise<void>): Promise<void> {
  if (!isNasMounted()) return;
  try {
    await op();
  } catch (err) {
    console.warn('[mirror] Failed to mirror to local-assets:', (err as Error).message);
  }
}

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Serve static asset directories — NAS first, local-assets as fallback.
// express.static falls through to next() when a file isn't found, so if the NAS
// is unmounted the request automatically falls through to local-assets.
for (const folder of ['images', 'audio', 'background-music', 'videos']) {
  app.use(`/${folder}`, express.static(path.join(NAS_BASE, folder)));
  app.use(`/${folder}`, express.static(path.join(LOCAL_ASSETS_BASE, folder)));
}

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

    res.json({ ...baseResponse, config: gameConfig });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

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
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
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
    await writeFile(filePath, JSON.stringify(gameFile, null, 2) + '\n', 'utf8');
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
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
    await rename(tmpPath, CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save config: ${(err as Error).message}` });
  }
});

// Helper: scan a questions array for audio trim markers for a given audio path
function scanQuestionsForMarkers(questions: unknown, audioPath: string): { start?: number; end?: number }[] {
  const results: { start?: number; end?: number }[] = [];
  if (!Array.isArray(questions)) return results;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const qo = q as Record<string, unknown>;
    if (qo.questionAudio === audioPath) {
      results.push({
        start: typeof qo.questionAudioStart === 'number' ? qo.questionAudioStart : undefined,
        end: typeof qo.questionAudioEnd === 'number' ? qo.questionAudioEnd : undefined,
      });
    }
    if (qo.answerAudio === audioPath) {
      results.push({
        start: typeof qo.answerAudioStart === 'number' ? qo.answerAudioStart : undefined,
        end: typeof qo.answerAudioEnd === 'number' ? qo.answerAudioEnd : undefined,
      });
    }
  }
  return results;
}

// GET /api/backend/asset-usages — find games that reference a given asset path
app.get('/api/backend/asset-usages', async (req, res) => {
  const { category, file } = req.query as { category?: string; file?: string };
  if (!category || !file || !isSafeCategory(category)) return res.json({ games: [] });
  const searchPath = `/${category}/${file}`;
  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const usages: { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[] }[] = [];
    for (const gf of gameFiles) {
      const data = await readFile(path.join(GAMES_DIR, gf), 'utf8');
      if (!data.includes(searchPath)) continue;
      const content = JSON.parse(data);
      const fileName = gf.replace('.json', '');
      const title = content.title || gf;
      if (content.instances && typeof content.instances === 'object') {
        // One entry per matching instance with that instance's own markers
        for (const [instKey, instContent] of Object.entries(content.instances as Record<string, unknown>)) {
          if (!JSON.stringify(instContent).includes(searchPath)) continue;
          const markers = scanQuestionsForMarkers(
            instContent && typeof instContent === 'object' ? (instContent as Record<string, unknown>).questions : [],
            searchPath
          );
          usages.push({ fileName, title, instance: instKey, ...(markers.length ? { markers } : {}) });
        }
      } else {
        const markers = scanQuestionsForMarkers(content.questions, searchPath);
        usages.push({ fileName, title, ...(markers.length ? { markers } : {}) });
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

    await mirrorToLocal(async () => {
      const localDir = localCategoryDir(category);
      const localFrom = path.join(localDir, from);
      const localTo = path.join(localDir, to);
      let localDestIsDir = false;
      try { localDestIsDir = (await stat(localTo)).isDirectory(); } catch { /* doesn't exist */ }
      if (localDestIsDir) {
        const tmpPath = `${localTo}.__moving__`;
        await rename(localFrom, tmpPath);
        try {
          const remaining = await readdir(path.dirname(localFrom));
          if (remaining.length === 0) await rm(path.dirname(localFrom), { recursive: true });
        } catch { /* ignore */ }
        await rename(tmpPath, localTo);
      } else {
        await mkdir(path.dirname(localTo), { recursive: true });
        await rename(localFrom, localTo);
      }
    });

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

// GET /api/backend/asset-storage — current storage mode (NAS or local-assets)
app.get('/api/backend/asset-storage', (_req, res) => {
  const nas = isNasMounted();
  res.json({ mode: nas ? 'nas' : 'local', path: nas ? NAS_BASE : LOCAL_ASSETS_BASE });
});

// GET /api/backend/assets/:category — list files/subfolders
app.get('/api/backend/assets/:category', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const dir = categoryDir(category);

  try {
    if (!existsSync(dir)) {
      return res.json({ files: [] });
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
    try {
      await rename(req.file.path, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(req.file.path, destPath);
        await unlink(req.file.path);
      } else throw e;
    }
    // Normalize audio files to -16 LUFS during upload
    let finalPath = destPath;
    const isAudio = category === 'audio' || category === 'background-music';
    if (isAudio && isAudioFile(destPath)) {
      finalPath = await normalizeAudioFile(destPath);
    }
    const finalName = path.basename(finalPath);
    await mirrorToLocal(async () => {
      const localBase = subfolder
        ? path.join(localCategoryDir(category), subfolder)
        : localCategoryDir(category);
      await mkdir(localBase, { recursive: true });
      await copyFile(finalPath, path.join(localBase, finalName));
    });
    res.json({ fileName: finalName });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/videos/fetch-cover — fetch movie poster on demand
app.post('/api/backend/assets/videos/fetch-cover', async (req, res) => {
  const { fileName } = req.body as { fileName?: string };
  if (!fileName || !isSafePath(fileName)) return res.status(400).json({ error: 'Invalid fileName' });

  const imagesDir = categoryDir('images');
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(`[poster] ${msg}`); };

  try {
    const posterRelPath = await fetchAndSavePoster(fileName, imagesDir, log);
    if (posterRelPath) {
      const slug = videoFilenameToSlug(fileName);
      await mirrorToLocal(async () => {
        const nasFile = path.join(imagesDir, MOVIE_POSTERS_SUBDIR, `${slug}.jpg`);
        if (existsSync(nasFile)) {
          const localDir = path.join(localCategoryDir('images'), MOVIE_POSTERS_SUBDIR);
          await mkdir(localDir, { recursive: true });
          await copyFile(nasFile, path.join(localDir, `${slug}.jpg`));
        }
      });
    }
    res.json({ posterPath: posterRelPath, logs });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch cover: ${(err as Error).message}`, logs });
  }
});

// POST /api/backend/assets/:category/mkdir — create an empty folder
app.post('/api/backend/assets/:category/mkdir', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath || !isSafePath(folderPath)) return res.status(400).json({ error: 'Invalid folderPath' });
  try {
    await mkdir(path.join(categoryDir(category), folderPath), { recursive: true });
    await mirrorToLocal(async () => {
      await mkdir(path.join(localCategoryDir(category), folderPath), { recursive: true });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create folder: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/assets/:category — delete a file (path in body or via wildcard)
// Using a wildcard route to support subfolder paths like audio/FolderName/file.wav
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
    await mirrorToLocal(async () => {
      const localPath = path.join(localCategoryDir(category), filePath);
      const localStat = await import('fs/promises').then(m => m.stat(localPath));
      if (localStat.isDirectory()) {
        await rm(localPath, { recursive: true });
      } else {
        await unlink(localPath);
      }
    });
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
