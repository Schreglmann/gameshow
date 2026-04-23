import type { VideoGuessConfig } from '../src/types/config.js';
import type { VideoTrackInfo } from './video-probe.js';

export type VideoProbeFn = (relPath: string) => Promise<{ tracks: VideoTrackInfo[] }>;

/** For a video-guess instance, probe each video and fill in `audioTrack` for questions
 *  that don't have one explicit. Resolution order:
 *    1. Explicit `q.audioTrack` is never overwritten.
 *    2. If `cfg.language` is set: first audio stream whose ffprobe `language` tag
 *       matches. If no track matches, `audioTrack` is left undefined (file-default
 *       stream — preserves the "⚠ Datei-Standard" admin warning contract).
 *    3. If `cfg.language` is unset: audio stream `0` (first track) for deterministic
 *       playback and cache alignment.
 *  Probe failures and videos with zero audio streams leave `audioTrack` undefined. */
export async function resolveVideoGuessLanguage(
  cfg: VideoGuessConfig,
  probe: VideoProbeFn,
): Promise<void> {
  const lang = cfg.language;
  const cache = new Map<string, number | null>();
  for (const q of cfg.questions) {
    if (q.audioTrack !== undefined || !q.video) continue;
    const relPath = q.video.replace(/^\/videos\//, '');
    let trackIdx = cache.get(relPath);
    if (trackIdx === undefined) {
      trackIdx = null;
      try {
        const { tracks } = await probe(relPath);
        if (tracks.length > 0) {
          if (lang) {
            const idx = tracks.findIndex(t => t.language === lang);
            if (idx >= 0) trackIdx = idx;
          } else {
            trackIdx = 0;
          }
        }
      } catch {
        // Probe failed — leave audioTrack undefined so the file's default stream plays.
      }
      cache.set(relPath, trackIdx);
    }
    if (trackIdx !== null) q.audioTrack = trackIdx;
  }
}
