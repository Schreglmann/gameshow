/**
 * Video probing utilities. Uses ffprobe to inspect audio tracks + video stream metadata,
 * and exposes the HDR→SDR tone-map filter string used by the segment-cache encoder.
 *
 * Full-file transcoding (HDR→SDR and audio→AAC for whole files) was removed: the cache
 * mechanic — track-remux + segment cache — covers every prior use case. See
 * specs/video-caching.md §dead-paths.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);
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
  /** MaxCLL (Maximum Content Light Level) in nits, from content light level metadata. */
  maxCLL: number;
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
  // Single ffprobe call for all streams + format (instead of two separate calls)
  const [probeOut, fileStat] = await Promise.all([
    execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-show_format',
      filePath,
    ]),
    stat(filePath),
  ]);

  const probeData = JSON.parse(probeOut.stdout) as {
    streams: Record<string, unknown>[];
    format?: Record<string, string>;
  };

  const audioStreams = (probeData.streams || []).filter(s => s.codec_type === 'audio');
  const tracks: VideoTrackInfo[] = audioStreams.map((s) => {
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

  const vs = (probeData.streams || []).find(s => s.codec_type === 'video') ?? null;
  const fmt = probeData.format;
  const colorTransfer = (vs?.color_transfer as string) ?? '';
  const colorPrimaries = (vs?.color_primaries as string) ?? '';
  const pixFmt = (vs?.pix_fmt as string) ?? '';
  // HDR detection: PQ (smpte2084) or HLG (arib-std-b67) transfer with BT.2020 primaries
  const isHdr = (colorTransfer === 'smpte2084' || colorTransfer === 'arib-std-b67')
    && colorPrimaries === 'bt2020';

  // Extract MaxCLL from content light level metadata, or fall back to mastering display max_luminance
  let maxCLL = 0;
  const sideDataList = (vs?.side_data_list as Array<Record<string, unknown>>) ?? [];
  for (const sd of sideDataList) {
    if (sd.side_data_type === 'Content light level metadata') {
      maxCLL = (sd.max_content as number) || 0;
      break;
    }
  }
  if (!maxCLL) {
    for (const sd of sideDataList) {
      if (sd.side_data_type === 'Mastering display metadata' && sd.max_luminance) {
        const lum = String(sd.max_luminance);
        const [num, den] = lum.split('/').map(Number);
        maxCLL = den ? num / den : num || 0;
        break;
      }
    }
  }

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
    maxCLL,
  } : null;

  const needsTranscode = tracks.length > 0 && tracks.some(t => !t.browserCompatible);
  return { tracks, needsTranscode, videoInfo };
}

/**
 * Build the HDR→SDR tone mapping video filter chain.
 * Uses MaxCLL (or mastering display peak) to set the correct `peak` so the
 * tonemapper doesn't over-compress the luminance range (which causes flat/grey output).
 *
 * @param maxCLL Maximum Content Light Level in nits (0 = unknown → default 1000)
 */
export function buildTonemapVf(maxCLL: number): string {
  const SDR_NPL = 100; // nominal peak luminance for SDR (nits)
  const effectivePeak = maxCLL > 0 ? maxCLL : 1000; // default to 1000 nits if unknown
  const peak = effectivePeak / SDR_NPL;
  return [
    `zscale=t=linear:npl=${SDR_NPL}`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    `tonemap=tonemap=hable:desat=0:peak=${peak}`,
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');
}

