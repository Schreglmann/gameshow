// yt-dlp binary management — auto-downloads the standalone yt-dlp binary into
// node_modules/.cache and exposes it to both the download flow (server/index.ts)
// and the keyword-search flow (server/youtube-search.ts) so neither duplicates
// the bootstrap logic.

import path from 'path';
import { existsSync, createWriteStream } from 'fs';
import { mkdir, chmod } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { ROOT_DIR } from './asset-paths.js';

export const YT_DLP_BIN = path.join(ROOT_DIR, 'node_modules', '.cache', 'yt-dlp');

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

export function ensureYtDlp(): Promise<void> {
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      if (existsSync(YT_DLP_BIN)) return;
      await mkdir(path.dirname(YT_DLP_BIN), { recursive: true });
      const asset = ytDlpAssetName();
      const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Failed to download yt-dlp: ${res.status}`);
      await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(YT_DLP_BIN));
      await chmod(YT_DLP_BIN, 0o755);
    })();
  }
  return ytDlpReady;
}
