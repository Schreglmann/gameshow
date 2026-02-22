import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { GameComponentProps } from './types';
import type { SimpleQuizConfig, SimpleQuizQuestion } from '@/types/config';
import { randomizeQuestions } from '@/utils/questions';
import { useMusicPlayer } from '@/context/MusicContext';
import BaseGameWrapper from './BaseGameWrapper';
import Timer from '@/components/common/Timer';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';

export default function SimpleQuiz(props: GameComponentProps) {
  const config = props.config as SimpleQuizConfig;
  const music = useMusicPlayer();
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const hasAudio = questions.some(q => q.answerAudio || q.questionAudio);

  // Stop audio when this component unmounts (navigating away)
  useEffect(() => {
    return () => {
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
    };
  }, []);

  const fadeAudio = (audio: HTMLAudioElement) => {
    if (audio.paused) return;
    const startVolume = audio.volume;
    const duration = 2000;
    const steps = 40;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        clearInterval(timer);
        audio.pause();
      }
    }, interval);
  };

  const handleNextShow = hasAudio
    ? () => {
        // Fade out answer audio and question audio
        if (answerAudioRef.current) fadeAudio(answerAudioRef.current);
        if (questionAudioRef.current) fadeAudio(questionAudioRef.current);
        // Fade background music back in
        setTimeout(() => music.fadeIn(3000), 500);
      }
    : undefined;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Jede Frage wird gleichzeitig an die Teams gestellt.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      onRulesShow={hasAudio ? () => music.fadeOut(2000) : undefined}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <QuizInner
          questions={questions}
          answerAudioRef={answerAudioRef}
          questionAudioRef={questionAudioRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface QuizInnerProps {
  questions: SimpleQuizQuestion[];
  answerAudioRef: React.RefObject<HTMLAudioElement | null>;
  questionAudioRef: React.RefObject<HTMLAudioElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function QuizInner({ questions, answerAudioRef, questionAudioRef, onGameComplete, setNavHandler, setBackNavHandler }: QuizInnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();
  const bottomRef = useRef<HTMLDivElement>(null);
  const q = questions[qIdx];

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleAudioPlayPause = () => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const handleAudioRestart = () => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;

  // Check if the question text is purely emojis (for large emoji display)
  const isEmojiOnly = useMemo(() => {
    if (!q) return false;
    const stripped = q.question.replace(/[\s\uFE0F]/g, '');
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u;
    return emojiRegex.test(stripped);
  }, [q]);

  // Forward nav
  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      setTimerRunning(false);
      // Stop question audio only if answer audio will take over; otherwise keep it playing
      if (q?.answerAudio) {
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
      }
    } else {
      if (qIdx < questions.length - 1) {
        // Stop both audios immediately when moving to the next question
        answerAudioRef.current?.pause();
        answerAudioRef.current = null;
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
        setTimerRunning(false);
        setTimerKey(k => k + 1);
      } else {
        // Last question: let audio keep playing until "next game" is pressed (unmount)
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions, q, onGameComplete]);

  // Back nav
  const handleBack = useCallback(() => {
    if (showAnswer) {
      // Stop answer audio
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      // Restart question audio from the beginning
      if (q?.questionAudio) {
        questionAudioRef.current?.pause();
        const audio = new Audio(q.questionAudio);
        audio.volume = 1;
        questionAudioRef.current = audio;
        setAudioCurrentTime(0);
        setAudioDuration(0);
        audio.addEventListener('timeupdate', () => setAudioCurrentTime(audio.currentTime));
        audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('durationchange', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('play', () => setAudioPlaying(true));
        audio.addEventListener('pause', () => setAudioPlaying(false));
        setAudioCurrentTime(0);
        setAudioDuration(0);
        setAudioPlaying(false);
        audio.play().catch(() => {});
      }
      setShowAnswer(false);
    } else if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
    }
  }, [showAnswer, qIdx, q, questionAudioRef, answerAudioRef]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Start timer when showing a question that has one
  useEffect(() => {
    if (q?.timer && !showAnswer) {
      setTimerRunning(true);
    }
  }, [qIdx, q?.timer, showAnswer]);

  // Scroll to top when a new question is shown
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  // Scroll to bottom when answer is revealed
  useEffect(() => {
    if (showAnswer) {
      // Use setTimeout to ensure the browser has fully laid out the answer content
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    }
  }, [showAnswer]);

  // Auto-play answer audio when answer is revealed.
  // No cleanup here — audio intentionally keeps playing when advancing questions.
  useEffect(() => {
    if (showAnswer && q?.answerAudio) {
      // Stop any previously playing audio before starting a new one
      answerAudioRef.current?.pause();
      const audio = new Audio(q.answerAudio);
      audio.volume = 1;
      answerAudioRef.current = audio;
      audio.play().catch(() => {});
    }
  }, [showAnswer, q?.answerAudio, answerAudioRef]);

  // Auto-play question audio when a new question is shown
  useEffect(() => {
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioPlaying(false);
    if (q?.questionAudio) {
      questionAudioRef.current?.pause();
      const audio = new Audio(q.questionAudio);
      audio.volume = 1;
      questionAudioRef.current = audio;
      const onTimeUpdate = () => setAudioCurrentTime(audio.currentTime);
      const onDuration = () => setAudioDuration(audio.duration || 0);
      const onPlay = () => setAudioPlaying(true);
      const onPause = () => setAudioPlaying(false);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('durationchange', onDuration);
      audio.addEventListener('loadedmetadata', onDuration);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.play().catch(() => {});
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('durationchange', onDuration);
        audio.removeEventListener('loadedmetadata', onDuration);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.pause();
        questionAudioRef.current = null;
      };
    }
    return () => {
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, q?.questionAudio]); // intentionally excludes showAnswer — audio keeps playing while answer is shown

  // (Cleanup on unmount is handled by the outer SimpleQuiz component)

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {q.timer && !showAnswer && createPortal(
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem', zIndex: 9999 }}>
          <Timer
            key={timerKey}
            seconds={q.timer}
            running={timerRunning}
            onComplete={() => setTimerRunning(false)}
          />
        </div>,
        document.body
      )}

      <div
        className="quiz-question"
        style={isEmojiOnly ? { fontSize: '6em', lineHeight: 1.2 } : undefined}
      >
        {q.question}
      </div>

      {q.questionAudio && audioDuration > 0 && (
        <div className="audio-controls">
          <span className="audio-timestamp">
            {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
          </span>
          <span className="audio-ctrl-divider" />
          <button
            className="audio-ctrl-btn"
            onClick={handleAudioPlayPause}
            title={audioPlaying ? 'Pause' : 'Abspielen'}
            aria-label={audioPlaying ? 'Pause' : 'Abspielen'}
          >
            {audioPlaying ? (
              <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                <rect x="0" y="0" width="4" height="14" rx="1" />
                <rect x="8" y="0" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                <polygon points="0,0 12,7 0,14" />
              </svg>
            )}
          </button>
          <button
            className="audio-ctrl-btn"
            onClick={handleAudioRestart}
            title="Von vorne"
            aria-label="Von vorne abspielen"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
              <rect x="0" y="0" width="2.5" height="14" rx="1" />
              <polygon points="14,0 3,7 14,14" />
            </svg>
          </button>
        </div>
      )}

      {q.questionImage && (
        <img
          src={showAnswer && q.replaceImage && q.answerImage ? q.answerImage : q.questionImage}
          alt=""
          className="quiz-image"
          onClick={() => openLightbox((showAnswer && q.replaceImage && q.answerImage ? q.answerImage : q.questionImage)!)}
        />
      )}

      {showAnswer && !(q.replaceImage && !q.answer && !q.answerList) && (
        <div className="quiz-answer">
          {!q.answerList && q.answer && <p>{q.answer}</p>}
          {q.answerList && (
            <ul className="answer-list">
              {q.answerList.map((item, i) => {
                // Match if item includes answer, or if item without number prefix matches answer
                const itemWithoutNumber = item.replace(/^\d+\.\s*/, '');
                const isCorrect = item === q.answer || itemWithoutNumber === q.answer || item.includes(q.answer);
                return (
                  <li key={i} className={isCorrect ? 'correct' : ''}>
                    {item}
                  </li>
                );
              })}
            </ul>
          )}
          {q.answerImage && !q.replaceImage && (
            <img
              src={q.answerImage}
              alt=""
              className="quiz-image"
              onClick={() => openLightbox(q.answerImage!)}
            />
          )}
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
      <div ref={bottomRef} />
    </>
  );
}
