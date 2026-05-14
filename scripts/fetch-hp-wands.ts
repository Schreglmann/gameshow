/**
 * Re-fetch missing wand images for `games/harry-potter-zauberstaebe.json`.
 *
 * Pre-2026-05 the folder `local-assets/images/Harry Potter/Zauberstäbe/` was
 * deleted on/around 27 Apr and never restored. The game references 21 wand
 * filenames; this script downloads a wand image for each owner from the
 * Harry Potter Fandom wiki and saves it under the expected filename.
 *
 * Pipeline per wand:
 *   1. Query `harrypotter.fandom.com/api.php?action=query&prop=pageimages&redirects=1`
 *      with the article slug to get the canonical infobox image URL on
 *      static.wikia.nocookie.net. iPhone UA bypasses Cloudflare's bot
 *      challenge that blocks /wiki/ HTML pages; the API itself is open.
 *      `redirects=1` follows wiki redirects (e.g. "Bellatrix Lestrange's
 *      wand" → "Bellatrix Lestrange's first wand").
 *   2. If the pageimage's filename doesn't look like a wand (e.g. a generic
 *      portrait when the article is a list page), scan `prop=images` for
 *      files whose title contains "wand" and pick the first.
 *   3. Download the image from the CDN (always reachable).
 *   4. Atomic write to `local-assets/images/Harry Potter/Zauberstäbe/<filename>`.
 *
 * Idempotent: skips files already present.
 *
 * Usage (from repo root):
 *   npx tsx scripts/fetch-hp-wands.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const SAVE_DIR = path.join(process.cwd(), 'local-assets', 'images', 'Harry Potter', 'Zauberstäbe');
const DRY_RUN = process.argv.includes('--dry-run');

// iPhone Safari UA — Cloudflare on harrypotter.fandom.com challenges desktop
// UAs but lets mobile browsers through to the API. The CDN at
// static.wikia.nocookie.net has no UA filtering, so any UA works for downloads.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

interface WorkItem {
  filename: string;
  /** Slug of the Fandom article to query. Follows wiki redirects. */
  article: string;
  /** Substring (case-insensitive) the image filename must contain. Used when
   *  the article's pageimage isn't the wand itself — e.g. on a list page or
   *  when the infobox shows a portrait. Defaults to "wand". */
  match?: string;
}

// Mapping derived from the game's question list (DE owner names → EN Fandom
// article slugs). Confirmed each slug exists or redirects to an article with
// a usable wand image (verified by manual API probe — see commit message).
const ITEMS: WorkItem[] = [
  { filename: 'AlastorMadEyeMoodywand.webp',     article: "Alastor Moody's wand" },
  { filename: 'Albus Dumbledore.webp',           article: 'Elder Wand', match: 'elder' },
  { filename: 'Bellatrix Lestrange.webp',        article: "Bellatrix Lestrange's wand" },
  { filename: 'Dolores_umbridge_wand.webp',      article: "Dolores Umbridge's wand" },
  { filename: 'DracoMalfoyWand.webp',            article: "Draco Malfoy's wand" },
  { filename: 'FleurDelacourWand.webp',          article: "Fleur Delacour's wand" },
  { filename: "Ginny's_wand.webp",               article: "Ginny Weasley's wand" },
  { filename: 'Harry Potter.webp',               article: "Harry Potter's wand" },
  // Snatcher / Greifer scene: Harry took Draco's hawthorn wand and used it
  // through the Snatcher chapters. Reuse Draco's wand article — it's the
  // physically same wand. Owner answer in the game is "Harry Potter
  // (Greifer-Zauberstab)" so the right image IS Draco's wand.
  { filename: 'Harry-Potter-Wand-Greifer.webp',  article: "Draco Malfoy's wand" },
  { filename: 'HermineGrangersZauberstab.webp',  article: "Hermione Granger's wand" },
  { filename: 'LordVoldemortWand.webp',          article: "Tom Riddle's wand" },
  { filename: 'Lucius_Zauberstab_+_Stock.webp',  article: "Lucius Malfoy's wand" },
  // Disambig pages — go straight to the specific wand article. Without this,
  // pageimages returns the disambig icon or a character portrait.
  { filename: "Luna's_Wand.webp",                article: "Luna Lovegood's first wand" },
  { filename: 'Narzissas_Zauberstab.webp',       article: "Narcissa Malfoy's wand" },
  { filename: "Neville's_wand.webp",             article: "Neville Longbottom's first wand" },
  { filename: 'ProfMinervaMcGonagallwand.webp',  article: "Minerva McGonagall's wand" },
  { filename: 'Ron Weasley.webp',                article: "Ronald Weasley's second wand" },
  { filename: 'Sirius_wand.webp',                article: "Sirius Black's wand" },
  { filename: "Snape's_wand.webp",               article: "Severus Snape's wand" },
  { filename: 'ViktorKrumWand.webp',             article: "Viktor Krum's wand" },
  { filename: 'Wormtail_wand.webp',              article: "Peter Pettigrew's wand" },
];

interface PageImagesResponse {
  query?: {
    pages?: Record<string, {
      title: string;
      original?: { source: string };
      missing?: string;
    }>;
  };
}

interface ImagesListResponse {
  query?: {
    pages?: Record<string, {
      images?: { ns: number; title: string }[];
      missing?: string;
    }>;
  };
}

interface ImageInfoResponse {
  query?: {
    pages?: Record<string, {
      imageinfo?: { url: string }[];
      missing?: string;
    }>;
  };
}

