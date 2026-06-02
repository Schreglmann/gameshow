import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FactOrFakeConfig, FactOrFakeQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

export default function FactOrFake(props: GameComponentProps) {
  const config = props.config as FactOrFakeConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ist es FAKT oder FAKE?']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setAnswerRevealed }) => (
        <FactOrFakeInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setGamemasterData={setGamemasterData}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: FactOrFakeQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function FactOrFakeInner({ questions, gameTitle, onGameComplete, setNavHandler, setGamemasterData, setAnswerRevealed }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  useEffect(() => {
    if (!q) return;
    const isFakt = q.answer === 'FAKT' || q.isFact === true;
    const nextQ = questions[qIdx + 1];
    const nextIsFakt = nextQ ? (nextQ.answer === 'FAKT' || nextQ.isFact === true) : false;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: isFakt ? 'FAKT' : 'FAKE',
      extraInfo: q.description,
      nextAnswer: nextQ ? { answer: nextIsFakt ? 'FAKT' : 'FAKE' } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

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

  // Position the page so the card sits just below the sticky header (with a
  // small margin) when it's taller than the viewport. Re-evaluates on question
  // change and whenever the card's height changes (image loading, answer
  // reveal). Mirrors the SimpleQuiz auto-scroll exactly so behaviour stays
  // consistent across game types.
  useLayoutEffect(() => {
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    const header = document.querySelector('header') as HTMLElement | null;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    if (!card) return;
    const absoluteOffsetTop = (el: HTMLElement): number => {
      let top = 0;
      let node: HTMLElement | null = el;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return top;
    };
    const applyScroll = () => {
      const headerH = header?.offsetHeight ?? 0;
      const cardTop = absoluteOffsetTop(card);
      const cardH = card.offsetHeight;
      const overflow = cardTop + cardH - window.innerHeight;
      const maxScroll = Math.max(0, cardTop - headerH - 8);
      if (overflow <= 0 || overflow > maxScroll) return;
      const target = Math.round(Math.min(overflow + 16, maxScroll));
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
      }
    };
    applyScroll();
    const observer = new ResizeObserver(applyScroll);
    observer.observe(card);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [qIdx]);

  // On answer reveal, smooth-scroll all the way to the bottom of the card so
  // the entire reveal (description + answerImage) is visible. Re-fires when
  // the answer image finishes loading (which grows the card). Not capped by
  // header — during reveal the question scrolling under the header is fine.
  useLayoutEffect(() => {
    if (!showAnswer) return;
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    if (!card) return;
    const scrollToBottom = () => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= window.innerHeight - 16) return;
      const target = Math.max(0, window.scrollY + (rect.bottom - window.innerHeight) + 16);
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo({ top: target, behavior: 'smooth' });
      }
    };
    scrollToBottom();
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(card);
    return () => observer.disconnect();
  }, [showAnswer, qIdx]);

  if (!q) return null;

  const isFakt = q.answer === 'FAKT' || q.isFact === true;
  const answerLabel = isFakt ? 'FAKT' : 'FAKE';

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <div className="quiz-question">{q.statement}</div>

      {q.questionImage && (
        <img className="fact-question-image" src={q.questionImage} alt="" />
      )}

      {showAnswer && (
        <div className="quiz-answer">
          <p
            className="fact-answer"
            style={{ color: isFakt ? 'var(--success)' : 'var(--error-light)' }}
          >
            {answerLabel}
          </p>
          {q.description && (
            <p className="fact-description">{q.description}</p>
          )}
          {q.answerImage && (
            <img className="fact-answer-image" src={q.answerImage} alt="" />
          )}
        </div>
      )}
    </>
  );
}
