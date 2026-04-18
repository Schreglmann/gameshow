/**
 * Shared movie poster logic: slug derivation, TMDB/IMDb search, fetch and save.
 * Used by both server/index.ts (on upload) and fetch-movie-posters.ts (bulk script).
 */

import path from 'path';
import https from 'https';
import http from 'http';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { resolveAliasChecked } from './asset-alias-map.js';

export const MOVIE_POSTERS_SUBDIR = 'Movie Posters';

// ─── Slug ─────────────────────────────────────────────────────────────────────

/**
 * Derive a stable filesystem slug from a video filename.
 * Must match the identical function in AssetsTab.tsx.
 *
 * "The Shawshank Redemption (1994).mkv" → "the-shawshank-redemption"
 * "Terminator.2.Judgment.Day.mp4"       → "terminator-2-judgment-day"
 */
export function videoFilenameToSlug(filename: string): string {
  const basename = path.basename(filename, path.extname(filename));
  return basename
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')       // strip year like (1994)
    .replace(/\[.*?\]/g, '')         // strip [brackets]
    .replace(/\(.*?\)/g, '')         // strip (remaining parens)
    .replace(/[._]/g, ' ')           // dots/underscores → spaces
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Movie name extraction ─────────────────────────────────────────────────────

/** Build a human-readable movie name from a filename for use in search queries. */
function filenameToMovieName(filename: string): string {
  const basename = path.basename(filename, path.extname(filename));
  const yearMatch = basename.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  const name = basename
    .replace(/\(\d{4}\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[._]/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return year ? `${name} ${year}` : name;
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

export function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': 'GameshowPosterFetcher/1.0' },
    };
    (client as typeof https).get(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

/** Sliding-window rate limiter: max 20 req/min (polite limit for IMDb suggestion API). */
const IMDB_RATE_LIMIT = 20;
const IMDB_RATE_WINDOW_MS = 60_000;
const imdbTimestamps: number[] = [];

async function waitForImdbSlot(log: (msg: string) => void): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    while (imdbTimestamps.length > 0 && imdbTimestamps[0] <= now - IMDB_RATE_WINDOW_MS) {
      imdbTimestamps.shift();
    }
    if (imdbTimestamps.length < IMDB_RATE_LIMIT) {
      imdbTimestamps.push(now);
      return;
    }
    const waitMs = imdbTimestamps[0] + IMDB_RATE_WINDOW_MS - now + 100;
    log(`IMDb: Rate-Limit erreicht, warte ${Math.ceil(waitMs / 1000)}s…`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

// ─── Search ────────────────────────────────────────────────────────────────────

async function searchTmdb(movieName: string, apiKey: string, log: (msg: string) => void): Promise<string | null> {
  log(`TMDB: Suche nach "${movieName}"…`);
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(movieName)}`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as { results?: Array<{ poster_path?: string }> };
    const posterPath = data.results?.[0]?.poster_path;
    if (posterPath) {
      log(`TMDB: Treffer gefunden`);
      return `https://image.tmdb.org/t/p/w500${posterPath}`;
    }
    log(`TMDB: Kein Treffer`);
  } catch (e) {
    log(`TMDB: Fehler — ${(e as Error).message}`);
  }
  return null;
}

interface ImdbSuggestion {
  i?: { imageUrl: string; width: number; height: number };
  id: string;
  l: string;
  qid?: string;
}
interface ImdbSuggestionResponse { d?: ImdbSuggestion[] }

/**
 * Upscale an IMDb/Amazon image URL to a larger size.
 * Replaces the `._V1_.jpg` suffix with a width-constrained version.
 */
function imdbImageResize(url: string, width: number): string {
  return url.replace(/\._V1_.*\.jpg$/i, `._V1_SX${width}.jpg`);
}

async function searchImdb(movieName: string, log: (msg: string) => void): Promise<string | null> {
  await waitForImdbSlot(log);
  log(`IMDb: Suche nach "${movieName}"…`);
  // IMDb suggestion API — public, no key needed, returns posters for movies and TV series.
  const query = encodeURIComponent(movieName.toLowerCase());
  const url = `https://v3.sg.media-imdb.com/suggestion/x/${query}.json`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as ImdbSuggestionResponse;
    if (data.d) {
      // Take the first result with an image — IMDb already sorts by relevance
      const result = data.d.find(r => r.i?.imageUrl);
      if (result?.i?.imageUrl) {
        log(`IMDb: Treffer gefunden — "${result.l}"`);
        return imdbImageResize(result.i.imageUrl, 500);
      }
    }
    log('IMDb: Kein Ergebnis');
  } catch (e) {
    log(`IMDb: Fehler — ${(e as Error).message}`);
  }
  return null;
}

/**
 * Fetch a poster image URL for a movie name.
 * Uses TMDB when TMDB_API_KEY is set, falls back to IMDb suggestion API (free, no key needed).
 */
export async function fetchPosterUrl(movieName: string, log: (msg: string) => void = () => {}): Promise<string | null> {
  const tmdbKey = process.env.TMDB_API_KEY;
  if (tmdbKey) {
    const result = await searchTmdb(movieName, tmdbKey, log);
    if (result) return result;
  } else {
    log(`TMDB: kein API-Key gesetzt, überspringe`);
  }
  return searchImdb(movieName, log);
}

// ─── Save ──────────────────────────────────────────────────────────────────────

/**
 * Fetch and save a movie poster for a video filename.
 *
 * @param videoFilename   - just the filename, e.g. "Die Hard.mp4"
 * @param imagesCategoryDir - the images/ category directory to save into
 * @param log             - optional callback for progress messages
 * @returns "/images/movie-posters/{slug}.jpg" on success, null otherwise
 */
export async function fetchAndSavePoster(
  videoFilename: string,
  imagesCategoryDir: string,
  log: (msg: string) => void = () => {},
): Promise<string | null> {
  const slug = videoFilenameToSlug(videoFilename);
  if (!slug) { log('Fehler: Slug konnte nicht ermittelt werden'); return null; }

  const posterDir = path.join(imagesCategoryDir, MOVIE_POSTERS_SUBDIR);
  const derivedName = `${slug}.jpg`;

  // Resolve through the alias map — if a previous merge redirected this poster
  // to another filename that still exists, return early.
  const posterName = await resolveAliasChecked(imagesCategoryDir, posterDir, derivedName);
  const posterPath = path.join(posterDir, posterName);

  if (posterName !== derivedName && existsSync(posterPath)) {
    log(`Cover bereits vorhanden (über Alias → ${posterName}), wird übersprungen`);
    return `/images/${MOVIE_POSTERS_SUBDIR}/${posterName}`;
  }

  if (existsSync(posterPath)) {
    log('Cover bereits vorhanden, wird neu geladen');
  }

  const movieName = filenameToMovieName(videoFilename);
  if (!movieName.trim()) { log('Fehler: Filmname konnte nicht ermittelt werden'); return null; }
  log(`Filmname: "${movieName}"`);

  const posterUrl = await fetchPosterUrl(movieName, log);
  if (!posterUrl) { log('Kein Poster-URL gefunden'); return null; }

  log('Bild wird heruntergeladen…');
  try {
    const imgData = await fetchUrl(posterUrl);
    await mkdir(posterDir, { recursive: true });
    await writeFile(posterPath, imgData);
    log('✅ Cover gespeichert');
    return `/images/${MOVIE_POSTERS_SUBDIR}/${slug}.jpg`;
  } catch (e) {
    log(`❌ Download fehlgeschlagen: ${(e as Error).message}`);
    return null;
  }
}
