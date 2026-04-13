// Shared preview-source resolver — used by the in-game player (VideoGuess), the editor
// marker preview (VideoGuessForm), and the DAM video detail modal (AssetsTab). Keeps all
// three clients on the same cache-based mechanic so we don't drift into per-surface hacks
// like separate audio streams or live-transcode fallbacks. See specs/video-caching.md.

/**
 * Input: a question-like object with a `video` path and optional markers/track.
 * Output: the URL to put in a `<source src=…>` plus the time offsets to use inside that URL.
 *
 * Rules (mirroring server/index.ts endpoints):
 *   - HDR + time range → `/videos-sdr/{segStart}/{segEnd}/{path}?track=N` (tone-mapped cache)
 *   - SDR + time range → `/videos-compressed/{segStart}/{segEnd}/{path}?track=N`
 *   - Any + only track  → `/videos-track/{N}/{path}` (fast stream-copy cache)
 *   - Otherwise         → original `/videos/{path}` direct-play
 *
 * When the caller is the in-game player it should pass `{ strict: true }` so the cache-only
 * endpoints append `?strict=1` — a cache miss then returns 404 instead of spawning ffmpeg,
 * so the show never stutters mid-clip.
 */
export interface PreviewQuestion {
  video: string;
  videoStart?: number;
  videoQuestionEnd?: number;
  videoAnswerEnd?: number;
  audioTrack?: number;
}

export interface PreviewSrc {
  /** URL for `<source src=…>` / video.src. Empty string if the question has no video. */
  src: string;
  /** Time offset (seconds) in the returned media where playback should start. For segment
   *  caches this is 0 (the file IS the segment). For full-file playback it's the marker. */
  start: number;
  /** Offsets for question/answer end markers, re-based against `start`. Undefined when the
   *  caller can stop listening to these (e.g. no markers configured). */
  questionEnd: number | undefined;
  answerEnd: number | undefined;
  /** Which cache endpoint was selected (or 'track'/'original'). Useful for diagnostics and
   *  for deciding which warmup endpoint to call if the cache is missing. */
  kind: 'sdr' | 'compressed' | 'track' | 'original';
}

export interface PreviewSrcOptions {
  /** Whether the file is HDR. The caller is responsible for probing this (see checkVideoHdr). */
  isHdr: boolean;
  /** In-game player passes `true` so missing caches surface as 404 instead of live ffmpeg.
   *  Editor/DAM pass `false` so the first preview play kicks off the cache generation. */
  strict?: boolean;
}

export function getPreviewSrc(q: PreviewQuestion | undefined, opts: PreviewSrcOptions): PreviewSrc {
  if (!q || !q.video) return { src: '', start: 0, questionEnd: undefined, answerEnd: undefined, kind: 'original' };

  const segStart = q.videoStart ?? 0;
  const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1; // +1s buffer
  const videoPath = q.video.replace(/^\/videos\//, '');
  const trackQuery = q.audioTrack !== undefined ? `track=${q.audioTrack}&` : '';
  const strictQuery = opts.strict ? 'strict=1' : '';
  const qs = (trackQuery + strictQuery).replace(/&$/, '');
  const querySuffix = qs ? `?${qs}` : '';

  const hasTimeRange = q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;

  if (opts.isHdr && hasTimeRange) {
    return {
      src: `/videos-sdr/${segStart}/${segEnd}/${videoPath}${querySuffix}`,
      start: 0,
      questionEnd: q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined,
      answerEnd: q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined,
      kind: 'sdr',
    };
  }

  if (hasTimeRange) {
    return {
      src: `/videos-compressed/${segStart}/${segEnd}/${videoPath}${querySuffix}`,
      start: 0,
      questionEnd: q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined,
      answerEnd: q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined,
      kind: 'compressed',
    };
  }

  // No markers: if a track is selected we serve the track-remux cache (stream-copy, fast);
  // otherwise the original file directly. No `strict` needed — these paths don't re-encode.
  if (q.audioTrack !== undefined) {
    return {
      src: q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`),
      start: q.videoStart ?? 0,
      questionEnd: q.videoQuestionEnd,
      answerEnd: q.videoAnswerEnd,
      kind: 'track',
    };
  }

  return {
    src: q.video,
    start: q.videoStart ?? 0,
    questionEnd: q.videoQuestionEnd,
    answerEnd: q.videoAnswerEnd,
    kind: 'original',
  };
}
