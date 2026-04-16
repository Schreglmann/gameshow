/**
 * Fetch movie poster images for all video files.
 * Saves posters to images/movie-posters/{slug}.jpg
 *
 * Usage:
 *   npx tsx fetch-movie-posters.ts [--dry-run]
 *
 * Uses IMDb (free, no API key) by default.
 * For higher quality, set your free TMDB API key:
 *   TMDB_API_KEY=your_key npx tsx fetch-movie-posters.ts
 */

import fs from 'fs';
import path from 'path';
import { videoFilenameToSlug, fetchPosterUrl, fetchUrl } from './server/movie-posters.js';

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(process.cwd(), 'local-assets');
const POSTER_SAVE_DIR = path.join(process.cwd(), 'images', 'movie-posters');
const DRY_RUN = process.argv.includes('--dry-run');

function isNasMounted(): boolean {
  try {
    return fs.statSync(NAS_BASE).isDirectory();
  } catch {
    return false;
  }
}

function listVideoFiles(baseDir: string): string[] {
  const videosDir = path.join(baseDir, 'videos');
  if (!fs.existsSync(videosDir)) return [];
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.isFile()) results.push(entry.name);
    }
  }
  walk(videosDir);
  return results;
}

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

async function main() {
  console.log('🎬 Fetching movie poster images...\n');

  if (!process.env.TMDB_API_KEY) {
    console.log('ℹ  TMDB_API_KEY not set — using IMDb for poster images (free, no key needed).\n');
  }

  const nasVideos = isNasMounted() ? listVideoFiles(NAS_BASE) : [];
  const localVideos = listVideoFiles(LOCAL_BASE);
  const allFilenames = [...new Set([...nasVideos, ...localVideos])];

  if (allFilenames.length === 0) {
    console.log('No video files found in local-assets/videos/ or NAS.');
    return;
  }
  console.log(`Found ${allFilenames.length} video file(s).\n`);

  if (!DRY_RUN) {
    fs.mkdirSync(POSTER_SAVE_DIR, { recursive: true });
  }

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const filename of allFilenames) {
    const slug = videoFilenameToSlug(filename);
    if (!slug) {
      console.log(`  – ${filename}: could not derive slug, skipped`);
      continue;
    }

    const posterPath = path.join(POSTER_SAVE_DIR, `${slug}.jpg`);

    if (fs.existsSync(posterPath)) {
      console.log(`  ✓ Already exists: ${slug}.jpg`);
      skipped++;
      continue;
    }

    const movieName = filenameToMovieName(filename);
    console.log(`  🔍 ${filename}  →  "${movieName}"  →  ${slug}.jpg`);

    if (DRY_RUN) {
      fetched++;
      continue;
    }

    const posterUrl = await fetchPosterUrl(movieName);
    if (!posterUrl) {
      console.warn(`    ❌ No poster found`);
      failed++;
    } else {
      try {
        const imgData = await fetchUrl(posterUrl);
        fs.writeFileSync(posterPath, imgData);
        console.log(`    ✅ Saved (${(imgData.length / 1024).toFixed(0)} KB)`);
        fetched++;
      } catch (e) {
        console.warn(`    ❌ Download failed: ${(e as Error).message}`);
        failed++;
      }
    }

  }

  console.log(`\n📊 Summary: ${fetched} fetched, ${skipped} already existed, ${failed} failed`);
}

main().catch(console.error);
