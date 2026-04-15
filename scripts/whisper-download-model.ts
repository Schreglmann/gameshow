/**
 * Download the ggml-large-v3-turbo Whisper model from HuggingFace into
 * local-assets/videos/.whisper-cache/models/. ~1.5 GB, one-time download.
 *
 * Cross-platform (uses node fetch + fs streams). No bash, no curl required.
 *
 * Override the model with the WHISPER_MODEL_NAME env var (e.g. WHISPER_MODEL_NAME=ggml-base.bin
 * for faster but lower-quality transcription on slower machines).
 *
 * Cache location: same tier as the videos themselves so `npm run sync:push` mirrors the model
 * to the NAS for other workstations.
 */

import { existsSync, mkdirSync, statSync, createWriteStream, renameSync, unlinkSync } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';

const REPO_ROOT = process.cwd();
const MODEL_DIR = path.join(REPO_ROOT, 'local-assets', 'videos', '.whisper-cache', 'models');
const MODEL_NAME = process.env.WHISPER_MODEL_NAME || 'ggml-large-v3-turbo.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}?download=true`;

async function main(): Promise<void> {
  const dest = path.join(MODEL_DIR, MODEL_NAME);
  if (existsSync(dest)) {
    const sz = statSync(dest).size;
    if (sz > 100_000_000) {
      console.log(`[whisper-model] Already present: ${dest} (${(sz / 1e9).toFixed(2)} GB)`);
      return;
    }
    console.log(`[whisper-model] Existing file looks truncated (${sz} bytes); re-downloading…`);
    try { unlinkSync(dest); } catch { /* ignore */ }
  }

  mkdirSync(MODEL_DIR, { recursive: true });
  const tmp = dest + '.partial';
  if (existsSync(tmp)) try { unlinkSync(tmp); } catch { /* ignore */ }

  console.log(`[whisper-model] Downloading ${MODEL_NAME} from HuggingFace…`);
  console.log(`[whisper-model] URL:  ${MODEL_URL}`);
  console.log(`[whisper-model] Dest: ${dest}`);
  console.log('[whisper-model] (~1.5 GB — this can take several minutes on a slow link.)');

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} — ${res.statusText}`);

  const totalStr = res.headers.get('content-length');
  const total = totalStr ? parseInt(totalStr, 10) : 0;
  let downloaded = 0;
  let lastLogPct = -1;

  // Wrap the web ReadableStream in a Node Readable + tee a counting transformer so we can
  // print progress without consuming the body twice.
  const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream<Uint8Array>);
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    if (total > 0) {
      const pct = Math.floor((downloaded / total) * 100);
      if (pct !== lastLogPct && pct % 5 === 0) {
        lastLogPct = pct;
        process.stdout.write(`[whisper-model] ${pct} %  (${(downloaded / 1e9).toFixed(2)} / ${(total / 1e9).toFixed(2)} GB)\n`);
      }
    }
  });

  await pipeline(nodeStream, createWriteStream(tmp));
  renameSync(tmp, dest);

  console.log(`[whisper-model] Done: ${dest}`);
}

main().catch(err => {
  console.error(`[whisper-model] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
