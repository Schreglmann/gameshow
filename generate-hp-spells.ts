/**
 * Generate the Harry Potter spells `archive` instance from cached Whisper transcripts.
 *
 * Reads the JSON transcripts produced by the admin Whisper transcription feature (one per
 * movie, cached at local-assets/videos/.whisper-cache/<slug>__<lang>.json), runs the fuzzy
 * spell matcher against each, and writes one VideoGuessQuestion per detected spell to
 * games/harry-potter-spells.json → instances.archive.questions. Leaves instances.v1
 * untouched.
 *
 * Usage:
 *   npm run generate:hp-spells                       # all movies, write archive
 *   npm run generate:hp-spells -- --movie 5          # only movie 5 (replaces those entries)
 *   npm run generate:hp-spells -- --dry-run          # report only, no write
 *   npm run generate:hp-spells -- --verbose          # also log low-confidence matches
 *
 * For movies whose transcript is missing (because the operator hasn't run the admin
 * transcription yet — e.g. movie 5, "Orden des Phönix", which isn't in the DAM), placeholder
 * entries are emitted with `disabled: true` so the gap is visible. Re-run with --movie N
 * after the user transcribes the missing one.
 *
 * Approximate timestamp policy (Whisper word-level timestamps drift ±0.5-1s; the admin
 * marker editor is the place to refine entries promoted to v1):
 *   videoStart       = max(0, wordStart - 4.0)        // 4s of scene context
 *   videoQuestionEnd = wordStart - 0.3                // pause just before the spell
 *   videoAnswerEnd   = wordEnd + 3.0                  // covers visual effect
 *
 * audioTrack is hard-set to 0 in every emitted entry — first audio stream = German dub for
 * all 8 BluRay 4K movies, which is what the show plays. Transcription used the English
 * track (cleaner Whisper input); timestamps are absolute to the video so this works.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { findSpells, type SpellEntry, type WhisperWord, type SpellMatch } from './scripts/lib/whisper-match.js';

const ROOT_DIR = process.cwd();
const BAR_WIDTH = 28;
const IS_TTY = Boolean(process.stdout.isTTY);
const GAMES_FILE = path.join(ROOT_DIR, 'games', 'harry-potter-spells.json');
const DICT_FILE = path.join(ROOT_DIR, 'scripts', 'hp-spells-dictionary.json');
const REVIEW_LOG = path.join(ROOT_DIR, 'scripts', 'hp-spells-review.log');
const CACHE_BASE = path.join(ROOT_DIR, 'local-assets', 'videos', '.whisper-cache');
/** Fingerprint file — records every (video, canonical spell, start time) the generator
 *  has ever suggested, whether or not it's still in the archive. Lets repeated runs
 *  preserve user curation (deletions, disabled flips, manual edits) by distinguishing
 *  "never-before-suggested" (add to archive) from "suggested-before-but-deleted" (leave
 *  alone). Lives beside the game file so `npm run sync:push` carries it. */
const FINGERPRINT_FILE = path.join(ROOT_DIR, 'games', 'harry-potter-spells.fingerprints.json');
/** Tolerance for matching a new candidate to an existing fingerprint / archive entry.
 *  Whisper word-level timestamps drift ±0.5-1s across re-transcriptions; 15s is comfortably
 *  wider than that but narrow enough that two legitimate casts in the same scene stay
 *  distinct. */
const FP_TOLERANCE_SEC = 15;

