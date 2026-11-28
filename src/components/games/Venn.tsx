import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { VennConfig, VennQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand, GamemasterControl } from '@/types/game';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { useArrowRightLongPress } from '@/hooks/useArrowRightLongPress';
import { scrollToCardBottom } from '@/utils/scrollToCardAnchor';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';
import RetryImage from '@/components/common/RetryImage';
import VennDiagram from '@/components/common/VennDiagram';
import { VENN_MAX_SETS, VENN_MIN_SETS } from '@/utils/vennLayout';
import { toMediaSrc } from '@/utils/assetUrl';
import BaseGameWrapper from './BaseGameWrapper';

const PROMPT = 'Welcher Begriff passt in alle Kategorien?';

/** The categories of a question as they are drawn: trimmed, empty ones dropped, at most three. */
function setsOf(q: VennQuestion | undefined): string[] {
  return (q?.sets ?? []).map(s => s.trim()).filter(Boolean).slice(0, VENN_MAX_SETS);
}

export default function Venn(props: GameComponentProps) {
  const config = props.config as VennConfig;
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
      rules={config.rules || ['Gesucht ist ein Begriff, der in alle Kategorien passt.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
      order={order}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }) => (
        <VennInner
          questions={questions}
          order={order}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: VennQuestion[];
  order: QuestionOrderHandle;
  resumeAtEnd: boolean;
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function VennInner({
  questions,
  order,
  resumeAtEnd,
  gameTitle,
  onGameComplete,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setGamemasterControls,
  setCommandHandler,
  setAnswerRevealed,
}: InnerProps) {
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  const [showAnswer, setShowAnswer] = useState(resumeAtEnd);
  const { open: openLightbox } = useFullscreen();

  const q = questions[qIdx];
  // Memoised: it is a dependency of the gamemaster-sync effect, and the show
  // re-renders every 100 ms while background music plays.
  const sets = useMemo(() => setsOf(q), [q]);
  const fullCount = sets.length;
  /** Two circles are the puzzle; anything beyond them is a hint. */
  const startCount = Math.min(VENN_MIN_SETS, fullCount);

  const [revealedCount, setRevealedCount] = useState(() => (resumeAtEnd ? fullCount : startCount));

  // Keyed on qKey, not qIdx: with a live edit the same position can become a
  // different question, and a stale count would show a hint circle the host has
  // not given yet. See specs/live-question-order.md.
  useEffect(() => {
    setRevealedCount(Math.min(VENN_MIN_SETS, fullCount));
  }, [qKey, fullCount]);

  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  useRegisterFullscreenMedia(showAnswer && q?.answerImage ? { type: 'image', src: q.answerImage } : null);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      gmInfo: q.gmInfo,
      question: PROMPT,
      answer: q.answer,
      answerImage: q.answerImage,
      // The categories are what the audience sees, not the answer, so they go on
      // `hintList` — `revealed` marks the circles already on the projector.
      hintList: sets.map((text, i) => ({ rank: i + 1, text, revealed: i < revealedCount })),
      hintListClickable: true,
      nextAnswer: nextQ
        ? { question: setsOf(nextQ).slice(0, VENN_MIN_SETS).join(' ∩ '), answer: nextQ.answer, image: nextQ.answerImage }
        : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData, q, sets, revealedCount]);

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

  // Stepping back onto the previous question shows it solved, with every circle.
  useEffect(() => {
    if (showAnswer) setRevealedCount(fullCount);
  }, [showAnswer, fullCount]);

  const revealAll = useCallback(() => {
    setRevealedCount(fullCount);
    setShowAnswer(true);
  }, [fullCount]);

  // A short tap advances one step; holding ArrowRight (≥500 ms) jumps straight to
  // the answer. Disabled once the answer is shown, so the key falls through to the
  // normal "next question" navigation.
  useArrowRightLongPress({
    enabled: !showAnswer,
    onShortPress: handleNext,
    onLongPress: revealAll,
  });

  useEffect(() => {
    setGamemasterControls([
      {
        type: 'button-group',
        id: 'actions',
        buttons: [{ id: 'venn-reveal', label: 'Auflösung', variant: 'primary', active: showAnswer }],
      },
    ]);
  }, [showAnswer, setGamemasterControls]);

  // `hint-<N>` (a click on category N in the GM card) shows exactly circles 1…N and
  // hides the answer again — never fewer than the two the puzzle starts with.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'venn-reveal') {
      revealAll();
    } else if (cmd.controlId === 'nav-forward-long' && !showAnswer) {
      revealAll();
    } else {
      const m = cmd.controlId.match(/^hint-(\d+)$/);
      if (!m) return;
      const target = parseInt(m[1]!, 10);
      if (Number.isNaN(target)) return;
      setShowAnswer(false);
      setRevealedCount(Math.max(startCount, Math.min(fullCount, target)));
    }
  }, [revealAll, showAnswer, startCount, fullCount]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  useQuizAutoScroll(qKey, 'top', 'instant', !showAnswer);

  useEffect(() => {
    if (showAnswer) scrollToCardBottom();
  }, [showAnswer]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{PROMPT}</div>

      <div className="venn-stage">
        <VennDiagram sets={sets} revealedCount={revealedCount} solved={showAnswer} answer={q.answer} />
      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
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
