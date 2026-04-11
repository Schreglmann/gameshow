/**
 * Shared audio cover logic: search query derivation, iTunes/MusicBrainz search, fetch and save.
 * Used by server/index.ts (on-demand UI) and fetch-audio-covers.ts (bulk script).
 */

import path from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { fetchUrl } from './movie-posters.js';

export const AUDIO_COVERS_SUBDIR = 'audio-covers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CoverSearchResult {
  url: string;
  artistName: string;
  trackName: string;
  source: 'itunes' | 'musicbrainz';
  confident: boolean;
}

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

// ─── Matching ────────────────────────────────────────────────────────────────

/** Normalize a string for comparison: lowercase, strip accents, remove special chars */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Check if two strings are a fuzzy match (one contains the other, or high word overlap) */
function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  // Direct containment
  if (na.includes(nb) || nb.includes(na)) return true;
  // Word overlap: if most words of the shorter string appear in the longer one
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerStr = longer.join(' ');
  const matching = shorter.filter(w => w.length > 1 && longerStr.includes(w));
  return matching.length >= Math.ceil(shorter.length * 0.7);
}

/**
 * Check whether a search result's artist/track match the search query.
 * The search query is typically "Artist - Track" or "Track - Artist" derived from filename.
 */
export function isConfidentMatch(query: string, artistName: string, trackName: string): boolean {
  const nq = normalize(query);
  const nArtist = normalize(artistName);
  const nTrack = normalize(trackName);

  // Check if both artist and track appear in the query
  const artistInQuery = fuzzyMatch(nq, nArtist);
  const trackInQuery = fuzzyMatch(nq, nTrack);

  // If both match, confident
  if (artistInQuery && trackInQuery) return true;

  // If the query has a separator (e.g. "Artist - Track"), split and check parts
  const parts = query.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    for (const part of parts) {
      const np = normalize(part);
      // Check if one part matches artist and another matches track
      if ((fuzzyMatch(np, nArtist) || fuzzyMatch(np, nTrack))) {
        const otherParts = parts.filter(p => p !== part).map(p => normalize(p));
        for (const op of otherParts) {
          if (fuzzyMatch(op, nArtist) || fuzzyMatch(op, nTrack)) return true;
        }
      }
    }
  }

  return false;
}

// ─── Search ───────────────────────────────────────────────────────────────────

interface ItunesResult {
  artistName?: string;
  trackName?: string;
  artworkUrl100?: string;
}

