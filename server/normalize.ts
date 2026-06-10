/**
 * Server-side audio normalizer
 * Normalizes a single audio file to -16 LUFS using ffmpeg's loudnorm filter.
 * Async version of the logic in normalize-audio.ts, designed for use during uploads.
 *
 * Uses `spawn()` (not `exec()`) so we can track child PIDs and re-apply priority
 * when the operator flips cache mode mid-encode. See [specs/server-asset-priority.md].
 */

import { spawn, execFile } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { getCacheMode, onCacheModeChange, getRepriceArgs, type CacheMode } from './encoding-prefs.js';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

/** Mode-aware CPU demotion. Mirrors `bgProcessPrefix()` in server/index.ts and
 *  `ffmpegThrottlePrefix()` in server/whisper-jobs.ts.
 *   - balanced (default): `taskpolicy -c utility` (macOS) / `nice -n 19` (Linux).
 *   - max: no demotion. */
function priorityPrefix(): string[] {
  if (getCacheMode() === 'max') return [];
  if (process.platform === 'darwin') return ['taskpolicy', '-c', 'utility'];
  if (process.platform === 'linux') return ['nice', '-n', '19'];
  return [];
}

const SUPPORTED_AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.opus'];
const TARGET_LUFS = -16;
const LUFS_TOLERANCE = 0.5;

// Bound every ffmpeg invocation. Without these, a stuck codec or very verbose
// loudnorm log can hang an SSE request forever (that's how youtube-download's
// "stuck at normalizing" modal was happening).
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_MAX_BUFFER = 32 * 1024 * 1024;

/** Active normalize-ffmpeg PIDs — tracked so live cache-mode flips can re-price
 *  in-flight encodes via `taskpolicy -p` / `renice -p`. */
const _normalizePids = new Set<number>();

function reapplyNormalizePriority(mode: CacheMode): void {
  if (_normalizePids.size === 0) return;
  const args = getRepriceArgs(mode);
  if (!args) return;
  const cmd = args[0];
  if (cmd === undefined) return;
  for (const pid of _normalizePids) {
    execFile(cmd, [...args.slice(1), String(pid)], (err) => {
      if (err) console.warn(`[normalize] failed to reprice pid ${pid} to ${mode}: ${err.message}`);
    });
  }
}
onCacheModeChange(reapplyNormalizePriority);

interface FfmpegResult { stderr: string }

/** Run ffmpeg under the current priority prefix, tracking its PID for live
 *  re-pricing. Collects stderr (where loudnorm writes its JSON) up to
 *  FFMPEG_MAX_BUFFER, kills on FFMPEG_TIMEOUT_MS. Rejects on non-zero exit. */
function runFfmpeg(ffmpegArgs: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const prefix = priorityPrefix();
    const cmd = prefix.length > 0 ? prefix[0]! : FFMPEG;
    const argv = prefix.length > 0 ? [...prefix.slice(1), FFMPEG, ...ffmpegArgs] : ffmpegArgs;
    const proc = spawn(cmd, argv, { timeout: FFMPEG_TIMEOUT_MS });
    if (typeof proc.pid === 'number') {
      const pid = proc.pid;
      _normalizePids.add(pid);
      proc.on('close', () => _normalizePids.delete(pid));
    }
    let stderr = '';
    let overflowed = false;
    proc.stdout?.on('data', () => { /* ignored; loudnorm writes to stderr */ });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      stderr += chunk.toString('utf8');
      if (stderr.length > FFMPEG_MAX_BUFFER) {
        overflowed = true;
        proc.kill();
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (overflowed) return reject(new Error('ffmpeg stderr exceeded max buffer'));
      if (code === 0) return resolve({ stderr });
      reject(new Error(`ffmpeg exit ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

interface LoudnessInfo {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
}

/** Check if a file extension is a supported audio format */
export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_AUDIO_EXT.includes(ext);
}

/** Analyze loudness of an audio file */
async function analyzeLoudness(filePath: string): Promise<LoudnessInfo | null> {
  try {
    const { stderr } = await runFfmpeg([
      '-i', filePath,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null', '-',
    ]);

    const jsonMatch = stderr.match(/\{[^}]+input_i[^}]+\}/s);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[0]);
    return {
      inputI: parseFloat(data.input_i),
      inputTp: parseFloat(data.input_tp),
      inputLra: parseFloat(data.input_lra),
      inputThresh: parseFloat(data.input_thresh),
    };
  } catch {
    return null;
  }
}

/**
 * Normalize a single audio file in-place.
 * Returns the (possibly changed) file path — .opus files are converted to .m4a.
 * If the file is already within tolerance, it is left untouched.
 */
export async function normalizeAudioFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXT.includes(ext)) return filePath;

  console.log(`[normalize] Analyzing: ${filePath}`);
  const loudness = await analyzeLoudness(filePath);
  if (!loudness) {
    console.warn(`[normalize] Could not analyze loudness for: ${filePath}`);
    return filePath;
  }

  const diff = Math.abs(loudness.inputI - TARGET_LUFS);
  console.log(`[normalize] Current: ${loudness.inputI.toFixed(1)} LUFS (target: ${TARGET_LUFS}, diff: ${diff.toFixed(1)})`);

  if (diff < LUFS_TOLERANCE) {
    console.log(`[normalize] Already within tolerance, skipping.`);
    return filePath;
  }

  // Determine output codec args
  let outputPath = filePath;
  let codecArgs: string[] = [];

  if (ext === '.opus') {
    outputPath = filePath.replace(/\.opus$/i, '.m4a');
    codecArgs = ['-c:a', 'aac', '-b:a', '192k'];
    console.log('[normalize] Converting opus → m4a');
  } else if (ext === '.mp3') {
    codecArgs = ['-c:a', 'libmp3lame', '-b:a', '192k'];
  } else if (ext === '.m4a') {
    codecArgs = ['-c:a', 'aac', '-b:a', '192k'];
  } else if (ext === '.ogg') {
    codecArgs = ['-c:a', 'libvorbis', '-b:a', '192k'];
  } else if (ext === '.wav') {
    codecArgs = ['-c:a', 'pcm_s16le'];
  }

  const tempPath = filePath + '.tmp' + (ext === '.opus' ? '.m4a' : ext);

  try {
    await runFfmpeg([
      '-y',
      '-i', filePath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.inputI}:measured_TP=${loudness.inputTp}:measured_LRA=${loudness.inputLra}:measured_thresh=${loudness.inputThresh}:linear=true`,
      ...codecArgs,
      tempPath,
    ]);

    // Replace original with normalized version
    await fs.rename(tempPath, outputPath);

    // Remove original .opus file if converted to .m4a
    if (ext === '.opus' && outputPath !== filePath) {
      await fs.unlink(filePath);
      console.log(`[normalize] Normalized and converted to: ${path.basename(outputPath)}`);
    } else {
      console.log(`[normalize] Normalized successfully: ${path.basename(outputPath)}`);
    }

    return outputPath;
  } catch (error) {
    console.error(`[normalize] Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // Clean up temp file
    if (existsSync(tempPath)) {
      await fs.unlink(tempPath);
    }
    // Return original path — upload still succeeds, just unnormalized
    return filePath;
  }
}
