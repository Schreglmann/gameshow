import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import type { GameComponentProps } from './types';
import type { FactOrFakeConfig, FactOrFakeQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { toMediaSrc } from '@/utils/assetUrl';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';

export default function FactOrFake(props: GameComponentProps) {
  const config = props.config as FactOrFakeConfig;

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, undefined, props.gameId);

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
      onPrevGame={props.onPrevGame}
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

  const { open: openFullscreen } = useFullscreen();
  // Answer image once revealed, otherwise the question image. Drives the GM toggle.
  const fullscreenSrc = showAnswer && q?.answerImage ? q.answerImage : q?.questionImage;
  useRegisterFullscreenMedia(fullscreenSrc ? { type: 'image', src: fullscreenSrc } : null);

  useEffect(() => {
    if (!q) return;
    const isFakt = q.answer === 'FAKT' || q.isFact === true;
    const nextQ = questions[qIdx + 1];
    const nextIsFakt = nextQ ? (nextQ.answer === 'FAKT' || nextQ.isFact === true) : false;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.statement,
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

  // Scroll the card just below the sticky header when the question is taller
  // than the viewport — same behaviour as SimpleQuiz. Disabled on reveal so the
  // scroll-to-bottom effect below can bring the full answer into view instead.
  useQuizAutoScroll(qIdx, 'top', 'instant', !showAnswer);

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
        <img
          className="fact-question-image"
          src={toMediaSrc(q.questionImage)}
          alt=""
          style={{ cursor: 'pointer' }}
          onClick={() => openFullscreen({ type: 'image', src: q.questionImage! })}
        />
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
            <img
              className="fact-answer-image"
              src={toMediaSrc(q.answerImage)}
              alt=""
              style={{ cursor: 'pointer' }}
              onClick={() => openFullscreen({ type: 'image', src: q.answerImage! })}
            />
          )}
        </div>
      )}
    </>
  );
}
