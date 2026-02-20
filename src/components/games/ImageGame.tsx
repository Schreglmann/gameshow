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
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <ImageInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: ImageGameQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
}

function ImageInner({ questions, onGameComplete, setNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

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

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

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
          <p style={{ fontWeight: 700 }}>{q.answer}</p>
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
