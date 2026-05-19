/**
 * Fetch portrait images of movie/TV characters into local-assets/images/Filmfiguren/.
 *
 * Source: Wikipedia REST summary API (en first, de as fallback) → originalimage.source
 *         on upload.wikimedia.org. Same approach as fetch-famous-people.ts.
 *
 * Filenames: "Character Name.<ext>" with original capitalization and spaces.
 * Idempotent: skips files already present.
 *
 * Usage (from repo root):
 *   npx tsx scripts/fetch-filmfiguren.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const SAVE_DIR = path.join(process.cwd(), 'local-assets', 'images', 'Filmfiguren');
const DRY_RUN = process.argv.includes('--dry-run');

const USER_AGENT =
  'Gameshow-DAM-Fetch/1.0 (https://github.com/vivid-planet/gameshow; georg.schreglmann@vivid-planet.com)';

type Entry = {
  /** filename stem (becomes "<name>.jpg") */
  name: string;
  /** override Wikipedia title (en); leave undefined to use name */
  titleEn?: string;
  /** override Wikipedia title (de); leave undefined to use name */
  titleDe?: string;
};

const CHARACTERS: Entry[] = [
  { name: 'Albus Dumbledore' },
  { name: 'Darth Vader' },
  { name: 'Gandalf' },
  { name: 'Gollum' },
  { name: 'Michael Corleone' },
  { name: 'Jenny Curran', titleEn: 'Forrest Gump' },
  { name: 'Jack Dawson', titleEn: 'Jack Dawson (Titanic)', titleDe: 'Jack Dawson' },
  { name: 'Kyle Reese' },
  { name: 'Leonidas', titleEn: '300 (film)', titleDe: '300 (Film)' },
  { name: 'Rick Blaine', titleEn: 'Rick Blaine' },
  { name: 'Alfred Pennyworth' },
  { name: 'Tony Stark', titleEn: 'Iron Man (Marvel Cinematic Universe)' },
  { name: 'Mufasa' },
  { name: 'Woody', titleEn: 'Sheriff Woody', titleDe: 'Woody (Toy Story)' },
  { name: 'Hector Barbossa' },
  { name: 'John McClane' },
  { name: 'Auric Goldfinger' },
  { name: 'Trinity', titleEn: 'Trinity (The Matrix)', titleDe: 'Figuren aus der Matrix-Trilogie' },
  { name: 'Severus Snape' },
  { name: 'Walter White', titleEn: 'Walter White (Breaking Bad)', titleDe: 'Walter White' },
  { name: 'Petyr Baelish', titleEn: 'Petyr Baelish' },
  { name: 'Tyrion Lannister' },
  { name: 'Sherlock Holmes' },
  { name: 'Ross Geller' },
  { name: 'Joey Tribbiani' },
  { name: 'Jack Torrance' },
  { name: 'Bill Kilgore' },
  { name: 'Tony Montana' },
  { name: 'Jim Lovell' },
  { name: 'Cole Sear', titleEn: 'The Sixth Sense' },
  { name: 'James T. Kirk' },
  { name: 'Rhett Butler' },
  { name: 'Dorothy Gale' },
  { name: 'Nathan Jessup', titleEn: 'A Few Good Men' },
  { name: 'John Keating', titleEn: 'Dead Poets Society' },
  { name: 'Sheldon Cooper' },
  { name: 'Homer Simpson' },
  { name: 'Michael Scott', titleEn: 'Michael Scott (The Office)' },
  { name: 'Tyler Durden' },
  { name: 'Travis Bickle' },
  { name: 'Onkel Ben', titleEn: 'Ben Parker', titleDe: 'Spider-Man (Filmreihe)' },
  { name: 'Martin Brody', titleEn: 'Jaws (film)', titleDe: 'Der weiße Hai' },
  { name: 'Boese Koenigin', titleEn: 'Evil Queen (Disney)', titleDe: 'Böse Königin (Disney)' },
  { name: 'Jack Sparrow' },
  { name: 'Dorothy Boyd', titleEn: 'Jerry Maguire' },
  { name: 'Beetlejuice', titleEn: 'Betelgeuse (Beetlejuice)', titleDe: 'Beetlejuice (Film)' },
  { name: 'Captain America', titleEn: 'Captain America', titleDe: 'Captain America' },
  { name: 'Emmett Brown' },
  { name: 'Spock' },
  { name: 'Maximus', titleEn: 'Maximus Decimus Meridius', titleDe: 'Gladiator (2000)' },
];

