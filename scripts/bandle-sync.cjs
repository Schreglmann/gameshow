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
/** How long to give a stored session to produce a token before falling back to a login window. */
const SESSION_PROBE_MS = 20000;
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

/**
 * How far back the daily-planning walk looks. Bandle only publishes
 * `/v2/planning/<date>.txt` for the last few days — its own app never asks for more than
 * today, yesterday, or the day before — so a walk over the full archive returns nothing
 * for older dates. Measured: a 1449-day sweep resolved exactly the newest three. 14 days
 * leaves slack for a sync that skips a week; days older than the window were never
 * captured and are simply unrecoverable, which is why `folder` stays the fallback.
 */
const PLANNING_LOOKBACK_DAYS = 14;
const PLANNING_CACHE = path.join(AUDIO_BASE, '.planning-dates.json');

/** UTC `YYYY-MM-DD` for a Date, the key format bandle's planning files use. */
function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function loadPlanningCache() {
  try { return JSON.parse(fs.readFileSync(PLANNING_CACHE, 'utf8')); }
  catch { return {}; }
}

function savePlanningCache(cache) {
  fs.mkdirSync(AUDIO_BASE, { recursive: true });
  fs.writeFileSync(PLANNING_CACHE, JSON.stringify(cache, null, 2) + '\n');
}

/**
 * Days within the lookback window ending at `todayIso` that the planning cache has no
 * answer for. A cached `null` (the day resolved but named no song) counts as answered, so
 * a daily sync asks for one date and a weekly one for seven.
 */