async function fandomApi<T>(params: Record<string, string>): Promise<T> {
  const usp = new URLSearchParams({ format: 'json', formatversion: '1', ...params });
  const url = `https://harrypotter.fandom.com/api.php?${usp}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

/** Get the canonical infobox image URL for an article (follows wiki redirects). */
async function getPageImage(title: string): Promise<{ url: string; fileTitle: string } | null> {
  const r = await fandomApi<PageImagesResponse>({
    action: 'query',
    prop: 'pageimages',
    piprop: 'original|name',
    redirects: '1',
    titles: title,
  });
  const pages = r.query?.pages ?? {};
  for (const p of Object.values(pages)) {
    if ('missing' in p) return null;
    if (p.original?.source) {
      const fileTitle = path.basename(decodeURIComponent(new URL(p.original.source).pathname).replace(/\/revision\/.*$/, ''));
      return { url: p.original.source, fileTitle };
    }
  }
  return null;
}

/** Scan the article's `images` list for a title containing the match substring. */
async function findArticleImageByMatch(title: string, match: string): Promise<string | null> {
  const r = await fandomApi<ImagesListResponse>({
    action: 'query',
    prop: 'images',
    imlimit: '100',
    redirects: '1',
    titles: title,
  });
  const pages = r.query?.pages ?? {};
  const needle = match.toLowerCase();
  for (const p of Object.values(pages)) {
    if ('missing' in p) return null;
    for (const img of p.images ?? []) {
      const t = img.title.toLowerCase();
      if (t.includes(needle)
          && !t.includes('wiki-wordmark')
          && !t.includes('wiki-background')
          && !t.includes('placeholder')
          && !t.includes('hand_pointing')) {
        return img.title;
      }
    }
  }
  return null;
}

async function resolveFileUrl(fileTitle: string): Promise<string | null> {
  const r = await fandomApi<ImageInfoResponse>({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url',
    titles: fileTitle,
  });
  const pages = r.query?.pages ?? {};
  for (const p of Object.values(pages)) {
    if ('missing' in p) return null;
    const info = p.imageinfo?.[0];
    if (info?.url) return info.url;
  }
  return null;
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const h = buf.subarray(0, 16);
  const jpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const png = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  const gif = h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38;
  const webp = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46
            && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  const avif = h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;
  return jpeg || png || gif || webp || avif;
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isImageBuffer(buf)) throw new Error(`Not an image (${buf.length} bytes)`);
  return buf;
}

function writeAtomic(dest: string, buf: Buffer): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw err;
  }
}

/** Pick the wand image for one item:
 *  1. Article's lead infobox image (pageimages.original).
 *  2. If that image's filename doesn't contain `match` (default "wand"),
 *     fall back to scanning `prop=images` for a wand-named file.
 *  This handles cases like "Luna Lovegood's wands" where the lead image is
 *  a portrait rather than the wand itself. */
async function resolveItem(item: WorkItem): Promise<{ url: string; via: string } | null> {
  const match = (item.match ?? 'wand').toLowerCase();
  const lead = await getPageImage(item.article);
  if (lead && lead.fileTitle.toLowerCase().includes(match)) {
    return { url: lead.url, via: `pageimage (${lead.fileTitle})` };
  }
  const altTitle = await findArticleImageByMatch(item.article, match);
  if (altTitle) {
    const url = await resolveFileUrl(altTitle);
    if (url) return { url, via: `images-scan (${altTitle})` };
  }
  // Last resort: lead image even if it didn't match
  if (lead) return { url: lead.url, via: `pageimage-fallback (${lead.fileTitle})` };
  return null;
}

async function main() {
  console.log(`🪄 Restoring ${ITEMS.length} wand image(s) from harrypotter.fandom.com`);
  if (DRY_RUN) console.log('(dry-run: no files will be written)');
  console.log('');

  let fetched = 0;
  let skipped = 0;
  const missing: WorkItem[] = [];

  for (const item of ITEMS) {
    const dest = path.join(SAVE_DIR, item.filename);
    if (fs.existsSync(dest)) {
      console.log(`  • ${item.filename} → already present, skip`);
      skipped++;
      continue;
    }

    console.log(`  • ${item.filename}`);
    console.log(`      article: "${item.article}"`);

    let resolved: { url: string; via: string } | null;
    try {
      resolved = await resolveItem(item);
    } catch (err) {
      console.log(`      ✗ API failed: ${(err as Error).message}`);
      missing.push(item);
      continue;
    }
    if (!resolved) {
      console.log(`      ✗ no image found`);
      missing.push(item);
      continue;
    }
    console.log(`      → ${resolved.via}`);

    if (DRY_RUN) {
      console.log(`      ✓ would download: ${resolved.url}`);
      continue;
    }

    let buf: Buffer;
    try {
      buf = await downloadImage(resolved.url);
    } catch (err) {
      console.log(`      ✗ download failed: ${(err as Error).message}`);
      missing.push(item);
      continue;
    }
    writeAtomic(dest, buf);
    console.log(`      ✓ saved ${buf.length} bytes`);
    fetched++;
  }

  console.log('');
  console.log(`Summary: ${fetched} fetched | ${skipped} already-present | ${missing.length} missing`);
  if (missing.length > 0) {
    console.log('Missing:');
    for (const m of missing) console.log(`  - ${m.filename}  (article: ${m.article})`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