function extFromUrl(url: string): string {
  const p = new URL(url).pathname.toLowerCase();
  const known = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.avif'];
  for (const ext of known) {
    if (p.endsWith(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  }
  return '.jpg';
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const head = buf.subarray(0, 16);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38;
  const isWebp =
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50;
  const isAvif = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
  const headAscii = head.toString('ascii').trimStart();
  const isSvg = headAscii.startsWith('<svg') || headAscii.startsWith('<?xml');
  return isJpeg || isPng || isGif || isWebp || isAvif || isSvg;
}

type SummaryImage = { url: string; lang: 'en' | 'de'; isOriginal: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBackoff(url: string, init: RequestInit, label: string): Promise<Response> {
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : delay;
    console.log(`    ⏳ 429 on ${label}, waiting ${(wait / 1000).toFixed(1)}s (attempt ${attempt + 1}/6)`);
    await sleep(wait);
    delay = Math.min(delay * 2, 60000);
  }
  return fetch(url, init);
}

async function fetchPageImage(title: string, lang: 'en' | 'de'): Promise<SummaryImage | null> {
  const apiTitle = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${apiTitle}?redirect=true`;
  const res = await fetchWithBackoff(
    url,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'follow' },
    `summary/${lang}/${title}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
  };
  if (json.originalimage?.source) {
    return { url: json.originalimage.source, lang, isOriginal: true };
  }
  if (json.thumbnail?.source) {
    return { url: json.thumbnail.source, lang, isOriginal: false };
  }
  return null;
}

async function resolveImage(entry: Entry): Promise<SummaryImage | null> {
  const enTitle = entry.titleEn ?? entry.name;
  const deTitle = entry.titleDe ?? entry.name;
  const en = await fetchPageImage(enTitle, 'en');
  if (en?.isOriginal) return en;
  const de = await fetchPageImage(deTitle, 'de');
  if (de?.isOriginal) return de;
  return en ?? de ?? null;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetchWithBackoff(
    url,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.8' }, redirect: 'follow' },
    `download ${path.basename(new URL(url).pathname)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isImageBuffer(buf)) throw new Error('Response is not an image');
  return buf;
}

function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function existingNormalizedNames(): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(SAVE_DIR)) return names;
  for (const entry of fs.readdirSync(SAVE_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const base = path.basename(entry.name, path.extname(entry.name));
    names.add(normalizeForDedup(base));
  }
  return names;
}

async function main() {
  console.log(`🎬 Fetching ${CHARACTERS.length} movie-character portraits...\n`);

  if (!DRY_RUN) fs.mkdirSync(SAVE_DIR, { recursive: true });

  const existing = existingNormalizedNames();

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let lowRes = 0;
  const failures: string[] = [];

  let firstRealFetch = true;
  for (const entry of CHARACTERS) {
    const norm = normalizeForDedup(entry.name);

    if (existing.has(norm)) {
      console.log(`  ⤳ ${entry.name} — already in Filmfiguren/, skipped`);
      skipped++;
      continue;
    }

    try {
      if (!DRY_RUN && !firstRealFetch) await sleep(1500);
      firstRealFetch = false;
      const img = await resolveImage(entry);
      if (!img) {
        console.warn(`  ❌ ${entry.name} — no image on Wikipedia`);
        failed++;
        failures.push(entry.name);
        continue;
      }

      const ext = extFromUrl(img.url);
      const filename = `${entry.name}${ext}`;
      const outPath = path.join(SAVE_DIR, filename);

      if (DRY_RUN) {
        const tag = img.isOriginal ? 'orig' : 'thumb';
        console.log(`  🔍 ${entry.name} → ${img.lang}/${tag}: ${img.url}`);
        fetched++;
        continue;
      }

      const buf = await downloadBuffer(img.url);
      fs.writeFileSync(outPath, buf);
      const tag = img.isOriginal ? 'orig' : 'THUMB-LOWRES';
      const kb = (buf.length / 1024).toFixed(0);
      console.log(`  ✅ ${filename}  (${kb} KB, ${img.lang}/${tag})`);
      if (!img.isOriginal) lowRes++;
      fetched++;
    } catch (e) {
      const err = e as Error & { cause?: { message?: string } };
      const cause = err.cause?.message ? ` (${err.cause.message})` : '';
      console.warn(`  ❌ ${entry.name} — ${err.message}${cause}`);
      failed++;
      failures.push(entry.name);
    }
  }

  console.log(
    `\n📊 ${fetched} fetched, ${skipped} skipped, ${failed} failed, ${lowRes} low-res fallbacks`,
  );
  if (failures.length > 0) {
    console.log(`\n   Failed: ${failures.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