function pendingPlanningDates(todayIso, cache, lookbackDays = PLANNING_LOOKBACK_DAYS) {
  const out = [];
  const end = new Date(`${todayIso}T00:00:00Z`);
  const day = new Date(end);
  day.setUTCDate(day.getUTCDate() - (lookbackDays - 1));
  while (day <= end) {
    const iso = isoDay(day);
    if (!(iso in cache)) out.push(iso);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

/**
 * Invert the planning cache (date → song path) into song path → **earliest** date it ran.
 * Bandle re-runs songs, and the first airing is the one that means "added".
 */
function earliestDateByPath(cache) {
  const out = new Map();
  for (const [date, songPath] of Object.entries(cache)) {
    if (!songPath) continue;
    const prev = out.get(songPath);
    if (!prev || date < prev) out.set(songPath, date);
  }
  return out;
}

/**
 * Stamp `dailyDate` onto catalog entries from the planning map, writing back each entry
 * that changed. Songs that only ever appeared in a themed pack never ran as a daily and
 * keep no date — the picker falls back to their `folder` month.
 */
function applyDailyDates(catalog, dateByPath, write) {
  let n = 0;
  for (const song of catalog) {
    const date = dateByPath.get(song.path);
    if (!date || song.dailyDate === date) continue;
    song.dailyDate = date;
    write(song);
    n++;
  }
  return n;
}

function writeSongMetadata(entry) {
  const slug = toSlug(entry.song);
  const dir = path.join(AUDIO_BASE, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(entry, null, 2) + '\n');
}

/**
 * Copy `folder` from the pack listing onto catalog entries that lack it, mutating each
 * entry and writing it back. The pack fetch covers every song, new or not, so a song
 * written before the field was tracked is repaired on the next run instead of needing a
 * re-download. `folder` is bandle's own slot ("202607/Wanted" = added July 2026,
 * "_kpop/Yeobo" = themed pack only) and backs the admin picker's "Hinzugefügt" sort.
 * Returns how many entries were rewritten.
 */
function backfillFolders(catalog, remoteSongs, write) {
  const remoteByPath = new Map(remoteSongs.map(s => [s.path, s]));
  let n = 0;
  for (const song of catalog) {
    const remote = remoteByPath.get(song.path);
    if (!remote || !remote.folder || song.folder === remote.folder) continue;
    song.folder = remote.folder;
    write(song);
    n++;
  }
  return n;
}

/** Track count for a song — the 'clue' instrument carries no audio track. */
function expectedTrackCount(song) {
  return (song.instruments || []).filter(x => x !== 'clue').length || 5;
}

/**
 * Track numbers with no usable local file. Tested per file rather than per folder: a folder
 * left behind by an interrupted run holds metadata.json but no audio, and must still count
 * as incomplete. Zero-byte files are treated as absent so a truncated write is retried.
 */
function missingTracks(song) {
  const dir = path.join(AUDIO_BASE, toSlug(song.song));
  const missing = [];
  for (let n = 1; n <= expectedTrackCount(song); n++) {
    let size = 0;
    try { size = fs.statSync(path.join(dir, `track${n}.mp3`)).size; } catch { /* absent */ }
    if (size === 0) missing.push(n);
  }
  return missing;
}

/** Re-read the (possibly auto-refreshed) auth token; keeps the old one if unreadable. */
async function refreshToken(page, current) {
  try {
    const next = await page.evaluate(async () => {
      const db = await new Promise(r => { const req = indexedDB.open('firebaseLocalStorageDb'); req.onsuccess = () => r(req.result); });
      const tx = db.transaction('firebaseLocalStorage', 'readonly');
      const entry = await new Promise(r => { const req = tx.objectStore('firebaseLocalStorage').get('firebase:authUser:AIzaSyBo8HmBYfdaQCTAwp4nB-tBeuApgfeOyrg:[DEFAULT]'); req.onsuccess = () => r(req.result); });
      return entry?.value?.stsTokenManager?.accessToken;
    });
    return next || current;
  } catch { return current; }
}

async function dryRun() {
  const catalog = loadCatalog();
  const incomplete = catalog.filter(s => missingTracks(s).length > 0);
  const missingFiles = incomplete.reduce((n, s) => n + missingTracks(s).length, 0);
  console.log(`Catalog: ${catalog.length} songs`);
  console.log(`Songs with missing audio: ${incomplete.length}`);
  console.log(`Missing track files: ${missingFiles}`);
  const planned = pendingPlanningDates(isoDay(new Date()), loadPlanningCache());
  console.log(`Daily-planning dates still to fetch: ${planned.length} (last ${PLANNING_LOOKBACK_DAYS} days)`);
  console.log(`Songs with an exact daily date: ${catalog.filter(s => s.dailyDate).length}`);
}

/**
 * Playwright's bundled Chromium is only on disk if `npx playwright install` ran for the
 * exact Playwright version in node_modules — the cache is keyed by build revision, so a
 * version bump silently invalidates it. Fall back to the system Google Chrome, which needs
 * no download and handles the Apple/Google sign-in better than an unbranded Chromium.
 */
async function launchPersistent(chromium, headless) {
  const opts = { headless, args: ['--disable-blink-features=AutomationControlled'] };
  try {
    return await chromium.launchPersistentContext(BROWSER_DATA, opts);
  } catch (err) {
    if (!/Executable doesn't exist/.test(String((err && err.message) || err))) throw err;
    console.log('Bundled Chromium is not installed — using the system Google Chrome instead.');
    console.log("(run `npx playwright install chromium` if you'd rather use Playwright's own build)");
    return await chromium.launchPersistentContext(BROWSER_DATA, { ...opts, channel: 'chrome' });
  }
}

/** One read of the stored Firebase token; null when absent or expired. */
async function readToken(page) {
  try {
    return await page.evaluate(async () => {
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
  } catch { return null; }
}

/**
 * Poll for the token until `timeoutMs` elapses; `timeoutMs = 0` waits forever. Firebase
 * restores and refreshes the session asynchronously after the page loads, so even a valid
 * stored session needs a few seconds of polling before the token appears.
 */
async function waitForToken(page, timeoutMs) {
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;
  for (;;) {
    const token = await readToken(page);
    if (token) return token;
    if (Date.now() + 2000 > deadline) return null;
    await new Promise(r => setTimeout(r, 2000));
  }
}

/**
 * Get an authenticated page, showing a browser window only when one is actually needed.
 * The persistent profile usually still holds a valid session, so the first attempt runs
 * headless; a window opens only if that turns up no token and the user has to log in.
 * The headless context must be closed first — a profile directory takes one context.
 */
async function openAuthenticatedSession(chromium, { launch = launchPersistent, probeMs = SESSION_PROBE_MS } = {}) {
  let context = null;
  let page = null;
  let token = null;
  try {
    context = await launch(chromium, true);
    page = await context.newPage();
    await page.goto('https://bandle.app/menu');
    token = await waitForToken(page, probeMs);
  } catch (err) {
    // A headless launch can fail for reasons that have nothing to do with auth — no
    // headless shell installed, a locked profile directory. Fall through to the visible
    // window rather than aborting the run.
    console.log(`Headless session check failed (${(err && err.message) || err}) — opening a browser window.`);
  }

  if (token) {
    console.log('Using the stored session — no browser window needed.\n');
    return { context, page, token };
  }

  if (context) {
    console.log('No valid session stored — opening a browser window to log in...');
    // The profile directory only takes one context, so the probe has to go first.
    await context.close().catch(() => {});
  }
  context = await launch(chromium, false);
  page = await context.newPage();
  await page.goto('https://bandle.app/menu');
  console.log('Waiting for login... (log in with your Apple/Google account in the browser)');
  token = await waitForToken(page, 0);
  console.log('Authenticated!\n');
  return { context, page, token };
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    await dryRun();
    return;
  }

  const { chromium } = require('playwright');

  const { context, page, token: initialToken } = await openAuthenticatedSession(chromium);
  let token = initialToken;

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

  const backfilled = backfillFolders(catalog, remoteSongs, writeSongMetadata);
  if (backfilled > 0) console.log(`Backfilled folder for ${backfilled} existing songs`);

  // ── Daily-planning dates ──
  // `/v2/planning/<YYYY-MM-DD>.txt` is how the app picks each day's puzzle, and it is the
  // only place bandle records a *day* — the song listing carries just the `YYYYMM` folder.
  // Walking it once per date gives every daily song its exact air date; the cache sidecar
  // makes later runs fetch only the days since the last one.
  const planningCache = loadPlanningCache();
  const pendingDates = pendingPlanningDates(isoDay(new Date()), planningCache);
  if (pendingDates.length > 0) {
    console.log(`\nFetching daily planning for ${pendingDates.length} dates...`);
    const PLAN_BATCH = 250;
    for (let i = 0; i < pendingDates.length; i += PLAN_BATCH) {
      token = await refreshToken(page, token);
      const dates = pendingDates.slice(i, i + PLAN_BATCH);
      const found = await page.evaluate(async ({ dates, token }) => {
        const getUrl = window.__bandleGetSignedUrl;
        const decode = window.__bandleDecodeHex;
        const results = {};
        const CONCURRENCY = 10;
        let idx = 0;
        const run = async () => {
          while (idx < dates.length) {
            const date = dates[idx++];
            try {
              const url = await getUrl(`/v2/planning/${date}.txt`, token);
              const resp = await fetch(url);
              // 0x5B — the payload is a JSON array, same obfuscation as the pack lists.
              const songs = JSON.parse(decode(await resp.text(), 0x5B));
              // null = the day resolved but named no song; a thrown error records nothing
              // so that date is retried on the next run instead of being cached as empty.
              results[date] = songs[0]?.path || null;
            } catch { /* leave unset — retry next run */ }
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, () => run()));
        return results;
      }, { dates, token });
      Object.assign(planningCache, found);
      savePlanningCache(planningCache);
      console.log(`  ${Math.min(i + PLAN_BATCH, pendingDates.length)}/${pendingDates.length} dates (${Object.keys(found).length} resolved)`);
    }
  }
  const dated = applyDailyDates(catalog, earliestDateByPath(planningCache), writeSongMetadata);
  if (dated > 0) console.log(`Stamped dailyDate on ${dated} songs`);

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
        folder: s.folder,
      };
      writeSongMetadata(entry);
      catalog.push(entry);
    }
    console.log(`Wrote metadata for ${newSongs.length} new songs (total: ${catalog.length})`);
  }

  // ── Download audio for songs missing local files ──
  // Built after the metadata write above, so the folders it just created are already on disk —
  // hence the per-file check in missingTracks(), not a folder-existence check.
  const needsAudio = catalog
    .map(song => ({ song, tracks: missingTracks(song) }))
    .filter(x => x.tracks.length > 0);

  if (needsAudio.length === 0) {
    console.log('\nAll audio files present! Nothing to download.');
    await context.close();
    return;
  }

  const totalFiles = needsAudio.reduce((n, x) => n + x.tracks.length, 0);
  console.log(`\nDownloading audio for ${needsAudio.length} songs (${totalFiles} files)...`);
  const BATCH = 100;
  for (let i = 0; i < needsAudio.length; i += BATCH) {
    token = await refreshToken(page, token);

    const batch = needsAudio.slice(i, i + BATCH);
    const entries = batch.map(x => ({
      path: x.song.path,
      slug: toSlug(x.song.song),
      tracks: x.tracks,
    }));

    const audioData = await page.evaluate(async ({ entries, token }) => {
      const getUrl = window.__bandleGetSignedUrl;
      const results = {};
      const tasks = [];
      for (const e of entries) {
        results[e.slug] = {};
        for (const n of e.tracks) tasks.push({ slug: e.slug, n, path: e.path });
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

  const stillMissing = catalog.filter(s => missingTracks(s).length > 0);
  console.log(`\nDone! ${catalog.length} catalog entries, ${catalog.length - stillMissing.length} with complete audio`);
  if (stillMissing.length > 0) {
    console.log(`${stillMissing.length} songs still missing audio (downloads failed) — re-run to retry:`);
    for (const s of stillMissing.slice(0, 10)) console.log(`  ${toSlug(s.song)} (tracks ${missingTracks(s).join(', ')})`);
    if (stillMissing.length > 10) console.log(`  ... and ${stillMissing.length - 10} more`);
  }

  await context.close();
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = {
  backfillFolders, toSlug, isoDay, pendingPlanningDates, earliestDateByPath, applyDailyDates,
  readToken, waitForToken, openAuthenticatedSession,
};