// Mirror server/index.ts cacheSlug exactly so we find the right transcript file.
// macOS (APFS/HFS+) stores filenames in NFD (decomposed Unicode), so the server's
// cacheSlug receives NFD input from the filesystem. We must normalise to NFD here too,
// otherwise composed characters like ö (U+00F6) become a single "_" instead of "o_"
// (base letter + replaced combining diaeresis), and the lookup misses movies 5/7/8.
function cacheSlug(relPath: string): string {
  return relPath.normalize('NFD').replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface Movie {
  /** Movie number 1-8 (chronological release order) */
  index: number;
  /** Filename inside local-assets/videos/ — the JSON's `video` field will be `/videos/${file}` */
  file: string;
}

const MOVIES: Movie[] = [
  { index: 1, file: 'Harry Potter und der Stein der Weisen.m4v' },
  { index: 2, file: 'Harry Potter und die Kammer des Schreckens.m4v' },
  { index: 3, file: 'Harry Potter und der Gefangene von Askaban.m4v' },
  { index: 4, file: 'Harry Potter und der Feuerkelch.m4v' },
  { index: 5, file: 'Harry Potter und der Orden des Phönix.m4v' },
  { index: 6, file: 'Harry Potter und der Halbblutprinz.m4v' },
  { index: 7, file: 'Harry Potter und die Heiligtümer des Todes Teil 1.m4v' },
  { index: 8, file: 'Harry Potter und die Heiligtümer des Todes Teil 2.m4v' },
];

interface Args {
  movieFilter: number | null;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { movieFilter: null, dryRun: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--movie' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (n >= 1 && n <= 8) out.movieFilter = n;
    } else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
  }
  return out;
}

interface VideoGuessQuestion {
  answer: string;
  video: string;
  audioTrack?: number;
  videoStart?: number;
  videoQuestionEnd?: number;
  videoAnswerEnd?: number;
  disabled?: boolean;
}

