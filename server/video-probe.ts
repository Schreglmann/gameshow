/**
 * Video probing and transcoding utilities.
 * Uses ffprobe to inspect audio tracks and ffmpeg to transcode incompatible codecs to AAC.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { unlink, rename } from 'fs/promises';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);
const FFMPEG = ffmpegStatic ?? 'ffmpeg';
const FFPROBE = ffprobeStatic.path ?? 'ffprobe';

// Codecs that browsers can play in MP4/M4V containers
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis', 'pcm_s16le']);

export interface VideoTrackInfo {
  index: number;
  codec: string;
  codecLong: string;
  channels: number;
  channelLayout: string;
  language: string;
  name: string;
  isDefault: boolean;
  browserCompatible: boolean;
}

export interface ProbeResult {
  tracks: VideoTrackInfo[];
  needsTranscode: boolean;
}

export async function probeVideoTracks(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'a',
    filePath,
  ]);

  const data = JSON.parse(stdout) as { streams: Record<string, unknown>[] };
  const tracks: VideoTrackInfo[] = (data.streams || []).map((s) => {
    const codec = s.codec_name as string || 'unknown';
    const tags = (s.tags || {}) as Record<string, string>;
    return {
      index: s.index as number,
      codec,
      codecLong: s.codec_long_name as string || codec,
      channels: s.channels as number || 0,
      channelLayout: s.channel_layout as string || '',
      language: tags.language || 'und',
      name: tags.name || tags.handler_name || '',
      isDefault: (s.disposition as Record<string, number>)?.default === 1,
      browserCompatible: BROWSER_AUDIO_CODECS.has(codec),
    };
  });

  const needsTranscode = tracks.length > 0 && tracks.some(t => !t.browserCompatible);
  return { tracks, needsTranscode };
}

// ── Transcode job tracking ──

export interface TranscodeJob {
  filePath: string;       // relative path (e.g. "Harry Potter.m4v")
  percent: number;        // 0-100
  status: 'running' | 'done' | 'error';
  error?: string;
  startedAt: number;      // Date.now() when job started
  elapsed: number;        // seconds elapsed (updated with each progress tick)
}

// In-memory map of active/recent transcode jobs, keyed by relative file path
const transcodeJobs = new Map<string, TranscodeJob>();

export function getTranscodeJobs(): TranscodeJob[] {
  return Array.from(transcodeJobs.values());
}

export function getTranscodeJob(relPath: string): TranscodeJob | undefined {
  return transcodeJobs.get(relPath);
}

/**
 * Start a transcode job in the background.
 * Returns immediately. Progress is tracked in transcodeJobs map.
 * onDone is called when the job finishes (success or error).
 */
export function startTranscodeJob(
  fullPath: string,
  relPath: string,
  onDone?: (job: TranscodeJob) => void,
): TranscodeJob {
  // If already running for this file, return existing job
  const existing = transcodeJobs.get(relPath);
  if (existing && existing.status === 'running') return existing;

  const now = Date.now();
  const job: TranscodeJob = { filePath: relPath, percent: 0, status: 'running', startedAt: now, elapsed: 0 };
  transcodeJobs.set(relPath, job);

  transcodeVideoAudio(fullPath, (pct) => {
    job.percent = pct;
    job.elapsed = (Date.now() - now) / 1000;
  }).then(() => {
    job.percent = 100;
    job.status = 'done';
    onDone?.(job);
    // Clean up completed jobs after 60s
    setTimeout(() => {
      if (transcodeJobs.get(relPath)?.status === 'done') {
        transcodeJobs.delete(relPath);
      }
    }, 60_000);
  }).catch((err) => {
    job.status = 'error';
    job.error = (err as Error).message;
    // Clean up errored jobs after 60s
    setTimeout(() => {
      if (transcodeJobs.get(relPath)?.status === 'error') {
        transcodeJobs.delete(relPath);
      }
    }, 60_000);
    onDone?.(job);
  });

  return job;
}

/**
 * Transcode all audio tracks in a video file to AAC stereo.
 * Video is copied as-is. Replaces the original file.
 */
async function transcodeVideoAudio(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { stdout: durationOut } = await execFileAsync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
  ]);
  const formatData = JSON.parse(durationOut) as { format: { duration?: string } };
  const totalDuration = parseFloat(formatData.format.duration ?? '0');

  const { tracks } = await probeVideoTracks(filePath);

  const ext = path.extname(filePath);
  const tmpPath = filePath.replace(ext, `.transcoding${ext}`);

  const args: string[] = ['-i', filePath, '-map', '0:v'];
  for (let i = 0; i < tracks.length; i++) {
    args.push('-map', `0:a:${i}`);
  }
  args.push('-c:v', 'copy');
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].browserCompatible) {
      args.push(`-c:a:${i}`, 'copy');
    } else {
      args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '256k', `-ac:a:${i}`, '2');
    }
  }
  args.push('-map', '0:s?', '-c:s', 'copy');
  args.push('-movflags', '+faststart', '-y', tmpPath);

  await new Promise<void>((resolve, reject) => {
    const proc = execFile(FFMPEG, ['-progress', 'pipe:1', '-nostats', ...args], { maxBuffer: 50 * 1024 * 1024 });

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && totalDuration > 0) {
          const seconds = parseInt(match[1]) / 1_000_000;
          const pct = Math.min(99, Math.round((seconds / totalDuration) * 100));
          onProgress?.(pct);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });

  await unlink(filePath);
  await rename(tmpPath, filePath);
  return filePath;
}
