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

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const hasAudio = questions.some(q => q.answerAudio);

  // Stop audio when this component unmounts (navigating away)
  useEffect(() => {
    return () => {
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
    };
  }, []);

  const handleNextShow = hasAudio
    ? () => {
        // Fade out answer audio
        const audio = answerAudioRef.current;
        if (audio && !audio.paused) {
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
        }
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
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function QuizInner({ questions, answerAudioRef, onGameComplete, setNavHandler, setBackNavHandler }: QuizInnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  const q = questions[qIdx];
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
    } else {
      if (qIdx < questions.length - 1) {
        // Stop answer audio immediately when moving to the next question
        answerAudioRef.current?.pause();
        answerAudioRef.current = null;
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
        setTimerRunning(false);
        setTimerKey(k => k + 1);
      } else {
        // Last question: let audio keep playing until "next game" is pressed (unmount)
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions, onGameComplete]);

  // Back nav
  const handleBack = useCallback(() => {
    if (showAnswer) {
      setShowAnswer(false);
    } else if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
    }
  }, [showAnswer, qIdx]);

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
      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      document.documentElement.scrollTo({ top: scrollHeight, behavior: 'smooth' });
      document.body.scrollTo({ top: scrollHeight, behavior: 'smooth' });
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

      {q.questionImage && (
        <img
          src={q.questionImage}
          alt=""
          className="quiz-image"
          onClick={() => openLightbox(q.questionImage!)}
        />
      )}

      {showAnswer && (
        <div className="quiz-answer">
          {!q.answerList && <p>{q.answer}</p>}
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
          {q.answerImage && (
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
    </>
  );
}
