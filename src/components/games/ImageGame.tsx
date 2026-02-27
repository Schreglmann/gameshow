import { useState, useEffect, useCallback } from 'react';
import type { GameComponentProps } from './types';
import type { ImageGameConfig, ImageGameQuestion } from '@/types/config';
import BaseGameWrapper from './BaseGameWrapper';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';

export default function ImageGame(props: GameComponentProps) {
  const config = props.config as ImageGameConfig;
  const questions = config.questions || [];
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Erkennt das Bild!']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <ImageInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: ImageGameQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function ImageInner({ questions, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

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

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Bild ${qIdx} von ${questions.length - 1}`;

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

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

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <img
        src={q.image}
        alt=""
        className="quiz-image"
        onClick={() => openLightbox(q.image)}
      />

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
