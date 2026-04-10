/**
 * Shared audio cover logic: search query derivation, iTunes/MusicBrainz search, fetch and save.
 * Used by server/index.ts (on-demand UI) and fetch-audio-covers.ts (bulk script).
 */

import path from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { fetchUrl } from './movie-posters.js';

export const AUDIO_COVERS_SUBDIR = 'audio-covers';

// ─── Search query derivation ──────────────────────────────────────────────────

/** Derive a search query from an audio filename (strip extension, quality tags, etc.) */
export function audioFilenameToSearchQuery(filename: string): string {
  let name = path.basename(filename, path.extname(filename));

  name = name
    .replace(/\((?:128kbit_AAC|152kbit_Opus)\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(Official.*?\)/g, '')
    .replace(/\(Lyrics\)/g, '')
    .replace(/\(Remix!\)/g, '')
    .replace(/\(Video\)/g, '')
    .replace(/\(2012 Remaster\)/g, '')
    .replace(/M⁄V/g, '')
    .replace(/ - RednexMusic com/g, '')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Simple short names like "bad-guy" → "bad guy"
  if (!name.includes(' - ') && !name.includes(' ')) {
    name = name.replace(/-/g, ' ');
  }

  return name;
}

// ─── Cover filename derivation ────────────────────────────────────────────────

/** Derive the cover image filename from an audio filename (same basename, .jpg extension). */
export function audioCoverFilename(audioFilename: string): string {
  const basename = path.basename(audioFilename, path.extname(audioFilename));
  return `${basename}.jpg`;
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchItunes(
  query: string,
  log: (msg: string) => void,
): Promise<string | null> {
  log(`iTunes: Suche nach "${query}"…`);
  const encoded = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=3`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as { resultCount: number; results: Array<{ artworkUrl100?: string }> };
    if (data.resultCount > 0) {
      const artwork = data.results[0].artworkUrl100;
      if (artwork) {
        log('iTunes: Treffer gefunden');
        return artwork.replace('100x100bb', '600x600bb');
      }
    }
    log('iTunes: Kein Ergebnis');
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('403') || msg.includes('429')) {
      log('iTunes: Rate-Limited');
      return null;
    }
    log(`iTunes: Fehler — ${msg}`);
  }
  return null;
}

async function searchMusicBrainz(
  query: string,
  log: (msg: string) => void,
): Promise<string | null> {
  log(`MusicBrainz: Suche nach "${query}"…`);
  const encoded = encodeURIComponent(query);
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encoded}&limit=3&fmt=json`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as { recordings?: Array<{ releases?: Array<{ id: string }> }> };
    if (data.recordings?.length) {
      for (const rec of data.recordings) {
        for (const rel of rec.releases ?? []) {
          try {
            const coverBuf = await fetchUrl(`https://coverartarchive.org/release/${rel.id}`);
            const coverData = JSON.parse(coverBuf.toString()) as {
              images?: Array<{ front?: boolean; thumbnails?: Record<string, string>; image?: string }>;
            };
            const front = coverData.images?.find((img) => img.front);
            if (front?.thumbnails?.['500'] || front?.thumbnails?.large || front?.image) {
              log('MusicBrainz: Treffer gefunden');
              return front.thumbnails?.['500'] ?? front.thumbnails?.large ?? front.image ?? null;
            }
          } catch {
            continue;
          }
        }
      }
    }
    log('MusicBrainz: Kein Ergebnis');
  } catch (e) {
    log(`MusicBrainz: Fehler — ${(e as Error).message}`);
  }
  return null;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Fetch and save an audio cover for an audio filename.
 *
 * @param audioFilename   - just the filename, e.g. "Bad Guy - Billie Eilish.mp3"
 * @param imagesCategoryDir - the images/ category directory to save into
 * @param log             - callback for progress messages
 * @returns "/images/audio-covers/{name}.jpg" on success, null otherwise
 */
export async function fetchAndSaveAudioCover(
  audioFilename: string,
  imagesCategoryDir: string,
  log: (msg: string) => void = () => {},
): Promise<string | null> {
  const coverName = audioCoverFilename(audioFilename);
  const coverDir = path.join(imagesCategoryDir, AUDIO_COVERS_SUBDIR);
  const coverPath = path.join(coverDir, coverName);

  if (existsSync(coverPath)) {
    log('Cover bereits vorhanden, wird neu geladen');
  }

  const searchQuery = audioFilenameToSearchQuery(audioFilename);
  if (!searchQuery.trim()) {
    log('Fehler: Suchbegriff konnte nicht ermittelt werden');
    return null;
  }
  log(`Suchbegriff: "${searchQuery}"`);

  // Try iTunes first, fall back to MusicBrainz
  let coverUrl = await searchItunes(searchQuery, log);
  if (!coverUrl) {
    coverUrl = await searchMusicBrainz(searchQuery, log);
  }

  if (!coverUrl) {
    log('Kein Cover gefunden');
    return null;
  }

  log('Bild wird heruntergeladen…');
  try {
    const imgData = await fetchUrl(coverUrl);
    await mkdir(coverDir, { recursive: true });
    await writeFile(coverPath, imgData);
    log(`✅ Cover gespeichert (${(imgData.length / 1024).toFixed(0)} KB)`);
    return `/images/${AUDIO_COVERS_SUBDIR}/${coverName}`;
  } catch (e) {
    log(`❌ Download fehlgeschlagen: ${(e as Error).message}`);
    return null;
  }
}
