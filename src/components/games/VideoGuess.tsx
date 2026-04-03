import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { VideoGuessConfig, VideoGuessQuestion } from '@/types/config';
import { useMusicPlayer } from '@/context/MusicContext';
import { notifyStreamStart, notifyStreamEnd } from '@/services/networkPriority';
import { checkVideoHdr } from '@/services/api';
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
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <VideoInner
          questions={questions}
          videoRef={videoRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: VideoGuessQuestion[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

/** Compute effective video src and time offsets for a question.
 *  For HDR videos: uses /videos-sdr/ segment route, times start at 0.
 *  For SDR videos: uses original video path, times are absolute. */
function useEffectiveVideo(q: VideoGuessQuestion | undefined, isHdr: boolean) {
  return useMemo(() => {
    if (!q) return { src: '', start: 0, questionEnd: undefined as number | undefined, answerEnd: undefined as number | undefined };

    const rawSrc = q.audioTrack !== undefined
      ? q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`)
      : q.video;

    if (!isHdr) {
      return { src: rawSrc, start: q.videoStart ?? 0, questionEnd: q.videoQuestionEnd, answerEnd: q.videoAnswerEnd };
    }

    // HDR: build SDR segment URL with adjusted times
    const segStart = q.videoStart ?? 0;
    const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1; // +1s buffer
    const videoPath = q.video.replace(/^\/videos\//, '');
    const src = `/videos-sdr/${segStart}/${segEnd}/${videoPath}`;

    return {
      src,
      start: 0,
      questionEnd: q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined,
      answerEnd: q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined,
    };
  }, [q, isHdr]);
}

function VideoInner({ questions, videoRef, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  // When navigating back to an already-answered question, play answer segment
  const playAnswerOnLoadRef = useRef(false);
  // HDR detection: set of video paths that are HDR
  const [hdrVideos, setHdrVideos] = useState<Set<string>>(new Set());

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
    });
    return () => { active = false; };
  }, [questions]);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Clip ${qIdx} von ${questions.length - 1}`;

  const isHdr = q ? hdrVideos.has(q.video) : false;
  const ev = useEffectiveVideo(q, isHdr);

  // Play the question clip
  const playQuestionClip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q) return;
    video.currentTime = ev.start;
    video.play().catch(() => {});
  }, [q, videoRef, ev.start]);

  // Play the answer segment
  const playAnswerSegment = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q || !ev.answerEnd) return;
    video.currentTime = ev.questionEnd ?? 0;
    video.play().catch(() => {});
  }, [q, videoRef, ev.questionEnd, ev.answerEnd]);

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
    const onReady = () => setVideoLoading(false);
    const onPlay = () => { if (!notified) { notifyStreamStart(); notified = true; } };
    const onPause = () => { if (notified) { notifyStreamEnd(); notified = false; } };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    return () => {
      if (notified) notifyStreamEnd();
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
    };
  }, [videoRef]);

  // When question changes: reload and seek after metadata is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !q) return;

    video.pause();
    video.load();

    const seekAndPlay = () => {
      if (playAnswerOnLoadRef.current) {
        playAnswerOnLoadRef.current = false;
        if (ev.answerEnd) {
          video.currentTime = ev.questionEnd ?? 0;
          video.play().catch(() => {});
        }
      } else {
        video.currentTime = ev.start;
        video.play().catch(() => {});
      }
    };

    video.addEventListener('loadedmetadata', seekAndPlay, { once: true });

    return () => {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      video.pause();
    };
  }, [qIdx, ev.src]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      const video = videoRef.current;
      if (video) {
        video.pause();
        // Auto-play answer segment if videoAnswerEnd is set
        if (ev.answerEnd) {
          video.currentTime = ev.questionEnd ?? 0;
          video.play().catch(() => {});
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
  }, [showAnswer, qIdx, questions.length, onGameComplete, ev, videoRef]);

  const handleBack = useCallback(() => {
    videoRef.current?.pause();
    if (showAnswer) {
      setShowAnswer(false);
      // Replay question clip when un-revealing
      playQuestionClip();
    } else if (qIdx > 0) {
      // Going back to previous question with answer shown — play answer segment
      playAnswerOnLoadRef.current = true;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
    }
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
          <source src={ev.src} />
        </video>
        {videoLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div className="video-loading-spinner" />
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