interface WhisperTranscript {
  // whisper-cli with `-ml 1 -oj` produces a JSON shape something like:
  //   { transcription: [{ offsets: { from, to }, text: "..." }, ...] }
  // BUT older/newer whisper.cpp versions vary. We accept several shapes and normalise.
  transcription?: Array<{
    offsets?: { from: number; to: number };  // milliseconds
    timestamps?: { from: string; to: string };  // "HH:MM:SS,ms"
    text?: string;
  }>;
  segments?: Array<{
    start?: number;     // seconds
    end?: number;
    text?: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
}

/** Parse "HH:MM:SS,ms" or "HH:MM:SS.ms" → seconds. */
function parseTimestamp(s: string): number {
  const m = /(\d+):(\d+):(\d+)[.,](\d+)/.exec(s);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

/** Coerce any of the known whisper-cli JSON shapes into a flat WhisperWord[] list. */
function flattenTranscript(t: WhisperTranscript): WhisperWord[] {
  const words: WhisperWord[] = [];

  // Shape 1: -ml 1 + -oj from recent whisper-cli — `transcription[].offsets` (ms) + `text`
  if (Array.isArray(t.transcription)) {
    for (const seg of t.transcription) {
      const text = (seg.text || '').trim();
      if (!text) continue;
      let start = 0, end = 0;
      if (seg.offsets) {
        start = seg.offsets.from / 1000;
        end = seg.offsets.to / 1000;
      } else if (seg.timestamps) {
        start = parseTimestamp(seg.timestamps.from);
        end = parseTimestamp(seg.timestamps.to);
      }
      // -ml 1 effectively yields one token per segment. Some versions still merge a
      // few tokens — split on whitespace and distribute the time linearly.
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        words.push({ word: tokens[0], start, end });
      } else {
        const span = end - start;
        for (let i = 0; i < tokens.length; i++) {
          const a = start + (span * i) / tokens.length;
          const b = start + (span * (i + 1)) / tokens.length;
          words.push({ word: tokens[i], start: a, end: b });
        }
      }
    }
  }

  // Shape 2: word-level segments from some whisper-cli builds
  if (Array.isArray(t.segments)) {
    for (const seg of t.segments) {
      if (Array.isArray(seg.words)) {
        for (const w of seg.words) words.push({ word: w.word, start: w.start, end: w.end });
      } else if (seg.text && seg.start !== undefined && seg.end !== undefined) {
        const tokens = seg.text.split(/\s+/).filter(Boolean);
        const span = seg.end - seg.start;
        for (let i = 0; i < tokens.length; i++) {
          const a = seg.start + (span * i) / tokens.length;
          const b = seg.start + (span * (i + 1)) / tokens.length;
          words.push({ word: tokens[i], start: a, end: b });
        }
      }
    }
  }

  return words;
}

/** Build the displayed answer string. When `germanName` is set — i.e. the spell is
 *  literally pronounced differently in the German dub than in the English one — both
 *  spoken forms are joined with " / " so the host can accept either. The field is NOT
 *  for descriptive translations (e.g. "Schwebezauber" for Wingardium Leviosa); it only
 *  captures different actual incantations. Most HP spells stay Latin in both dubs, so
 *  this collapses to just the canonical name. */
function buildAnswer(spell: SpellMatch['spell']): string {
  if (spell.germanName && spell.germanName.trim() && spell.germanName.trim() !== spell.canonical) {
    return `${spell.canonical} / ${spell.germanName.trim()}`;
  }
  return spell.canonical;
}

/** Confidence threshold above which a match is trusted enough to be enabled in the show.
 *  Matches below this are still included in the archive (so the host can spot-check
 *  them in the admin) but emitted with `disabled: true` so they never accidentally fire
 *  during live play. Matches the LOW vs HIGH split already used for the review log. */
const ENABLE_CONFIDENCE_THRESHOLD = 0.80;

function matchToQuestion(match: SpellMatch, video: string): VideoGuessQuestion {
  const start = Math.max(0, match.wordStart - 4.0);
  const questionEnd = Math.max(start + 0.1, match.wordStart - 0.3);
  const answerEnd = Math.max(questionEnd + 0.5, match.wordEnd + 3.0);
  const q: VideoGuessQuestion = {
    answer: buildAnswer(match.spell),
    video: `/videos/${video}`,
    audioTrack: 0,
    videoStart: round(start),
    videoQuestionEnd: round(questionEnd),
    videoAnswerEnd: round(answerEnd),
  };
  if (match.confidence < ENABLE_CONFIDENCE_THRESHOLD) q.disabled = true;
  return q;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Fingerprint bookkeeping ──────────────────────────────────────────────────

interface Fingerprint {
  video: string;
  /** Canonical spell name (NOT the "Canonical / German" combined answer). Used to match
   *  even if the user later toggled the `germanName` field on the dictionary. */
  canonical: string;
  /** videoStart of the emitted question (≈ wordStart − 4). Compared with FP_TOLERANCE_SEC. */
  videoStart: number;
}

interface FingerprintFile {
  entries: Fingerprint[];
}

function loadFingerprints(): FingerprintFile {
  if (!existsSync(FINGERPRINT_FILE)) return { entries: [] };
  try {
    const data = JSON.parse(readFileSync(FINGERPRINT_FILE, 'utf8')) as Partial<FingerprintFile>;
    return { entries: Array.isArray(data.entries) ? data.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function saveFingerprints(fp: FingerprintFile): void {
  writeFileSync(FINGERPRINT_FILE, JSON.stringify(fp, null, 2) + '\n');
}

/** Split a possibly-bilingual answer ("Wingardium Leviosa / Schwebezauber") back into
 *  its canonical form so it matches dictionary entries and old fingerprints that pre-date
 *  the germanName feature. */
function canonicalOf(answer: string): string {
  const i = answer.indexOf(' / ');
  return i >= 0 ? answer.slice(0, i) : answer;
}

function fingerprintMatches(fp: Fingerprint, video: string, canonical: string, videoStart: number): boolean {
  return fp.video === video
    && fp.canonical === canonical
    && Math.abs(fp.videoStart - videoStart) <= FP_TOLERANCE_SEC;
}

function archiveHasQuestionAt(archive: VideoGuessQuestion[], video: string, canonical: string, videoStart: number): boolean {
  return archive.some(q =>
    q.video === video
    && canonicalOf(q.answer) === canonical
    && Math.abs((q.videoStart ?? 0) - videoStart) <= FP_TOLERANCE_SEC
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString('de-DE');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s - m * 60);
  return `${m}m ${rem}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render an in-place progress bar to stdout using carriage return. Falls back to periodic
 * percentage lines when stdout isn't a TTY (CI logs, redirected output) so the output stays
 * readable there too. `current` and `total` are in arbitrary units; `label` is shown after
 * the bar and should stay short (one line). Pass `force` to override the non-TTY
 * throttling (used for the final completion line).
 */
function renderProgressBar(current: number, total: number, startedAt: number, label: string, force = false): void {
  const pct = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const elapsed = Date.now() - startedAt;
  const etaStr = pct > 0.02 && pct < 1 ? ` · ETA ${formatDuration(elapsed * (1 - pct) / pct)}` : '';
  const line = `  [${bar}] ${(pct * 100).toFixed(0).padStart(3)}% · ${formatNumber(current)}/${formatNumber(total)}${etaStr} · ${label}`;
  if (IS_TTY) {
    // Clear the rest of the line in case the previous render was longer
    process.stdout.write(`\r${line}\x1b[K`);
  } else {
    // Non-TTY: emit a new line every ~10% so logs still show progress without spamming.
    // `force` bypasses the throttle so the caller can guarantee the final line lands.
    const bucket = Math.floor(pct * 10);
    const prev = (renderProgressBar as unknown as { _lastBucket?: number })._lastBucket ?? -1;
    if (force || bucket !== prev) {
      (renderProgressBar as unknown as { _lastBucket?: number })._lastBucket = bucket;
      process.stdout.write(line + '\n');
    }
  }
}

function finishProgressBar(): void {
  if (IS_TTY) process.stdout.write('\n');
  (renderProgressBar as unknown as { _lastBucket?: number })._lastBucket = undefined;
}

interface MovieStats {
  movieIndex: number;
  matchCount: number;
  lowConfidenceCount: number;
  placeholder: boolean;
  skipped: boolean;
  elapsedMs: number;
  wordCount: number;
}

function processMovie(
  movie: Movie,
  dictionary: SpellEntry[],
  reviewLines: string[],
  position: { current: number; total: number },
): { questions: VideoGuessQuestion[]; stats: MovieStats } {
  const stats: MovieStats = {
    movieIndex: movie.index,
    matchCount: 0,
    lowConfidenceCount: 0,
    placeholder: false,
    skipped: false,
    elapsedMs: 0,
    wordCount: 0,
  };
  const startedAt = Date.now();

  console.log('');
  console.log(`[hp-spells] ═══ Film ${position.current}/${position.total} (Nr. ${movie.index}) ═══`);
  console.log(`[hp-spells] Datei:      ${movie.file}`);

  const slugBase = cacheSlug(movie.file).replace(/\.[^.]+$/, '');
  // Try English first (the recommended ASR track), fall back to German if that's all the
  // operator transcribed.
  const candidates = [
    path.join(CACHE_BASE, `${slugBase}__en.json`),
    path.join(CACHE_BASE, `${slugBase}__de.json`),
  ];
  const transcriptPath = candidates.find(existsSync);
  if (!transcriptPath) {
    // No transcript yet → emit nothing for this movie. Previously we generated one
    // disabled placeholder per dictionary spell expected here, but the operator preferred
    // an empty section over noise — when whisper hasn't been run, the archive should not
    // pretend the movie has been processed.
    console.log(`[hp-spells] ⚠️  Kein Transkript gefunden (weder __en.json noch __de.json).`);
    console.log(`[hp-spells]    Im Admin transkribieren — überspringe diesen Film.`);
    stats.placeholder = true;
    stats.matchCount = 0;
    stats.elapsedMs = Date.now() - startedAt;
    return { questions: [], stats };
  }

  const lang = transcriptPath.endsWith('__en.json') ? 'EN' : 'DE';
  const transcriptSize = statSync(transcriptPath).size;
  console.log(`[hp-spells] Transkript: ${path.relative(ROOT_DIR, transcriptPath)} (${formatBytes(transcriptSize)}, ${lang})`);

  process.stdout.write('[hp-spells] Parsen…          ');
  const parseStart = Date.now();
  let transcript: WhisperTranscript;
  try {
    transcript = JSON.parse(readFileSync(transcriptPath, 'utf8')) as WhisperTranscript;
  } catch (err) {
    console.log('');
    console.warn(`[hp-spells] Konnte Transkript nicht laden ${transcriptPath}: ${(err as Error).message}`);
    stats.skipped = true;
    stats.elapsedMs = Date.now() - startedAt;
    return { questions: [], stats };
  }
  console.log(`${formatDuration(Date.now() - parseStart)}`);

  process.stdout.write('[hp-spells] Flatten…         ');
  const flattenStart = Date.now();
  const words = flattenTranscript(transcript);
  console.log(`${formatDuration(Date.now() - flattenStart)}`);

  if (words.length === 0) {
    console.warn(`[hp-spells] ⚠️  Transkript enthält keine Wörter — übersprungen.`);
    stats.skipped = true;
    stats.elapsedMs = Date.now() - startedAt;
    return { questions: [], stats };
  }

  // Sanity-check the transcript for whisper.cpp's "infinite loop" hallucination mode,
  // where a single transcribed phrase gets fed back into the decoder and repeats for the
  // rest of the file. Empirically observed thresholds across broken HP transcripts:
  //   HP2: 2.10 % diversity (very obvious loop)
  //   HP3: 5.89 % diversity (same failure mode, looser loop)
  //   HP1: 5.40 % diversity (retranscribed with -nc, still looped)
  // So 10 % is the right threshold to catch them all while not flagging clean transcripts
  // (a normal movie transcription is typically 15-25 % diversity).
  const LOOP_DIVERSITY_THRESHOLD = 0.10;
  const uniqueTokens = new Set(words.map(w => w.word.toLowerCase())).size;
  const diversityRatio = uniqueTokens / words.length;
  if (words.length > 2000 && diversityRatio < LOOP_DIVERSITY_THRESHOLD) {
    console.warn(`[hp-spells] ⚠️  Transkript wirkt halluziniert: nur ${uniqueTokens} unterschiedliche`);
    console.warn(`[hp-spells]    Wörter in ${formatNumber(words.length)} Tokens (${(diversityRatio * 100).toFixed(1)} %).`);
    console.warn(`[hp-spells]    Das ist typisch für whisper.cpp-Endlosschleifen. Im Admin neu`);
    console.warn(`[hp-spells]    transkribieren (neuer Lauf nutzt das "-nc"-Flag, das das Problem behebt).`);
    console.warn(`[hp-spells]    Überspringe Film ${movie.index}.`);
    stats.skipped = true;
    stats.elapsedMs = Date.now() - startedAt;
    return { questions: [], stats };
  }

  stats.wordCount = words.length;
  const durationSec = words[words.length - 1].end || 0;
  const durationMin = Math.floor(durationSec / 60);
  console.log(`[hp-spells] Wörter:     ${formatNumber(words.length)} · Audio-Länge: ~${durationMin} Min.`);
  console.log(`[hp-spells] ${formatNumber(dictionary.length)} Zauberspruch-Kandidaten im Wörterbuch.`);

  console.log(`[hp-spells] Suche läuft…`);
  const matchStart = Date.now();
  let lastLabel = 'Start…';
  const matches = findSpells(words, dictionary, {
    // Only consider spells the wiki/dictionary lists for THIS movie. A spell like
    // "Point Me" is only cast in Goblet of Fire (movie 4); restricting by movie kills
    // the entire class of "wrong-movie" false positives without any change to the
    // matching algorithm. Spells without a movies field are kept (treated as "any movie").
    movieIndex: movie.index,
    onProgress: (scanned, total) => {
      renderProgressBar(scanned, total, matchStart, lastLabel);
    },
  });
  lastLabel = `${matches.length} Treffer`;
  renderProgressBar(words.length, words.length, matchStart, lastLabel, /* force */ true);
  finishProgressBar();

  // Split into high-confidence (enabled) and low-confidence (included but disabled +
  // flagged in review log). `matchToQuestion` applies the same threshold to decide
  // `disabled: true`, so counts here match the enabled/disabled split in the output.
  let lowCount = 0;
  for (const m of matches) {
    if (m.confidence < ENABLE_CONFIDENCE_THRESHOLD) {
      lowCount++;
      reviewLines.push(`Film ${movie.index} @${m.wordStart.toFixed(1)}s · ${m.spell.canonical} (conf ${(m.confidence * 100).toFixed(0)}%) · Whisper hörte: "${m.whisperText}"`);
    }
  }

  stats.matchCount = matches.length;
  stats.lowConfidenceCount = lowCount;
  stats.elapsedMs = Date.now() - startedAt;

  console.log(`[hp-spells] ✓ ${matches.length} Zauberspruch-Vorkommen (${lowCount} niedrige Konfidenz · deaktiviert) in ${formatDuration(stats.elapsedMs)}`);
  return { questions: matches.map(m => matchToQuestion(m, movie.file)), stats };
}

interface SpellsFile {
  type: string;
  title: string;
  rules: unknown[];
  instances: {
    v1?: { questions: VideoGuessQuestion[] };
    archive?: { questions: VideoGuessQuestion[] };
    [key: string]: { questions: VideoGuessQuestion[] } | undefined;
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const overallStart = Date.now();

  console.log('[hp-spells] ─────────────────────────────────────────');
  console.log('[hp-spells] Harry Potter spells archive generator');
  console.log(`[hp-spells] Modus: ${args.dryRun ? 'DRY-RUN (keine Datei geschrieben)' : 'Schreibmodus'}${args.movieFilter ? ` · nur Film ${args.movieFilter}` : ' · alle Filme'}${args.verbose ? ' · verbose' : ''}`);
  console.log('[hp-spells] ─────────────────────────────────────────');

  if (!existsSync(DICT_FILE)) {
    console.error(`[hp-spells] FEHLER: Dictionary fehlt: ${DICT_FILE}`);
    process.exit(1);
  }
  const dictionary = JSON.parse(readFileSync(DICT_FILE, 'utf8')) as SpellEntry[];
  console.log(`[hp-spells] Wörterbuch geladen: ${dictionary.length} Zauberspruch-Einträge`);

  if (!existsSync(GAMES_FILE)) {
    console.error(`[hp-spells] FEHLER: Spieldatei fehlt: ${GAMES_FILE}`);
    process.exit(1);
  }
  const game = JSON.parse(readFileSync(GAMES_FILE, 'utf8')) as SpellsFile;
  const existingArchiveCount = game.instances.archive?.questions.length ?? 0;
  console.log(`[hp-spells] Spieldatei geladen: ${path.relative(ROOT_DIR, GAMES_FILE)} (archive hat aktuell ${existingArchiveCount} Einträge)`);

  const moviesToProcess = args.movieFilter ? MOVIES.filter(m => m.index === args.movieFilter) : MOVIES;
  console.log(`[hp-spells] ${moviesToProcess.length} Film${moviesToProcess.length === 1 ? '' : 'e'} wird${moviesToProcess.length === 1 ? '' : 'en'} verarbeitet.`);

  const reviewLines: string[] = [];
  const newEntries: VideoGuessQuestion[] = [];
  const perMovieStats: MovieStats[] = [];
  for (let i = 0; i < moviesToProcess.length; i++) {
    const m = moviesToProcess[i];
    const { questions, stats } = processMovie(m, dictionary, reviewLines, {
      current: i + 1,
      total: moviesToProcess.length,
    });
    newEntries.push(...questions);
    perMovieStats.push(stats);
  }

  // Sort by (movie, videoStart) — find movie index by matching the video path
  const movieIndexByPath = new Map(MOVIES.map(m => [`/videos/${m.file}`, m.index]));
  newEntries.sort((a, b) => {
    const ma = movieIndexByPath.get(a.video) ?? 999;
    const mb = movieIndexByPath.get(b.video) ?? 999;
    if (ma !== mb) return ma - mb;
    return (a.videoStart ?? 0) - (b.videoStart ?? 0);
  });

  // Curation-preserving merge. The existing archive is authoritative for any entry it
  // contains; newEntries is only used to ADD new occurrences that neither the archive
  // nor the fingerprint file knows about. Deletions persist because a fingerprint in the
  // file + no matching archive entry is treated as a tombstone (user removed it; we skip).
  const archive = game.instances.archive ?? { questions: [] };
  const fingerprints = loadFingerprints();

  // Bootstrap: on the first run the fingerprint file is empty but the archive may already
  // have entries from a previous (non-idempotent) run. Seed fingerprints from those so
  // they're not re-treated as "never suggested" later.
  if (fingerprints.entries.length === 0 && archive.questions.length > 0) {
    for (const q of archive.questions) {
      fingerprints.entries.push({
        video: q.video,
        canonical: canonicalOf(q.answer),
        videoStart: q.videoStart ?? 0,
      });
    }
  }

  const priorFingerprintCount = fingerprints.entries.length;
  let addedCount = 0;
  let tombstoneSkippedCount = 0;
  const addedEntries: VideoGuessQuestion[] = [];
  for (const candidate of newEntries) {
    const canonical = canonicalOf(candidate.answer);
    const vs = candidate.videoStart ?? 0;
    const fp = fingerprints.entries.find(e => fingerprintMatches(e, candidate.video, canonical, vs));
    const inArchive = archiveHasQuestionAt(archive.questions, candidate.video, canonical, vs);
    if (fp && inArchive) continue;                          // already present — preserve existing
    if (fp && !inArchive) { tombstoneSkippedCount++; continue; } // deleted by user — stay deleted
    // New occurrence: add to archive + fingerprint file
    addedEntries.push(candidate);
    fingerprints.entries.push({ video: candidate.video, canonical, videoStart: vs });
    addedCount++;
  }

  const mergedArchive: VideoGuessQuestion[] = [...archive.questions, ...addedEntries];
  mergedArchive.sort((a, b) => {
    const ma = movieIndexByPath.get(a.video) ?? 999;
    const mb = movieIndexByPath.get(b.video) ?? 999;
    if (ma !== mb) return ma - mb;
    return (a.videoStart ?? 0) - (b.videoStart ?? 0);
  });

  console.log('');
  console.log(`[hp-spells] Kuration erhalten: ${archive.questions.length} unverändert, ${addedCount} neu, ${tombstoneSkippedCount} als gelöscht respektiert (Tombstones).`);

  const output: SpellsFile = {
    ...game,
    instances: {
      ...game.instances,
      // Preserve v1 EXACTLY — do not touch the curated playlist
      archive: { questions: mergedArchive },
    },
  };

  // ─── Final summary ────────────────────────────────────────
  console.log('');
  console.log('[hp-spells] ═════════ Zusammenfassung ═════════');
  for (const s of perMovieStats) {
    const movie = MOVIES.find(m => m.index === s.movieIndex)!;
    const tag = s.placeholder ? '(Platzhalter)' : s.skipped ? '(übersprungen)' : '';
    const lowTag = s.lowConfidenceCount > 0 ? ` · ${s.lowConfidenceCount} niedr. Konf.` : '';
    const wordTag = s.wordCount > 0 ? ` · ${formatNumber(s.wordCount)} Wörter` : '';
    console.log(`[hp-spells]   Film ${s.movieIndex} ${movie.file.replace(/\.m4v$/, '').padEnd(52)} ${String(s.matchCount).padStart(4)} Treffer${lowTag}${wordTag} · ${formatDuration(s.elapsedMs)} ${tag}`);
  }
  console.log('[hp-spells] ───────────────────────────────────');
  console.log(`[hp-spells] Archive gesamt: ${mergedArchive.length} Einträge (vorher: ${archive.questions.length}, +${addedCount} neu)`);
  console.log(`[hp-spells] Fingerprints: ${fingerprints.entries.length} (vorher: ${priorFingerprintCount})`);
  console.log(`[hp-spells] Niedrige Konfidenz insgesamt: ${reviewLines.length}`);
  console.log(`[hp-spells] Gesamtzeit: ${formatDuration(Date.now() - overallStart)}`);

  if (args.dryRun) {
    console.log('[hp-spells] --dry-run: keine Datei geschrieben');
    if (args.verbose && reviewLines.length > 0) {
      console.log('--- niedrige Konfidenz ---');
      for (const l of reviewLines) console.log(l);
    }
    return;
  }

  // Write the game file with trailing newline (AGENTS.md §7)
  writeFileSync(GAMES_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`[hp-spells] ✓ ${path.relative(ROOT_DIR, GAMES_FILE)} aktualisiert`);

  // Persist fingerprints — this is what makes subsequent runs idempotent against user
  // curation. Even if no new entries were added, we save in case we seeded fingerprints
  // from the existing archive above on a first run.
  saveFingerprints(fingerprints);
  console.log(`[hp-spells] ✓ ${path.relative(ROOT_DIR, FINGERPRINT_FILE)} aktualisiert`);

  // Write the review log
  if (reviewLines.length > 0) {
    mkdirSync(path.dirname(REVIEW_LOG), { recursive: true });
    writeFileSync(REVIEW_LOG, reviewLines.join('\n') + '\n');
    console.log(`[hp-spells] ✓ ${path.relative(ROOT_DIR, REVIEW_LOG)} (${reviewLines.length} Einträge zum Prüfen)`);
  }
}

main();