export async function searchItunes(
  query: string,
  log: (msg: string) => void,
): Promise<CoverSearchResult | 'RATE_LIMITED' | null> {
  log(`iTunes: Suche nach "${query}"…`);
  const encoded = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=5`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as { resultCount: number; results: ItunesResult[] };
    if (data.resultCount > 0) {
      // First try to find a confident match
      for (const result of data.results) {
        if (!result.artworkUrl100 || !result.artistName || !result.trackName) continue;
        if (isConfidentMatch(query, result.artistName, result.trackName)) {
          log(`iTunes: Treffer — ${result.artistName} – ${result.trackName}`);
          return {
            url: result.artworkUrl100.replace('100x100bb', '600x600bb'),
            artistName: result.artistName,
            trackName: result.trackName,
            source: 'itunes',
            confident: true,
          };
        }
      }
      // No confident match — return the first result as unconfident
      const first = data.results.find(r => r.artworkUrl100);
      if (first?.artworkUrl100) {
        log(`iTunes: Unsicherer Treffer — ${first.artistName ?? '?'} – ${first.trackName ?? '?'}`);
        return {
          url: first.artworkUrl100.replace('100x100bb', '600x600bb'),
          artistName: first.artistName ?? '',
          trackName: first.trackName ?? '',
          source: 'itunes',
          confident: false,
        };
      }
    }
    log('iTunes: Kein Ergebnis');
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('403') || msg.includes('429')) {
      log('iTunes: Rate-Limited');
      return 'RATE_LIMITED';
    }
    log(`iTunes: Fehler — ${msg}`);
  }
  return null;
}

interface MusicBrainzRecording {
  title?: string;
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
  releases?: Array<{ id: string; title?: string }>;
}

export async function searchMusicBrainz(
  query: string,
  log: (msg: string) => void,
): Promise<CoverSearchResult | null> {
  log(`MusicBrainz: Suche nach "${query}"…`);
  const encoded = encodeURIComponent(query);
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encoded}&limit=5&fmt=json`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString()) as { recordings?: MusicBrainzRecording[] };
    if (data.recordings?.length) {
      for (const rec of data.recordings) {
        const artistName = rec['artist-credit']?.[0]?.artist?.name ?? rec['artist-credit']?.[0]?.name ?? '';
        const trackName = rec.title ?? '';
        const confident = isConfidentMatch(query, artistName, trackName);

        for (const rel of rec.releases ?? []) {
          try {
            const coverBuf = await fetchUrl(`https://coverartarchive.org/release/${rel.id}`);
            const coverData = JSON.parse(coverBuf.toString()) as {
              images?: Array<{ front?: boolean; thumbnails?: Record<string, string>; image?: string }>;
            };
            const front = coverData.images?.find((img) => img.front);
            const coverUrl = front?.thumbnails?.['500'] ?? front?.thumbnails?.large ?? front?.image;
            if (coverUrl) {
              log(`MusicBrainz: ${confident ? 'Treffer' : 'Unsicherer Treffer'} — ${artistName} – ${trackName}`);
              return {
                url: coverUrl,
                artistName,
                trackName,
                source: 'musicbrainz',
                confident,
              };
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

export interface CoverFetchResult {
  coverPath: string | null;
  searchResult: CoverSearchResult | null;
  rateLimited: boolean;
}

/**
 * Search for an audio cover and optionally save it.
 *
 * @param audioFilename     - just the filename, e.g. "Bad Guy - Billie Eilish.mp3"
 * @param imagesCategoryDir - the images/ category directory to save into
 * @param log               - callback for progress messages
 * @param confirm           - if provided, called for unconfident matches. Return true to save, false to skip.
 * @returns CoverFetchResult with coverPath, search metadata, and rate-limit status
 */
export async function fetchAndSaveAudioCover(
  audioFilename: string,
  imagesCategoryDir: string,
  log: (msg: string) => void = () => {},
  confirm?: (result: CoverSearchResult) => Promise<boolean>,
): Promise<CoverFetchResult> {
  const coverName = audioCoverFilename(audioFilename);
  const coverDir = path.join(imagesCategoryDir, AUDIO_COVERS_SUBDIR);
  const coverPath = path.join(coverDir, coverName);

  if (existsSync(coverPath)) {
    log('Cover bereits vorhanden, wird neu geladen');
  }

  const searchQuery = audioFilenameToSearchQuery(audioFilename);
  if (!searchQuery.trim()) {
    log('Fehler: Suchbegriff konnte nicht ermittelt werden');
    return { coverPath: null, searchResult: null, rateLimited: false };
  }
  log(`Suchbegriff: "${searchQuery}"`);

  let rateLimited = false;

  // Try iTunes first, fall back to MusicBrainz
  let searchResult: CoverSearchResult | null = null;
  const itunesResult = await searchItunes(searchQuery, log);
  if (itunesResult === 'RATE_LIMITED') {
    rateLimited = true;
  } else if (itunesResult) {
    searchResult = itunesResult;
  }

  if (!searchResult) {
    const mbResult = await searchMusicBrainz(searchQuery, log);
    if (mbResult) searchResult = mbResult;
  }

  if (!searchResult) {
    log('Kein Cover gefunden');
    return { coverPath: null, searchResult: null, rateLimited };
  }

  // If not confident, ask the user (if confirm callback provided)
  if (!searchResult.confident && confirm) {
    log(`Bestätigung nötig: ${searchResult.artistName} – ${searchResult.trackName}`);
    const accepted = await confirm(searchResult);
    if (!accepted) {
      log('Vom Benutzer abgelehnt');
      return { coverPath: null, searchResult, rateLimited };
    }
    log('Vom Benutzer bestätigt');
  } else if (!searchResult.confident && !confirm) {
    // No confirm callback — skip unconfident matches
    log(`⚠️ Übersprungen (unsicher): ${searchResult.artistName} – ${searchResult.trackName}`);
    return { coverPath: null, searchResult, rateLimited };
  }

  log('Bild wird heruntergeladen…');
  try {
    const imgData = await fetchUrl(searchResult.url);
    await mkdir(coverDir, { recursive: true });
    await writeFile(coverPath, imgData);
    log(`✅ Cover gespeichert (${(imgData.length / 1024).toFixed(0)} KB)`);
    return { coverPath: `/images/${AUDIO_COVERS_SUBDIR}/${coverName}`, searchResult, rateLimited };
  } catch (e) {
    log(`❌ Download fehlgeschlagen: ${(e as Error).message}`);
    return { coverPath: null, searchResult, rateLimited };
  }
}
