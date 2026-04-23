/**
 * Server-side audio normalizer
 * Normalizes a single audio file to -16 LUFS using ffmpeg's loudnorm filter.
 * Async version of the logic in normalize-audio.ts, designed for use during uploads.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';

const execAsync = promisify(exec);
const FFMPEG = ffmpegStatic ?? 'ffmpeg';

const SUPPORTED_AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.opus'];
const TARGET_LUFS = -16;
const LUFS_TOLERANCE = 0.5;

// Bound every ffmpeg invocation. Without these, a stuck codec or very verbose
// loudnorm log can hang an SSE request forever (that's how youtube-download's
// "stuck at normalizing" modal was happening).
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_MAX_BUFFER = 32 * 1024 * 1024;

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
    const cmd = `"${FFMPEG}" -i "${filePath}" -af loudnorm=print_format=json -f null -`;
    const { stderr } = await execAsync(cmd, {
      encoding: 'utf-8',
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: FFMPEG_MAX_BUFFER,
    });

    // ffmpeg writes loudnorm JSON to stderr
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

  // Determine output format
  let outputPath = filePath;
  let outputArgs = '';

  if (ext === '.opus') {
    outputPath = filePath.replace(/\.opus$/i, '.m4a');
    outputArgs = '-c:a aac -b:a 192k';
    console.log('[normalize] Converting opus → m4a');
  } else if (ext === '.mp3') {
    outputArgs = '-c:a libmp3lame -b:a 192k';
  } else if (ext === '.m4a') {
    outputArgs = '-c:a aac -b:a 192k';
  } else if (ext === '.ogg') {
    outputArgs = '-c:a libvorbis -b:a 192k';
  } else if (ext === '.wav') {
    outputArgs = '-c:a pcm_s16le';
  }

  const tempPath = filePath + '.tmp' + (ext === '.opus' ? '.m4a' : ext);

  try {
    const cmd = [
      `"${FFMPEG}"`, '-y',
      '-i', `"${filePath}"`,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.inputI}:measured_TP=${loudness.inputTp}:measured_LRA=${loudness.inputLra}:measured_thresh=${loudness.inputThresh}:linear=true`,
      outputArgs,
      `"${tempPath}"`,
    ].filter(Boolean).join(' ');

    await execAsync(cmd, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER });

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
