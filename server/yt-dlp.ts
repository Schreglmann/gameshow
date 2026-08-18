// yt-dlp binary management — auto-downloads the standalone yt-dlp binary into
// node_modules/.cache and exposes it to both the download flow (server/index.ts)
// and the keyword-search flow (server/youtube-search.ts) so neither duplicates
// the bootstrap logic. Also re-fetches the binary once it's stale, since
// YouTube changes frequently enough that an old yt-dlp silently starts
// failing downloads (signature/PO-token extraction breaks) with nothing but
// a generic exit-code-1 error to show for it.

import path from 'path';
import { existsSync, createWriteStream } from 'fs';
import { mkdir, chmod, rename, unlink, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { ROOT_DIR } from './asset-paths.js';

export const YT_DLP_BIN = path.join(ROOT_DIR, 'node_modules', '.cache', 'yt-dlp');

const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// yt-dlp's YouTube extractor needs a JS runtime (for PO-token / player challenge).
// Only deno ships enabled by default — tell yt-dlp about the current Node binary so
// that users without deno installed can still download.
export const YT_DLP_JS_RUNTIME_ARGS = ['--js-runtimes', `node:${process.execPath}`];

let ytDlpReady: Promise<void> | null = null;

export function ytDlpAssetName(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'yt-dlp_macos' : 'yt-dlp_macos';
  if (p === 'linux') return a === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  if (p === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp';
}

async function downloadYtDlp(): Promise<void> {
  await mkdir(path.dirname(YT_DLP_BIN), { recursive: true });
  const asset = ytDlpAssetName();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  // Stage through a temp file and rename into place. Streaming straight to
  // YT_DLP_BIN meant an interrupted download (connection drop, disk full,
  // Ctrl-C) left a truncated binary at the final path — and because
  // `existsSync` then reported it as present, every later call skipped the
  // download and YouTube search + download stayed permanently broken until
  // someone deleted the file by hand.
  const tmp = `${YT_DLP_BIN}.${process.pid}.tmp`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Failed to download yt-dlp: ${res.status}`);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmp));
    await chmod(tmp, 0o755);
    await rename(tmp, YT_DLP_BIN);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export function ensureYtDlp(): Promise<void> {
  // Only dedupes calls that land *while a download/update is in flight* — the
  // memo is always cleared once that settles (success or failure), so every
  // call re-verifies the binary is actually still on disk via a cheap
  // existsSync/stat rather than trusting a stale "it was fine once" result.
  // The binary can otherwise vanish out from under a long-running process
  // (deleted by hand, cache wiped) and every future call would keep skipping
  // the download forever, spawning a path that no longer exists.
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      if (!existsSync(YT_DLP_BIN)) {
        await downloadYtDlp();
        return;
      }
      const { mtimeMs } = await stat(YT_DLP_BIN);
      if (Date.now() - mtimeMs > UPDATE_CHECK_INTERVAL_MS) {
        // Best-effort: keep using the existing binary if GitHub is
        // unreachable rather than failing an otherwise-working download.
        await downloadYtDlp().catch(() => {});
      }
    })().finally(() => {
      ytDlpReady = null;
    });
  }
  return ytDlpReady;
}
