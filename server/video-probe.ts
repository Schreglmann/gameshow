/**
 * Video probing and transcoding utilities.
 * Uses ffprobe to inspect audio tracks and ffmpeg to transcode incompatible codecs to AAC.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { unlink, rename, stat } from 'fs/promises';
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

export interface VideoStreamInfo {
  width: number;
  height: number;
  codec: string;
  codecLong: string;
  fps: number;
  duration: number;
  bitrate: number;
  fileSize: number;
  isHdr: boolean;
  colorTransfer: string;
  colorPrimaries: string;
  pixFmt: string;
}

export interface ProbeResult {
  tracks: VideoTrackInfo[];
  needsTranscode: boolean;
  videoInfo: VideoStreamInfo | null;
}

function parseFraction(s: string): number {
  const [num, den] = s.split('/').map(Number);
  return den ? Math.round((num / den) * 1000) / 1000 : num || 0;
}

export async function probeVideoTracks(filePath: string): Promise<ProbeResult> {
  const [audioOut, videoOut, fileStat] = await Promise.all([
    execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-select_streams', 'a',
      filePath,
    ]),
    execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-select_streams', 'v:0',
      '-show_format',
      filePath,
    ]),
    stat(filePath),
  ]);

  const audioData = JSON.parse(audioOut.stdout) as { streams: Record<string, unknown>[] };
  const tracks: VideoTrackInfo[] = (audioData.streams || []).map((s) => {
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

  const videoData = JSON.parse(videoOut.stdout) as {
    streams: Record<string, unknown>[];
    format?: Record<string, string>;
  };
  const vs = videoData.streams?.[0];
  const fmt = videoData.format;
  const colorTransfer = (vs?.color_transfer as string) ?? '';
  const colorPrimaries = (vs?.color_primaries as string) ?? '';
  const pixFmt = (vs?.pix_fmt as string) ?? '';
  // HDR detection: PQ (smpte2084) or HLG (arib-std-b67) transfer with BT.2020 primaries
  const isHdr = (colorTransfer === 'smpte2084' || colorTransfer === 'arib-std-b67')
    && colorPrimaries === 'bt2020';

  const videoInfo: VideoStreamInfo | null = vs ? {
    width: (vs.width as number) ?? 0,
    height: (vs.height as number) ?? 0,
    codec: (vs.codec_name as string) ?? 'unknown',
    codecLong: (vs.codec_long_name as string) ?? (vs.codec_name as string) ?? 'unknown',
    fps: parseFraction((vs.avg_frame_rate as string) || (vs.r_frame_rate as string) || '0/1'),
    duration: parseFloat(fmt?.duration ?? '0'),
    bitrate: parseInt(fmt?.bit_rate ?? '0', 10),
    fileSize: fileStat.size,
    isHdr,
    colorTransfer,
    colorPrimaries,
    pixFmt,
  } : null;

  const needsTranscode = tracks.length > 0 && tracks.some(t => !t.browserCompatible);
  return { tracks, needsTranscode, videoInfo };
}

// ── Transcode job tracking ──

export type TranscodePhase = 'encoding' | 'finalizing' | 'replacing';

export interface TranscodeJob {
  filePath: string;       // relative path (e.g. "Harry Potter.m4v")
  percent: number;        // 0-100
  status: 'running' | 'done' | 'error';
  phase: TranscodePhase;  // current stage of the transcode
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

export interface TranscodeOptions {
  hdrToSdr?: boolean;
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
  options?: TranscodeOptions,
): TranscodeJob {
  // If already running for this file, return existing job
  const existing = transcodeJobs.get(relPath);
  if (existing && existing.status === 'running') return existing;

  const now = Date.now();
  const job: TranscodeJob = { filePath: relPath, percent: 0, status: 'running', phase: 'encoding', startedAt: now, elapsed: 0 };
  transcodeJobs.set(relPath, job);

  const label = options?.hdrToSdr ? 'HDR→SDR' : 'audio';
  console.log(`[transcode] Started ${label}: ${relPath}`);
  const progressInterval = setInterval(() => {
    const etaPart = job.percent > 0
      ? `, ETA ${Math.round((job.elapsed / job.percent) * (100 - job.percent))}s`
      : '';
    console.log(`[transcode] ${relPath} — ${job.phase} ${job.percent}% (${Math.round(job.elapsed)}s elapsed${etaPart})`);
  }, 10_000);

  const work = options?.hdrToSdr
    ? transcodeHdrToSdr(fullPath, (pct, phase) => {
        job.percent = pct;
        job.phase = phase;
        job.elapsed = (Date.now() - now) / 1000;
      })
    : transcodeVideoAudio(fullPath, (pct, phase) => {
        job.percent = pct;
        job.phase = phase;
        job.elapsed = (Date.now() - now) / 1000;
      });

  work.then(() => {
    clearInterval(progressInterval);
    job.percent = 100;
    job.status = 'done';
    job.elapsed = (Date.now() - now) / 1000;
    console.log(`[transcode] Done: ${relPath} (${Math.round(job.elapsed)}s)`);
    onDone?.(job);
    // Clean up completed jobs after 60s
    setTimeout(() => {
      if (transcodeJobs.get(relPath)?.status === 'done') {
        transcodeJobs.delete(relPath);
      }
    }, 60_000);
  }).catch((err) => {
    clearInterval(progressInterval);
    job.status = 'error';
    job.error = (err as Error).message;
    job.elapsed = (Date.now() - now) / 1000;
    console.error(`[transcode] Error: ${relPath} — ${job.error}`);
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
 *
 * Progress phases:
 *   encoding   (0–90%) — ffmpeg encodes audio tracks
 *   finalizing (90–99%) — ffmpeg faststart pass (rewrite moov atom to front)
 *   replacing  (99–100%) — swap temp file for original
 */
