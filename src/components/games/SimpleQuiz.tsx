import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { SimpleQuizConfig, SimpleQuizQuestion } from '@/types/config';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';
import Timer from '@/components/common/Timer';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';

export default function SimpleQuiz(props: GameComponentProps) {
  const config = props.config as SimpleQuizConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Jede Frage wird gleichzeitig an die Teams gestellt.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <QuizInner
          questions={questions}
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
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function QuizInner({ questions, onGameComplete, setNavHandler, setBackNavHandler }: QuizInnerProps) {
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
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
        setTimerRunning(false);
        setTimerKey(k => k + 1);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

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

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {q.timer && (
        <div style={{ visibility: showAnswer ? 'hidden' : 'visible', height: showAnswer ? 0 : 'auto' }}>
          <Timer
            key={timerKey}
            seconds={q.timer}
            running={timerRunning}
            onComplete={() => setTimerRunning(false)}
          />
        </div>
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
        <div 
          className="quiz-answer" 
        >
          <p>{q.answer}</p>
          {q.answerList && (
            <ul style={{ textAlign: 'left', marginTop: 10, listStyleType: 'none', padding: 0 }}>
              {q.answerList.map((item, i) => (
                <li key={i} style={{ padding: '5px 0' }}>
                  {item}
                </li>
              ))}
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
          {q.answerAudio && (
            <audio controls style={{ marginTop: 15, width: '100%', maxWidth: 400 }}>
              <source src={q.answerAudio} />
            </audio>
          )}
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
