import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FourStatementsConfig, FourStatementsQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand } from '@/types/game';
import { randomizeQuestions } from '@/utils/questions';
import { useArrowRightLongPress } from '@/hooks/useArrowRightLongPress';
import { toMediaSrc } from '@/utils/assetUrl';
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
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler, setAnswerRevealed }) => (
        <CluesInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setCommandHandler={setCommandHandler}
          setAnswerRevealed={setAnswerRevealed}
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
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function CluesInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler, setAnswerRevealed }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;
  const statements = (q?.statements ?? []).filter(s => s && s.trim());

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer || '—',
      answerImage: q.answerImage,
      extraInfo: `Hinweis ${Math.min(revealedCount, statements.length)}/${statements.length}`,
      nextAnswer: nextQ ? { answer: nextQ.answer || '—' } : undefined,
    });
  }, [qIdx, revealedCount, gameTitle, questions, setGamemasterData, q, statements.length]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

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

  // Reveal every clue and the answer at once — the jump-to-solution shortcut.
  const revealAll = useCallback(() => {
    setRevealedCount(statements.length);
    setShowAnswer(true);
  }, [statements.length]);

  // Short ArrowRight tap advances one step; holding it (≥500 ms) jumps straight
  // to the full solution (all clues + answer), like Bandle. Disabled once the
  // answer is shown so the key falls through to the normal "next question" nav.
  useArrowRightLongPress({
    enabled: !showAnswer,
    onShortPress: handleNext,
    onLongPress: revealAll,
  });

  // A long-press ArrowRight on the gamemaster arrives as `nav-forward-long`.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward-long' && !showAnswer) {
      revealAll();
    }
  }, [revealAll, showAnswer]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

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
              src={toMediaSrc(q.answerImage)}
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
