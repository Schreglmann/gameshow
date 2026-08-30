import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { CityCompassConfig, CityCompassQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { scrollToCardBottom } from '@/utils/scrollToCardAnchor';
import { useFullscreen } from '@/context/FullscreenContext';
import RetryImage from '@/components/common/RetryImage';
import CompassRose from '@/components/common/CompassRose';
import { formatDistanceKm, haversineKm } from '@/utils/cityCompass';
import { toMediaSrc } from '@/utils/assetUrl';
import BaseGameWrapper from './BaseGameWrapper';

const DEFAULT_PROMPT = 'Welche Stadt liegt im Zentrum?';
/**
 * A progressive reveal opens with two neighbors. One alone only gives a direction,
 * which narrows nothing down and reads as a broken screen.
 */
const PROGRESSIVE_START = 2;

export default function CityCompass(props: GameComponentProps) {
  const config = props.config as CityCompassConfig;
  const { questions, order } = useQuestionOrder(
    config.questions,
    config.randomizeQuestions,
    config.questionLimit,
    props.gameId,
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Errate die Stadt, die im Zentrum des Kompass liegt.']}
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
        <CityCompassInner
          questions={questions}
          order={order}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          showDistances={config.showDistances === true}
          progressive={config.reveal === 'progressive'}
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
  questions: CityCompassQuestion[];
  order: QuestionOrderHandle;
  resumeAtEnd: boolean;
  gameTitle: string;
  showDistances: boolean;
  progressive: boolean;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function CityCompassInner({
  questions,
  order,
  resumeAtEnd,
  gameTitle,
  showDistances,
  progressive,
  onGameComplete,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setAnswerRevealed,
}: InnerProps) {
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  const [showAnswer, setShowAnswer] = useState(resumeAtEnd);
  const { open: openLightbox } = useFullscreen();

  const q = questions[qIdx];
  const neighbors = q?.neighbors ?? [];
  /** How many neighbors a fully revealed question shows. */
  const fullCount = neighbors.length;
  const startCount = progressive ? Math.min(PROGRESSIVE_START, fullCount) : fullCount;

  const [revealedCount, setRevealedCount] = useState(() => (resumeAtEnd ? fullCount : startCount));

  // Keyed on qKey, not qIdx: with a live edit the same position can become a
  // different question, and a stale reveal count would show cities the host has
  // not introduced yet. See specs/live-question-order.md.
  useEffect(() => {
    setRevealedCount(progressive ? Math.min(PROGRESSIVE_START, fullCount) : fullCount);
  }, [qKey, progressive, fullCount]);

  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Stadt ${qIdx} von ${questions.length - 1}`;

  const answerText = useMemo(
    () => (q ? [q.center.name, q.center.country].filter(Boolean).join(' · ') : '—'),
    [q],
  );

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question || DEFAULT_PROMPT,
      answer: answerText,
      answerImage: q.answerImage,
      // Reuses the ranking answer-list shape so the gamemaster sees which cities
      // the audience already has, without a new field on the channel.
      answerList: q.neighbors.map((city, i) => ({
        rank: i + 1,
        text: `${city.name} · ${formatDistanceKm(haversineKm(q.center, city))}`,
        revealed: i < revealedCount,
      })),
      nextAnswer: nextQ
        ? {
            question: nextQ.question || DEFAULT_PROMPT,
            answer: [nextQ.center.name, nextQ.center.country].filter(Boolean).join(' · '),
            image: nextQ.answerImage,
          }
        : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData, q, answerText, revealedCount]);

  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  const handleNext = useCallback(() => {
    if (revealedCount < fullCount) {
      setRevealedCount(prev => prev + 1);
    } else if (!showAnswer) {
      setShowAnswer(true);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setShowAnswer(false);
    } else {
      onGameComplete();
    }
  }, [revealedCount, fullCount, showAnswer, qIdx, questions.length, onGameComplete, setQIdx]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    }
    if (revealedCount > startCount) {
      setRevealedCount(prev => prev - 1);
      return true;
    }
    if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, revealedCount, startCount, qIdx, setQIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  useQuizAutoScroll(qKey, 'top', 'instant', !showAnswer);

  useEffect(() => {
    if (showAnswer) scrollToCardBottom();
  }, [showAnswer]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      {q.info && <div className="quiz-question-info">{q.info}</div>}
      <div className="quiz-question">{q.question || DEFAULT_PROMPT}</div>

      <div className="city-compass-stage">
        <CompassRose
          center={q.center}
          neighbors={neighbors}
          revealedCount={revealedCount}
          showDistances={showDistances}
          solved={showAnswer}
        />
        {progressive && revealedCount < fullCount && (
          <div className="city-compass-progress">
            {revealedCount} von {fullCount} Städten
          </div>
        )}
      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{answerText}</p>
          {q.answerImage && (
            <RetryImage
              key={q.answerImage}
              src={toMediaSrc(q.answerImage) ?? q.answerImage}
              alt=""
              className="quiz-image"
              onClick={() => openLightbox({ type: 'image', src: q.answerImage! })}
            />
          )}
        </div>
      )}
    </>
  );
}
