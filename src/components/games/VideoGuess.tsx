import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { VideoGuessConfig, VideoGuessQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useMusicPlayer } from '@/context/MusicContext';
import { notifyStreamStart, notifyStreamEnd } from '@/services/networkPriority';
import { checkVideoHdr } from '@/services/api';
import { useEnsureSegmentCache } from '@/services/useEnsureSegmentCache';
import BaseGameWrapper from './BaseGameWrapper';
import { VideoLightbox } from '@/components/layout/Lightbox';

export default function VideoGuess(props: GameComponentProps) {
  const config = props.config as VideoGuessConfig;
  const questions = useMemo(
    () => {
      const all = config.questions || [];
      if (all.length === 0) return all;
      return [all[0], ...all.slice(1).filter(q => !q.disabled)];
    },
    [config.questions]
  );
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const music = useMusicPlayer();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Stop video when navigating away
  useEffect(() => {
    return () => {
      videoRef.current?.pause();
    };
  }, []);

  const handleNextShow = () => {
    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
    }
    setTimeout(() => music.fadeIn(3000), 500);
  };

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Erkennt den Film anhand eines kurzen Ausschnittes.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }) => (
        <VideoInner
          questions={questions}
          gameTitle={config.title}
          videoRef={videoRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: VideoGuessQuestion[];
  gameTitle: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
}

/** Compute effective video src and time offsets for a question.
 *  Uses pre-cached endpoints for reliable gameshow playback:
 *  - HDR videos: /videos-sdr/ (tone-mapped segment)
 *  - SDR with time ranges: /videos-compressed/ (re-encoded segment)
 *  - SDR without time ranges: original file or /videos-track/ for audio track selection */
function useEffectiveVideo(q: VideoGuessQuestion | undefined, isHdr: boolean, hdrProbeComplete: boolean) {
  return useMemo(() => {
    if (!q || !hdrProbeComplete) return { src: '', start: 0, questionEnd: undefined as number | undefined, answerEnd: undefined as number | undefined };

    const segStart = q.videoStart ?? 0;
    const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1; // +1s buffer
    const videoPath = q.video.replace(/^\/videos\//, '');
    const trackQuery = q.audioTrack !== undefined ? `track=${q.audioTrack}&` : '';

    if (isHdr) {
      // strict=1: in-game player never triggers live ffmpeg; cache miss → 404 + X-Cache-Status.
      const src = `/videos-sdr/${segStart}/${segEnd}/${videoPath}?${trackQuery}strict=1`;
      return {
        src,
        start: 0,
        questionEnd: q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined,
        answerEnd: q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined,
      };
    }

    const hasTimeRange = q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
    if (hasTimeRange) {
      const src = `/videos-compressed/${segStart}/${segEnd}/${videoPath}?${trackQuery}strict=1`;
      return {
        src,
        start: 0,
        questionEnd: q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined,
        answerEnd: q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined,
      };
    }

    // No time ranges: serve original or track-selected — track remux is stream-copy so
    // on-demand generation is fast enough that strict=1 isn't needed here.
    const rawSrc = q.audioTrack !== undefined
      ? q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`)
      : q.video;
    return { src: rawSrc, start: q.videoStart ?? 0, questionEnd: q.videoQuestionEnd, answerEnd: q.videoAnswerEnd };
  }, [q, isHdr, hdrProbeComplete]);
}

function VideoInner({ questions, gameTitle, videoRef, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  // When navigating back to an already-answered question, play answer segment
  const playAnswerOnLoadRef = useRef(false);
  // HDR detection: set of video paths that are HDR
  const [hdrVideos, setHdrVideos] = useState<Set<string>>(new Set());
  const [hdrProbeComplete, setHdrProbeComplete] = useState(false);
  // Warmup state (0–100 percent during generation, null when cache is ready or no cache
  // needed) is owned by `useEnsureSegmentCache` — see the hook call below. Values flow here
  // and into the progress overlay in the JSX.

  // Probe each unique video path for HDR on mount
  useEffect(() => {
    const paths = [...new Set(questions.map(q => q.video))];
    let active = true;
    Promise.all(paths.map(async p => {
      const isHdr = await checkVideoHdr(p);
      return { path: p, isHdr };
    })).then(results => {
      if (!active) return;
      const hdr = new Set<string>();
      for (const r of results) if (r.isHdr) hdr.add(r.path);
      if (hdr.size > 0) setHdrVideos(hdr);
      setHdrProbeComplete(true);
    }).catch(() => {
      if (active) setHdrProbeComplete(true);
    });
    return () => { active = false; };
  }, [questions]);

  /** Try to play the video; fall back to muted autoplay + unmute if blocked.
   *  If play fails because data isn't available yet, retry on canplay. */
  const safePlay = useCallback((video: HTMLVideoElement) => {
    const attempt = () => {
      video.play().catch(() => {
        // Autoplay blocked — try muted (always allowed), then unmute
        video.muted = true;
        video.play().then(() => { video.muted = false; }).catch(() => {
          // Still failing (no data yet) — retry once when enough data is buffered
          video.addEventListener('canplay', () => {
            video.muted = false;
            video.play().catch(() => {});
          }, { once: true });
        });
      });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      attempt();
    } else {
      // Stream hasn't buffered enough yet — wait for canplay before attempting
      video.addEventListener('canplay', attempt, { once: true });
    }
  }, []);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Clip ${qIdx} von ${questions.length - 1}`;

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const isHdr = q ? hdrVideos.has(q.video) : false;
  const ev = useEffectiveVideo(q, isHdr, hdrProbeComplete);

  // Segment-cache readiness for the current question. If the cache is missing we show a
  // progress overlay while `useEnsureSegmentCache` fires the warmup SSE. Only enabled when
  // the effective src is a strict cache URL — clips without markers play the raw file
  // directly (no cache needed).
  const cacheEnabled = !!(q && ev.src.includes('strict=1'));
  const segStart = q?.videoStart ?? 0;
  const segEnd = q ? Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1 : 0;
  const { warmupProgress, warmupError } = useEnsureSegmentCache({
    video: q?.video,
    start: segStart,
    end: segEnd,
    track: q?.audioTrack,
    isHdr,
    enabled: cacheEnabled,
  });

  // Play the question clip
  const playQuestionClip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q) return;
    video.currentTime = ev.start;
    safePlay(video);
  }, [q, videoRef, ev.start, safePlay]);

  // Play the answer segment
  const playAnswerSegment = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q || !ev.answerEnd) return;
    video.currentTime = ev.questionEnd ?? 0;
    safePlay(video);
  }, [q, videoRef, ev.questionEnd, ev.answerEnd, safePlay]);

  // Stop video at the appropriate end marker
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !q) return;

    const onTimeUpdate = () => {
      if (!showAnswer && ev.questionEnd && video.currentTime >= ev.questionEnd) {
        video.pause();
      }
      if (showAnswer && ev.answerEnd && video.currentTime >= ev.answerEnd) {
        video.pause();
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [q, qIdx, showAnswer, videoRef, ev.questionEnd, ev.answerEnd]);

  // Track loading/buffering state + network priority
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let notified = false;
    const onWaiting = () => setVideoLoading(true);
    const onReady = () => { setVideoLoading(false); setVideoError(null); };
    const onPlay = () => { if (!notified) { notifyStreamStart(); notified = true; } };
    const onPause = () => { if (notified) { notifyStreamEnd(); notified = false; } };
    const onError = () => {
      setVideoLoading(false);
      const e = video.error;
      const code = e?.code ?? 0;
      const detail = e?.message ? ` (${e.message})` : '';
      const msgs: Record<number, string> = {
        1: 'Wiedergabe abgebrochen',
        2: 'Netzwerkfehler beim Laden des Videos',
        3: 'Video konnte nicht dekodiert werden — möglicherweise wird das Format nicht unterstützt',
        4: 'Videoformat wird nicht unterstützt',
      };
      setVideoError((msgs[code] ?? 'Unbekannter Wiedergabefehler') + detail);
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('error', onError);
    return () => {
      if (notified) notifyStreamEnd();
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('error', onError);
    };
  }, [videoRef]);

  // Surface warmup errors as the player's video-error state so the operator sees one
  // consistent message box instead of a silent overlay.
  useEffect(() => {
    if (warmupError) setVideoError(`Cache konnte nicht erzeugt werden: ${warmupError}`);
  }, [warmupError]);

  // When question changes (or warmup finishes): reload the `<source>` and seek to the right
  // timestamp. We intentionally wait until `warmupProgress === null` so the first load is
  // against a populated cache — if we `video.load()` during warmup, the browser would fetch
  // the strict URL and get 404, triggering a `<video>` error.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !q || !ev.src) return;
    if (warmupProgress !== null) return; // cache still generating — hook will flip this

    video.pause();
    setVideoError(null);

    const seekAndPlay = () => {
      if (playAnswerOnLoadRef.current) {
        playAnswerOnLoadRef.current = false;
        if (ev.answerEnd) {
          video.currentTime = ev.questionEnd ?? 0;
          safePlay(video);
        }
      } else {
        video.currentTime = ev.start;
        safePlay(video);
      }
    };

    // Register listener BEFORE load() to avoid race with cached metadata.
    video.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    video.load();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      seekAndPlay();
    }

    return () => {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      video.pause();
    };
  }, [qIdx, ev.src, warmupProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      const video = videoRef.current;
      if (video) {
        video.pause();
        // Auto-play answer segment if videoAnswerEnd is set
        if (ev.answerEnd) {
          video.currentTime = ev.questionEnd ?? 0;
          safePlay(video);
        }
      }
    } else {
      if (qIdx < questions.length - 1) {
        videoRef.current?.pause();
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        videoRef.current?.pause();
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete, ev, videoRef, safePlay]);

  const handleBack = useCallback((): boolean => {
    videoRef.current?.pause();
    if (showAnswer) {
      setShowAnswer(false);
      // Replay question clip when un-revealing
      playQuestionClip();
      return true;
    } else if (qIdx > 0) {
      // Going back to previous question with answer shown — play answer segment
      playAnswerOnLoadRef.current = true;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx, playQuestionClip, videoRef]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <div
        style={{ position: 'relative', width: '100%', maxHeight: '70vh', cursor: 'pointer', borderRadius: '12px', overflow: 'hidden' }}
        onClick={e => { e.stopPropagation(); setEnlarged(true); }}
      >
        <video ref={videoRef} disablePictureInPicture style={{ width: '100%', maxHeight: '70vh', display: 'block', pointerEvents: 'none' }}>
          {ev.src && <source src={ev.src} />}
        </video>
        {warmupProgress !== null && !videoError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', padding: '2rem', gap: '1rem' }}>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '1.1rem', textAlign: 'center', margin: 0 }}>
              Video-Cache wird erzeugt…
            </p>
            <div style={{ width: 'min(60%, 400px)', height: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${warmupProgress}%`, background: `linear-gradient(90deg, var(--admin-accent), var(--admin-accent-light))`, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.9rem', fontFamily: 'monospace', margin: 0 }}>
              {warmupProgress}%
            </p>
          </div>
        )}
        {videoLoading && warmupProgress === null && !videoError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div className="video-loading-spinner" />
          </div>
        )}
        {videoError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', padding: '2rem' }}>
            <p style={{ color: 'var(--error-light)', fontSize: '1.2rem', textAlign: 'center', margin: 0 }}>⚠️ {videoError}</p>
          </div>
        )}
      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
          {q.answerImage && (
            <img src={q.answerImage} alt="" className="quiz-image" />
          )}
        </div>
      )}

      <VideoLightbox
        src={enlarged ? ev.src : null}
        videoRef={videoRef}
        onClose={() => setEnlarged(false)}
      />
    </>
  );
}
