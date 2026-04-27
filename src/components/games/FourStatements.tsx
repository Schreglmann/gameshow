import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FourStatementsConfig, FourStatementsQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

export default function FourStatements(props: GameComponentProps) {
  const config = props.config as FourStatementsConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Errate die Lösung anhand von bis zu 4 Hinweisen.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }) => (
        <CluesInner
          questions={questions}
          gameTitle={config.title}
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
  questions: FourStatementsQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
}

function CluesInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;
  const statements = (q?.statements ?? []).filter(s => s && s.trim());

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer || '—',
      answerImage: q.answerImage,
      extraInfo: `Hinweis ${Math.min(revealedCount, statements.length)}/${statements.length}`,
    });
  }, [qIdx, revealedCount, gameTitle, questions, setGamemasterData, q, statements.length]);

  const handleNext = useCallback(() => {
    if (revealedCount < statements.length) {
      setRevealedCount(prev => prev + 1);
    } else if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setRevealedCount(0);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [revealedCount, statements.length, showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    } else if (revealedCount > 0) {
      setRevealedCount(prev => prev - 1);
      return true;
    } else if (qIdx > 0) {
      const prev = questions[qIdx - 1];
      const prevCount = (prev?.statements ?? []).filter(s => s && s.trim()).length;
      setQIdx(qIdx - 1);
      setRevealedCount(prevCount);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, revealedCount, qIdx, questions]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  useEffect(() => {
    if (!showAnswer) return;
    // The image inside the answer may not have laid out yet when this effect
    // fires, so the scrollHeight would be too small. Retry a handful of times
    // to cover the case where the image's intrinsic size arrives asynchronously.
    const timers: number[] = [];
    const scrollToBottom = () => {
      const target = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo({ top: target, behavior: 'smooth' });
    };
    [0, 80, 200, 500].forEach(delay => {
      timers.push(window.setTimeout(scrollToBottom, delay));
    });
    return () => { timers.forEach(clearTimeout); };
  }, [showAnswer, qIdx]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.topic}</div>

      <div className="statements-container">
        {statements.slice(0, revealedCount).map((stmt, i) => (
          <div key={i} className="statement" style={{ cursor: 'default' }}>
            {stmt}
          </div>
        ))}
      </div>

      {showAnswer && (
        <div className="statements-container" style={{ textAlign: 'center', marginTop: '10px' }}>
          <div style={{ fontSize: '0.85em', color: 'rgba(74, 222, 128, 0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Lösung
          </div>
          {q.answer && (
            <div
              className="statement"
              style={{
                background: 'rgba(74, 222, 128, 0.2)',
                borderColor: 'rgba(74, 222, 128, 0.7)',
                borderWidth: '2px',
                color: '#4ade80',
                cursor: 'default',
                fontSize: '2em',
                fontWeight: 700,
                textAlign: 'center',
                letterSpacing: '0.02em',
              }}
            >
              {q.answer}
            </div>
          )}
          {q.answerImage && (
            <img
              src={q.answerImage}
              alt=""
              className="quiz-image"
              style={{ marginTop: '16px' }}
              onLoad={() => {
                const target = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
                window.scrollTo({ top: target, behavior: 'smooth' });
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