async function transcodeVideoAudio(
  filePath: string,
  onProgress?: (percent: number, phase: TranscodePhase) => void,
): Promise<string> {
  const [{ stdout: durationOut }, fileStat] = await Promise.all([
    execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ]),
    stat(filePath),
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
  // Force mp4 muxer — .m4v triggers the 'ipod' muxer which doesn't support HEVC
  args.push('-f', 'mp4', '-movflags', '+faststart', '-y', tmpPath);

  const fullArgs = ['-progress', 'pipe:1', '-nostats', ...args];
  console.log(`[transcode] Running: ${FFMPEG} ${fullArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

  // Estimate faststart time: needs to read + rewrite entire file (~200 MB/s I/O)
  const estimatedFinalizeSeconds = Math.max(5, (fileStat.size * 2) / (200 * 1024 * 1024));
  let encodingDone = false;
  let finalizingStartedAt = 0;

  // Tick finalizing progress while ffmpeg does its faststart pass
  const finalizingTimer = setInterval(() => {
    if (!encodingDone || finalizingStartedAt === 0) return;
    const elapsed = (Date.now() - finalizingStartedAt) / 1000;
    // Exponential ease-out: ~87% of range at estimated time, asymptotically approaches 99%
    const ratio = 1 - Math.exp(-2 * elapsed / estimatedFinalizeSeconds);
    const pct = Math.round(90 + ratio * 9); // 90 → 99
    onProgress?.(pct, 'finalizing');
  }, 500);

  await new Promise<void>((resolve, reject) => {
    const proc = execFile(FFMPEG, fullArgs, { maxBuffer: 50 * 1024 * 1024 });

    const stderrChunks: string[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && totalDuration > 0) {
          const seconds = parseInt(match[1]) / 1_000_000;
          if (!encodingDone && seconds >= totalDuration * 0.995) {
            // Encoding is effectively done — faststart pass begins
            encodingDone = true;
            finalizingStartedAt = Date.now();
            console.log(`[transcode] Encoding done, faststart starting (est. ${Math.round(estimatedFinalizeSeconds)}s)`);
            onProgress?.(90, 'finalizing');
          } else if (!encodingDone) {
            const pct = Math.min(90, Math.round((seconds / totalDuration) * 90));
            onProgress?.(pct, 'encoding');
          }
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    proc.on('close', (code) => {
      clearInterval(finalizingTimer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = stderrChunks.join('');
        console.error(`[transcode] ffmpeg stderr:\n${stderr}`);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearInterval(finalizingTimer);
      reject(err);
    });
  });

  // File swap phase
  onProgress?.(99, 'replacing');
  await unlink(filePath);
  await rename(tmpPath, filePath);
  onProgress?.(100, 'replacing');
  return filePath;
}

/**
 * Transcode HDR video to SDR using tone mapping.
 * Re-encodes video (H.264, CRF 18) with zscale+tonemap filter chain.
 * Also fixes incompatible audio codecs to AAC in the same pass.
 * Replaces the original file.
 */
async function transcodeHdrToSdr(
  filePath: string,
  onProgress?: (percent: number, phase: TranscodePhase) => void,
): Promise<string> {
  const [{ stdout: durationOut }, fileStat] = await Promise.all([
    execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ]),
    stat(filePath),
  ]);
  const formatData = JSON.parse(durationOut) as { format: { duration?: string } };
  const totalDuration = parseFloat(formatData.format.duration ?? '0');

  const { tracks } = await probeVideoTracks(filePath);

  const ext = path.extname(filePath);
  const tmpPath = filePath.replace(ext, `.transcoding${ext}`);

  // HDR→SDR tone mapping filter chain:
  // 1. zscale to linear light
  // 2. convert to float for tone mapping
  // 3. zscale to BT.709 primaries
  // 4. hable tone mapping
  // 5. zscale to BT.709 transfer/matrix
  // 6. convert back to 8-bit yuv420p
  const vf = [
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');

  const args: string[] = ['-i', filePath, '-map', '0:v'];
  for (let i = 0; i < tracks.length; i++) {
    args.push('-map', `0:a:${i}`);
  }
  // Re-encode video with tone mapping
  args.push('-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium');
  // Handle audio tracks
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].browserCompatible) {
      args.push(`-c:a:${i}`, 'copy');
    } else {
      args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '256k', `-ac:a:${i}`, '2');
    }
  }
  args.push('-map', '0:s?', '-c:s', 'copy');
  args.push('-f', 'mp4', '-movflags', '+faststart', '-y', tmpPath);

  const fullArgs = ['-progress', 'pipe:1', '-nostats', ...args];
  console.log(`[transcode HDR→SDR] Running: ${FFMPEG} ${fullArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

  // HDR→SDR re-encodes video, so output file will be much smaller — estimate conservatively
  const estimatedFinalizeSeconds = Math.max(5, fileStat.size / (400 * 1024 * 1024));
  let encodingDone = false;
  let finalizingStartedAt = 0;

  const finalizingTimer = setInterval(() => {
    if (!encodingDone || finalizingStartedAt === 0) return;
    const elapsed = (Date.now() - finalizingStartedAt) / 1000;
    const ratio = 1 - Math.exp(-2 * elapsed / estimatedFinalizeSeconds);
    const pct = Math.round(90 + ratio * 9);
    onProgress?.(pct, 'finalizing');
  }, 500);

  await new Promise<void>((resolve, reject) => {
    const proc = execFile(FFMPEG, fullArgs, { maxBuffer: 50 * 1024 * 1024 });

    const stderrChunks: string[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && totalDuration > 0) {
          const seconds = parseInt(match[1]) / 1_000_000;
          if (!encodingDone && seconds >= totalDuration * 0.995) {
            encodingDone = true;
            finalizingStartedAt = Date.now();
            console.log(`[transcode HDR→SDR] Encoding done, faststart starting (est. ${Math.round(estimatedFinalizeSeconds)}s)`);
            onProgress?.(90, 'finalizing');
          } else if (!encodingDone) {
            const pct = Math.min(90, Math.round((seconds / totalDuration) * 90));
            onProgress?.(pct, 'encoding');
          }
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    proc.on('close', (code) => {
      clearInterval(finalizingTimer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = stderrChunks.join('');
        console.error(`[transcode HDR→SDR] ffmpeg stderr:\n${stderr}`);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearInterval(finalizingTimer);
      reject(err);
    });
  });

  onProgress?.(99, 'replacing');
  await unlink(filePath);
  await rename(tmpPath, filePath);
  onProgress?.(100, 'replacing');
  return filePath;
}
