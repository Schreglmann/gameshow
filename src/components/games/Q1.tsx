import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { Q1Config, Q1Question } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { mulberry32 } from '@/utils/questions';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';

interface ShuffledStatement {
  text: string;
  isWrong: boolean;
}

// Seeded off the question's slot: a fresh order each playthrough, but stable
// across a live edit. An unseeded shuffle here re-scrambled the statements of
// the question on screen on every admin save — and, because the shuffle also
// decides where the wrong statement sits, it moved the answer mid-question.
// See specs/live-question-order.md.
function shuffleStatements(q: Q1Question, seed: number): ShuffledStatement[] {
  const statements: ShuffledStatement[] = [
    ...q.trueStatements.map(s => ({ text: s, isWrong: false })),
    { text: q.wrongStatement, isWrong: true },
  ];
  const rand = mulberry32(seed);
  for (let i = statements.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [statements[i], statements[j]] = [statements[j]!, statements[i]!];
  }
  return statements;
}

export default function Q1(props: GameComponentProps) {
  const config = props.config as Q1Config;

  const { questions, order } = useQuestionOrder(config.questions, config.randomizeQuestions, undefined, props.gameId);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Findet die falsche Aussage.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
      order={order}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setAnswerRevealed }) => (
        <StatementsInner
          questions={questions}
          order={order}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: Q1Question[];
  order: QuestionOrderHandle;
  resumeAtEnd: boolean;
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function StatementsInner({ questions, order, resumeAtEnd, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setAnswerRevealed }: InnerProps) {
  // Resuming (back-navigation): open at the last question, all statements
  // revealed and the answer shown.
  const lastIdx = resumeAtEnd ? order.resumeIndex : 0;
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  const [revealedCount, setRevealedCount] = useState(() =>
    resumeAtEnd && questions[lastIdx] ? questions[lastIdx]!.trueStatements.length + 1 : 0,
  );
  const [showAnswer, setShowAnswer] = useState(resumeAtEnd);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.Frage,
      answer: q.answer || '—',
      extraInfo: 'Falsch: ' + q.wrongStatement,
      nextAnswer: nextQ ? { question: nextQ.Frage, answer: nextQ.answer || '—' } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  // Shuffle statements once per question. The ORDER is seeded off the slot, so
  // it stays stable across live edits; the CONTENT must still follow `q`.
  // Memoising on the seed alone meant a typo fix made in the admin mid-show
  // never reached the screen — the memo kept returning the pre-edit statements.
  const statementSeed = order.slotSeed(qIdx);
  const shuffled = useMemo(() => {
    if (!q) return [];
    return shuffleStatements(q, statementSeed);
  }, [q, statementSeed]);

  const handleNext = useCallback(() => {
    if (revealedCount < shuffled.length) {
      // Progressively reveal statements
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
  }, [revealedCount, shuffled.length, showAnswer, qIdx, questions.length, onGameComplete, setQIdx]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    } else if (revealedCount > 0) {
      setRevealedCount(prev => prev - 1);
      return true;
    } else if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setRevealedCount(shuffled.length);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, revealedCount, qIdx, shuffled.length, setQIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Scroll the card just below the sticky header when the question + revealed
  // statements grow taller than the viewport — same behaviour as SimpleQuiz.
  // Disabled on reveal so the scroll-to-bottom effect below owns the answer view.
  useQuizAutoScroll(qKey, 'top', 'instant', !showAnswer);

  // Scroll to bottom when answer is revealed
  useEffect(() => {
    if (showAnswer) {
      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      document.documentElement.scrollTo({ top: scrollHeight, behavior: 'smooth' });
      document.body.scrollTo({ top: scrollHeight, behavior: 'smooth' });
    }
  }, [showAnswer]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.Frage}</div>

      <div className="statements-container">
        {shuffled.slice(0, revealedCount).map((stmt, i) => {
          let style: React.CSSProperties = {};
          if (showAnswer) {
            style = stmt.isWrong
              ? { background: 'rgba(255, 59, 48, 0.3)', borderColor: 'rgba(255, 59, 48, 0.6)' }
              : { background: 'rgba(74, 222, 128, 0.3)', borderColor: 'rgba(74, 222, 128, 0.6)' };
          }
          return (
            <div key={`${stmt.text}-${i}`} className="statement" style={style}>
              {stmt.text}
            </div>
          );
        })}
      </div>

      {showAnswer && (
        <div className="statements-container" style={{ textAlign: 'center', marginTop: 'clamp(6px, 1.2vw, 10px)' }}>
          <div style={{ fontSize: '0.85em', color: 'rgba(74, 222, 128, 0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 'clamp(5px, 1vw, 8px)' }}>
            Gesuchter Begriff
          </div>
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
        </div>
      )}
    </>
  );
}
