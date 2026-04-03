import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { VideoGuessConfig, VideoGuessQuestion } from '@/types/config';
import { useMusicPlayer } from '@/context/MusicContext';
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

function VideoInner({ questions, videoRef, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  // When navigating back to an already-answered question, play answer segment
  const playAnswerOnLoadRef = useRef(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Clip ${qIdx} von ${questions.length - 1}`;

  // Build video src with audio track selection
  const videoSrc = q ? (q.audioTrack !== undefined
    ? q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`)
    : q.video) : '';

  // Play the question clip (videoStart to videoQuestionEnd)
  const playQuestionClip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q) return;
    video.currentTime = q.videoStart ?? 0;
    video.play().catch(() => {});
  }, [q, videoRef]);

  // Play the answer segment (videoQuestionEnd to videoAnswerEnd)
  const playAnswerSegment = useCallback(() => {
    const video = videoRef.current;
    if (!video || !q || !q.videoAnswerEnd) return;
    video.currentTime = q.videoQuestionEnd ?? 0;
    video.play().catch(() => {});
  }, [q, videoRef]);

  // Stop video at the appropriate end marker
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !q) return;

    const onTimeUpdate = () => {
      if (!showAnswer && q.videoQuestionEnd && video.currentTime >= q.videoQuestionEnd) {
        video.pause();
      }
      if (showAnswer && q.videoAnswerEnd && video.currentTime >= q.videoAnswerEnd) {
        video.pause();
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [q, qIdx, showAnswer, videoRef]);

  // Track loading/buffering state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onWaiting = () => setVideoLoading(true);
    const onReady = () => setVideoLoading(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
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
        if (q.videoAnswerEnd) {
          video.currentTime = q.videoQuestionEnd ?? 0;
          video.play().catch(() => {});
        }
      } else {
        video.currentTime = q.videoStart ?? 0;
        video.play().catch(() => {});
      }
    };

    video.addEventListener('loadedmetadata', seekAndPlay, { once: true });

    return () => {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      video.pause();
    };
  }, [qIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      const video = videoRef.current;
      if (video) {
        video.pause();
        // Auto-play answer segment if videoAnswerEnd is set
        if (q?.videoAnswerEnd) {
          video.currentTime = q.videoQuestionEnd ?? 0;
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
  }, [showAnswer, qIdx, questions.length, onGameComplete, q, videoRef]);

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
        style={{ position: 'relative', width: '100%', maxHeight: '70vh', cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); setEnlarged(true); }}
      >
        <video ref={videoRef} disablePictureInPicture style={{ width: '100%', maxHeight: '70vh', borderRadius: '12px', pointerEvents: 'none' }}>
          <source src={videoSrc} />
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
        src={enlarged ? videoSrc : null}
        videoRef={videoRef}
        onClose={() => setEnlarged(false)}
      />
    </>
  );
}
