#!/usr/bin/env node
/**
 * Bandle Sync — Open browser, wait for login, fetch new songs & download audio
 *
 * Usage:
 *   npm run bandle-sync            # open browser, login, sync everything
 *   npm run bandle-sync -- --dry-run   # just show status, no browser
 */

const fs = require('fs');
const path = require('path');

const AUDIO_BASE = path.join(__dirname, '..', 'local-assets', 'audio', 'bandle');
const BROWSER_DATA = path.join(__dirname, '..', '.bandle-browser-data');

function toSlug(name) {
  return name
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*ft\..*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function loadCatalog() {
  if (!fs.existsSync(AUDIO_BASE)) return [];
  const entries = fs.readdirSync(AUDIO_BASE, { withFileTypes: true });
  const catalog = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(AUDIO_BASE, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try { catalog.push(JSON.parse(fs.readFileSync(metaPath, 'utf8'))); }
    catch { /* skip malformed */ }
  }
  return catalog;
}

function writeSongMetadata(entry) {
  const slug = toSlug(entry.song);
  const dir = path.join(AUDIO_BASE, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(entry, null, 2) + '\n');
}

function getDownloadedSlugs() {
  if (!fs.existsSync(AUDIO_BASE)) return new Set();
  return new Set(
    fs.readdirSync(AUDIO_BASE).filter(d => fs.statSync(path.join(AUDIO_BASE, d)).isDirectory())
  );
}

async function dryRun() {
  const catalog = loadCatalog();
  const slugs = getDownloadedSlugs();
  let missing = 0;
  for (const s of catalog) {
    if (!slugs.has(toSlug(s.song))) missing++;
  }
  console.log(`Catalog: ${catalog.length} songs`);
  console.log(`Audio folders: ${slugs.size}`);
  console.log(`Songs without local audio: ${missing}`);
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    await dryRun();
    return;
  }

  const { chromium } = require('playwright');

  console.log('Launching browser...');
  const context = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await context.newPage();
  await page.goto('https://bandle.app/menu');

  // Wait for Firebase auth token to appear in IndexedDB
  console.log('Waiting for login... (log in with your Apple/Google account in the browser)');

  let token = null;
  while (!token) {
    try {
      token = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('firebaseLocalStorageDb');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const entry = await new Promise((resolve) => {
          const req = tx.objectStore('firebaseLocalStorage').get(
            'firebase:authUser:AIzaSyBo8HmBYfdaQCTAwp4nB-tBeuApgfeOyrg:[DEFAULT]'
          );
          req.onsuccess = () => resolve(req.result);
        });
        const t = entry?.value?.stsTokenManager?.accessToken;
        const exp = entry?.value?.stsTokenManager?.expirationTime;
        if (t && exp > Date.now()) return t;
        return null;
      });
    } catch {}
    if (!token) await new Promise(r => setTimeout(r, 2000));
  }
  console.log('Authenticated!\n');

  // ── Inject helpers into page ──
  await page.evaluate(() => {
    window.__bandleGetSignedUrl = async (file, token) => {
      const resp = await fetch(
        `https://us-central1-bandle-358421.cloudfunctions.net/getSignedUrl?file=${encodeURIComponent(file)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return (await resp.json()).url;
    };
    window.__bandleDecodeHex = (hex, expectedFirst) => {
      const firstByte = parseInt(hex.substr(0, 2), 16);
      const key = firstByte ^ expectedFirst;
      let s = '';
      for (let i = 0; i < hex.length; i += 2)
        s += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
      return s;
    };
  });

  // ── Fetch all pack songs ──
  console.log('Fetching song catalog from bandle packs...');
  const remoteSongs = await page.evaluate(async (token) => {
    const getUrl = window.__bandleGetSignedUrl;
    const decode = window.__bandleDecodeHex;
    const packs = [
      '2010', '2000', '1990', '1980', '1970',
      'movie', 'series', 'disney', 'game', 'game2', 'anime', 'musicals',
      'emo', 'metal', 'indie', 'rap', 'alt', 'country', 'rock60', 'rock80', 'rnb', 'dance',
      'one', 'band', 'eurovision', 'love', 'christmas', 'hard', 'euro', 'spain', 'kpop', 'french', 'brazil',
      'free1', 'free2', 'free3', 'free4', 'free5',
    ];
    const titles = {
      '2010': '2010er', '2000': '2000er', '1990': '90er', '1980': '80er', '1970': '70er',
      movie: 'Filmmusik', series: 'TV-Serien', disney: 'Disney', game: 'Videospiel 2',
      game2: 'Videospiel 1', anime: 'Anime', musicals: 'Musical',
      emo: 'Emo/Pop-Punk', metal: 'Metal', indie: 'Indie', rap: 'Rap/Hip-Hop',
      alt: 'Alternative', country: 'Country', rock60: 'Vintage Rock', rock80: 'Arena Rock',
      rnb: 'R&B/Soul/Funk', dance: 'Eurodance', one: 'One-Hit-Wonders',
      band: 'Girl/Boygroups', eurovision: 'Eurovision', love: 'Love Songs',
      christmas: 'Weihnachten', hard: 'Experten', euro: 'EU Charts',
      spain: 'Spanisch', kpop: 'K-Pop', french: 'Französisch',
      brazil: 'Brasilianisch', free1: 'Gratis', free2: 'Gratis', free3: 'Gratis',
      free4: 'Gratis', free5: 'Gratis',
    };
    const map = new Map();
    for (const name of packs) {
      try {
        const url = await getUrl(`/v2/packs/songs/${name}.txt`, token);
        const resp = await fetch(url);
        const songs = JSON.parse(decode(await resp.text(), 0x5B));
        for (const s of songs) {
          if (!map.has(s.path)) map.set(s.path, { ...s, packs: [titles[name] || name] });
          else map.get(s.path).packs.push(titles[name] || name);
        }
      } catch {}
    }
    return Array.from(map.values());
  }, token);

  console.log(`Remote: ${remoteSongs.length} songs`);

  const catalog = loadCatalog();
  const existingPaths = new Set(catalog.map(s => s.path));
  const newSongs = remoteSongs.filter(s => !existingPaths.has(s.path));
  console.log(`New songs: ${newSongs.length}`);

  // ── Fetch details for new songs ──
  if (newSongs.length > 0) {
    console.log(`Fetching details for ${newSongs.length} new songs...`);
    const newPaths = newSongs.map(s => s.path);
    const details = await page.evaluate(async ({ paths, token }) => {
      const getUrl = window.__bandleGetSignedUrl;
      const decode = window.__bandleDecodeHex;
      const results = {};
      const CONCURRENCY = 20;
      let idx = 0;
      const run = async () => {
        while (idx < paths.length) {
          const p = paths[idx++];
          try {
            const url = await getUrl(`/v2/details/${p}.txt`, token);
            const resp = await fetch(url);
            results[p] = JSON.parse(decode(await resp.text(), 0x7B));
          } catch { results[p] = null; }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => run()));
      return results;
    }, { paths: newPaths, token });

    for (const s of newSongs) {
      const d = details[s.path];
      if (d) {
        s.instruments = d.instruments || [];
        s.bpm = d.bpm;
        s.youtube = d.youtube;
        s.spotifyId = d.spotifyId;
        s.stream = d.stream;
        s.frontperson = d.frontperson;
        s.sources = d.sources;
        s.clue = d.clue?.de || undefined;
      } else {
        s.instruments = [];
      }
      const entry = {
        path: s.path, song: s.song, year: s.year, par: s.par, view: s.view,
        genre: s.genre, packs: s.packs, instruments: s.instruments,
        clue: s.clue, bpm: s.bpm, youtube: s.youtube, spotifyId: s.spotifyId,
        stream: s.stream, frontperson: s.frontperson, sources: s.sources,
      };
      writeSongMetadata(entry);
      catalog.push(entry);
    }
    console.log(`Wrote metadata for ${newSongs.length} new songs (total: ${catalog.length})`);
  }

  // ── Download audio for songs missing local files ──
  const existingSlugs = getDownloadedSlugs();
  const needsAudio = catalog.filter(s => !existingSlugs.has(toSlug(s.song)));

  if (needsAudio.length === 0) {
    console.log('\nAll audio files present! Nothing to download.');
    await context.close();
    return;
  }

  console.log(`\nDownloading audio for ${needsAudio.length} songs...`);
  const BATCH = 100;
  for (let i = 0; i < needsAudio.length; i += BATCH) {
    // Refresh token (may have auto-refreshed)
    try {
      token = await page.evaluate(async () => {
        const db = await new Promise(r => { const req = indexedDB.open('firebaseLocalStorageDb'); req.onsuccess = () => r(req.result); });
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const entry = await new Promise(r => { const req = tx.objectStore('firebaseLocalStorage').get('firebase:authUser:AIzaSyBo8HmBYfdaQCTAwp4nB-tBeuApgfeOyrg:[DEFAULT]'); req.onsuccess = () => r(req.result); });
        return entry?.value?.stsTokenManager?.accessToken;
      });
    } catch {}

    const batch = needsAudio.slice(i, i + BATCH);
    const entries = batch.map(s => {
      const trackCount = (s.instruments || []).filter(x => x !== 'clue').length || 5;
      return { path: s.path, slug: toSlug(s.song), trackCount };
    });

    const audioData = await page.evaluate(async ({ entries, token }) => {
      const getUrl = window.__bandleGetSignedUrl;
      const results = {};
      const tasks = [];
      for (const e of entries) {
        results[e.slug] = {};
        for (let n = 1; n <= e.trackCount; n++) tasks.push({ slug: e.slug, n, path: e.path });
      }
      const CONCURRENCY = 20;
      let idx = 0;
      const run = async () => {
        while (idx < tasks.length) {
          const t = tasks[idx++];
          try {
            const url = await getUrl(`/v2/files/${t.path}/${t.n}.mp3`, token);
            const resp = await fetch(url);
            const blob = await resp.blob();
            const b64 = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(blob);
            });
            results[t.slug][t.n] = b64;
          } catch { results[t.slug][t.n] = null; }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => run()));
      return results;
    }, { entries, token });

    // Decode and save to disk
    let saved = 0;
    for (const [slug, tracks] of Object.entries(audioData)) {
      const dir = path.join(AUDIO_BASE, slug);
      fs.mkdirSync(dir, { recursive: true });
      for (const [num, b64] of Object.entries(tracks)) {
        if (!b64) continue;
        fs.writeFileSync(path.join(dir, `track${num}.mp3`), Buffer.from(b64, 'base64'));
        saved++;
      }
    }
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} songs, ${saved} files saved`);
  }

  const finalCount = fs.readdirSync(AUDIO_BASE).filter(d => fs.statSync(path.join(AUDIO_BASE, d)).isDirectory()).length;
  console.log(`\nDone! Total: ${catalog.length} catalog entries, ${finalCount} audio folders`);

  await context.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
