/**
 * Fetch album cover images for all audio files used in game JSONs.
 * Uses iTunes Search API to find cover art by song/artist names derived from filenames.
 * Saves covers to /images/audio-covers/ and updates game JSON files with answerImage references.
 *
 * Usage: npx tsx fetch-audio-covers.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const COVER_DIR = path.join(process.cwd(), 'images', 'Audio-Covers');
const GAMES_DIR = path.join(process.cwd(), 'games');
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': 'GameshowCoverFetcher/1.0 (audio cover art)' },
    };
    client.get(options, (res) => {
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

async function searchItunesWithRetry(query: string, maxRetries = 3): Promise<string | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await searchItunes(query);
    if (result !== 'RATE_LIMITED') return result;
    const backoff = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s
    console.log(`    ⏳ Rate limited, waiting ${backoff / 1000}s before retry...`);
    await sleep(backoff);
  }
  return null;
}

async function searchItunes(query: string): Promise<string | null | 'RATE_LIMITED'> {
  const encoded = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=3`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString());
    if (data.resultCount > 0) {
      const artwork = data.results[0].artworkUrl100;
      return artwork?.replace('100x100bb', '600x600bb') ?? null;
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('403') || msg.includes('429')) {
      return 'RATE_LIMITED';
    }
    console.warn(`  ⚠ iTunes search failed for "${query}":`, msg);
  }
  return null;
}

async function searchMusicBrainz(query: string): Promise<string | null> {
  const encoded = encodeURIComponent(query);
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encoded}&limit=3&fmt=json`;
  try {
    const buf = await fetchUrl(url);
    const data = JSON.parse(buf.toString());
    if (data.recordings?.length > 0) {
      // Walk recordings looking for one with a release that has cover art
      for (const rec of data.recordings) {
        for (const rel of rec.releases ?? []) {
          const mbid = rel.id;
          try {
            const coverBuf = await fetchUrl(`https://coverartarchive.org/release/${mbid}`);
            const coverData = JSON.parse(coverBuf.toString());
            const front = coverData.images?.find((img: any) => img.front);
            if (front?.thumbnails?.['500'] || front?.thumbnails?.large || front?.image) {
              return front.thumbnails?.['500'] ?? front.thumbnails?.large ?? front.image;
            }
          } catch {
            // No cover art for this release, try next
            continue;
          }
        }
      }
    }
  } catch (e) {
    console.warn(`  ⚠ MusicBrainz search failed for "${query}":`, (e as Error).message);
  }
  return null;
}

async function searchCover(query: string): Promise<string | null> {
  // Try iTunes first, fall back to MusicBrainz
  const itunesResult = await searchItunes(query);
  if (itunesResult && itunesResult !== 'RATE_LIMITED') return itunesResult;
  if (itunesResult === 'RATE_LIMITED') {
    console.log(`    ⏳ iTunes rate-limited, trying MusicBrainz...`);
  }
  // MusicBrainz requires a User-Agent, handled by fetchUrl headers
  const mbResult = await searchMusicBrainz(query);
  if (mbResult) return mbResult;
  return null;
}

// Derive a search query from audio filename
function filenameToSearchQuery(filename: string): string {
  // Remove path prefix, extension, and encoding info
  let name = path.basename(filename, path.extname(filename));

  // audio-guess format: "Artist - Song (quality info)" → "Artist Song"
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

// Build a slug from the audio path for the cover image filename
function audioPathToSlug(audioPath: string): string {
  const basename = path.basename(audioPath, path.extname(audioPath));
  return basename
    .toLowerCase()
    .replace(/\((?:128kbit_aac|152kbit_opus)\)/gi, '')
    .replace(/\(official.*?\)/gi, '')
    .replace(/\(lyrics\)/gi, '')
    .replace(/\(remix!\)/gi, '')
    .replace(/\(video\)/gi, '')
    .replace(/\(2012 remaster\)/gi, '')
    .replace(/\[.*?\]/gi, '')
    .replace(/m⁄v/gi, '')
    .replace(/ - rednexmusic com/gi, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

// ─── Collect all audio references from game JSONs ──────────────────────────────

interface AudioRef {
  gameFile: string;
  instanceKey: string;
  questionIndex: number;
  audioPath: string;
  answer: string;
  field: 'answerAudio' | 'questionAudio' | 'audio';
  hasAnswerImage: boolean;
}

function collectAudioRefs(): AudioRef[] {
  const refs: AudioRef[] = [];
  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_template'));

  for (const file of files) {
    const filePath = path.join(GAMES_DIR, file);
    const game = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Only process simple-quiz and audio-guess types
    if (game.type !== 'simple-quiz' && game.type !== 'audio-guess') continue;

    const processQuestions = (questions: any[], instanceKey: string) => {
      questions.forEach((q: any, i: number) => {
        const audioPath = q.answerAudio || q.questionAudio || q.audio;
        if (!audioPath) return;

        // Skip soundtrack/movie audio — those already have movie-covers
        if (audioPath.includes('soundtracks/')) return;

        refs.push({
          gameFile: file,
          instanceKey,
          questionIndex: i,
          audioPath,
          answer: q.answer || '',
          field: q.answerAudio ? 'answerAudio' : q.questionAudio ? 'questionAudio' : 'audio',
          hasAnswerImage: !!q.answerImage,
        });
      });
    };

    if (game.instances) {
      for (const [key, instance] of Object.entries(game.instances as Record<string, any>)) {
        if (key === 'template') continue;
        if (instance.questions) processQuestions(instance.questions, key);
      }
    } else if (game.questions) {
      processQuestions(game.questions, '');
    }
  }
  return refs;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎵 Fetching audio cover images...\n');

  // Ensure output directory exists
  if (!DRY_RUN) {
    fs.mkdirSync(COVER_DIR, { recursive: true });
  }

  const refs = collectAudioRefs();
  console.log(`Found ${refs.length} audio references across game files.\n`);

  // Deduplicate by audio path — same audio file might appear in multiple games
  const uniqueAudio = new Map<string, { answer: string; refs: AudioRef[] }>();
  for (const ref of refs) {
    // Normalize the audio path (some use leading /, some don't)
    const normalized = ref.audioPath.replace(/^\//, '');
    if (!uniqueAudio.has(normalized)) {
      uniqueAudio.set(normalized, { answer: ref.answer, refs: [ref] });
    } else {
      uniqueAudio.get(normalized)!.refs.push(ref);
    }
  }

  console.log(`${uniqueAudio.size} unique audio files to fetch covers for.\n`);

  // Track results for JSON updates
  const coverMap = new Map<string, string>(); // normalized audio path → cover image path
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const [audioPath, { answer, refs: audioRefs }] of uniqueAudio) {
    const slug = audioPathToSlug(audioPath);
    const coverFilename = `${slug}.jpg`;
    const coverPath = path.join(COVER_DIR, coverFilename);
    const coverRelPath = `/images/Audio-Covers/${coverFilename}`;

    // Check if cover already exists
    if (fs.existsSync(coverPath)) {
      console.log(`  ✓ Already exists: ${coverFilename}`);
      coverMap.set(audioPath, coverRelPath);
      skipped++;
      continue;
    }

    // Build search query - prefer answer field (has "Song - Artist"), fallback to filename
    let searchQuery: string;
    if (answer && answer.includes('=>')) {
      // Format: "translated text => Song Name, Artist" — take part after =>
      searchQuery = answer.split('=>')[1]?.trim() ?? filenameToSearchQuery(audioPath);
      searchQuery = searchQuery.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (answer && /\(.*[–—-].*\)/.test(answer)) {
      // Format: "Hurt me (What is love – Haddaway)" — extract from parens
      const match = answer.match(/\(([^)]+)\)/);
      searchQuery = match ? match[1].replace(/[–—]/g, '-').trim() : filenameToSearchQuery(audioPath);
    } else if (answer && (answer.includes(' - ') || answer.includes(' — '))) {
      // Format: "Song - Artist" — use as-is
      searchQuery = answer.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      searchQuery = filenameToSearchQuery(audioPath);
    }

    console.log(`  🔍 Searching: "${searchQuery}" → ${coverFilename}`);

    if (DRY_RUN) {
      coverMap.set(audioPath, coverRelPath);
      fetched++;
      continue;
    }

    const artworkUrl = await searchCover(searchQuery);
    if (!artworkUrl) {
      // Try with just the filename as fallback
      const fallbackQuery = filenameToSearchQuery(audioPath);
      if (fallbackQuery !== searchQuery) {
        console.log(`    ↻ Retrying with filename: "${fallbackQuery}"`);
        const fallbackUrl = await searchCover(fallbackQuery);
        if (fallbackUrl) {
          try {
            const imgData = await fetchUrl(fallbackUrl);
            fs.writeFileSync(coverPath, imgData);
            console.log(`    ✅ Saved: ${coverFilename} (${(imgData.length / 1024).toFixed(0)} KB)`);
            coverMap.set(audioPath, coverRelPath);
            fetched++;
          } catch (e) {
            console.warn(`    ❌ Download failed: ${(e as Error).message}`);
            failed++;
          }
        } else {
          console.warn(`    ❌ No cover found`);
          failed++;
        }
      } else {
        console.warn(`    ❌ No cover found`);
        failed++;
      }
    } else {
      try {
        const imgData = await fetchUrl(artworkUrl);
        fs.writeFileSync(coverPath, imgData);
        console.log(`    ✅ Saved: ${coverFilename} (${(imgData.length / 1024).toFixed(0)} KB)`);
        coverMap.set(audioPath, coverRelPath);
        fetched++;
      } catch (e) {
        console.warn(`    ❌ Download failed: ${(e as Error).message}`);
        failed++;
      }
    }

    // Rate limit: 1 req/sec for MusicBrainz, ~20/min for iTunes
    await sleep(1500);
  }

  console.log(`\n📊 Summary: ${fetched} fetched, ${skipped} already existed, ${failed} failed\n`);

  // ─── Update game JSON files ────────────────────────────────────────────────

  if (DRY_RUN) {
    console.log('🔸 Dry run — not updating JSON files.\n');
    console.log('Would update these files:');
    const fileSet = new Set(refs.map(r => r.gameFile));
    for (const f of fileSet) console.log(`  - ${f}`);
    return;
  }

  console.log('📝 Updating game JSON files with answerImage references...\n');

  // Group refs by game file
  const byFile = new Map<string, AudioRef[]>();
  for (const ref of refs) {
    if (!byFile.has(ref.gameFile)) byFile.set(ref.gameFile, []);
    byFile.get(ref.gameFile)!.push(ref);
  }

  let updatedFiles = 0;
  for (const [file, fileRefs] of byFile) {
    const filePath = path.join(GAMES_DIR, file);
    const game = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let changed = false;

    for (const ref of fileRefs) {
      const normalized = ref.audioPath.replace(/^\//, '');
      const coverPath = coverMap.get(normalized);
      if (!coverPath) continue;

      let questions: any[];
      if (game.instances && ref.instanceKey) {
        questions = game.instances[ref.instanceKey]?.questions;
      } else {
        questions = game.questions;
      }
      if (!questions || !questions[ref.questionIndex]) continue;

      const q = questions[ref.questionIndex];
      // Skip if already has an answerImage that's not the placeholder
      if (q.answerImage && !q.answerImage.includes('Alan_Turing')) continue;

      q.answerImage = coverPath;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(game, null, 4) + '\n');
      console.log(`  ✓ Updated: ${file}`);
      updatedFiles++;
    }
  }

  console.log(`\n✅ Done! Updated ${updatedFiles} game file(s).`);
}

main().catch(console.error);
