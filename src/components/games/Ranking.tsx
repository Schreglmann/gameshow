import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { RankingConfig, RankingQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand } from '@/types/game';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

export default function Ranking(props: GameComponentProps) {
  const config = props.config as RankingConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions, config.questionLimit),
    [config.questions, config.randomizeQuestions, config.questionLimit]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Errate die Antworten in der richtigen Reihenfolge.',
        'Pro Runde wird ein Platz nach dem anderen aufgelöst.',
      ]}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler }) => (
        <RankingInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setCommandHandler={setCommandHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: RankingQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
}

function RankingInner({ questions, gameTitle, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setCommandHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;
  const answers = useMemo(() => (q?.answers ?? []).filter(a => a && a.trim()), [q]);
  const answersLength = answers.length;

  useEffect(() => {
    if (!q) return;
    const list = answers.map((a, i) => ({
      rank: i + 1,
      text: a,
      revealed: i < revealedCount,
    }));
    // `answer` stays populated as a fallback for non-ranking-aware GM views
    // (e.g. older clients), but the GM renders `answerList` when present.
    const fallback = answers.map((a, i) => `${i + 1}. ${a}`).join(' · ') || '—';
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: fallback,
      answerList: list,
      extraInfo: `Platz ${Math.min(revealedCount, answersLength)}/${answersLength}`,
    });
  }, [qIdx, revealedCount, gameTitle, questions, setGamemasterData, q, answers, answersLength]);

  const handleNext = useCallback(() => {
    if (revealedCount < answersLength) {
      setRevealedCount(prev => prev + 1);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setRevealedCount(0);
    } else {
      onGameComplete();
    }
  }, [revealedCount, answersLength, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (revealedCount > 0) {
      setRevealedCount(prev => prev - 1);
      return true;
    } else if (qIdx > 0) {
      const prev = questions[qIdx - 1];
      const prevCount = (prev?.answers ?? []).filter(a => a && a.trim()).length;
      setQIdx(qIdx - 1);
      setRevealedCount(prevCount);
      return true;
    }
    return false;
  }, [revealedCount, qIdx, questions]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Allow the GM to jump straight to a specific rank by clicking the entry
  // in the structured answer list. Reveals all answers up to and including
  // the clicked rank.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    const m = cmd.controlId.match(/^rank-(\d+)$/);
    if (!m) return;
    const target = parseInt(m[1], 10);
    if (Number.isNaN(target)) return;
    const clamped = Math.max(0, Math.min(answersLength, target));
    setRevealedCount(clamped);
  }, [answersLength]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  useEffect(() => {
    if (revealedCount === 0) return;
    const timers: number[] = [];
    const scrollToBottom = () => {
      const target = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo({ top: target, behavior: 'smooth' });
    };
    [0, 80, 200, 500].forEach(delay => {
      timers.push(window.setTimeout(scrollToBottom, delay));
    });
    return () => { timers.forEach(clearTimeout); };
  }, [revealedCount, qIdx]);

  const revealAll = useCallback(() => {
    setRevealedCount(answersLength);
  }, [answersLength]);

  const allRevealedRef = useRef(revealedCount >= answersLength);
  allRevealedRef.current = revealedCount >= answersLength;
  const handleNextRef = useRef(handleNext);
  handleNextRef.current = handleNext;
  const revealAllRef = useRef(revealAll);
  revealAllRef.current = revealAll;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let keyHeld = false;
    let longPressTriggered = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight') return;
      if (keyHeld) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (allRevealedRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      keyHeld = true;
      longPressTriggered = false;
      timer = setTimeout(() => {
        longPressTriggered = true;
        revealAllRef.current();
        timer = null;
      }, 500);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight') return;
      const wasHeld = keyHeld;
      keyHeld = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (wasHeld && !longPressTriggered) {
        handleNextRef.current();
      }
      longPressTriggered = false;
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>
      {q.topic && <div className="ranking-topic">{q.topic}</div>}

      <div className="statements-container">
        {answers.slice(0, revealedCount).map((text, i) => (
          <div key={i} className="statement ranking-row" style={{ cursor: 'default' }}>
            <span className="ranking-rank">{i + 1}.</span>
            <span className="ranking-text">{text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
