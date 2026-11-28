import { useState, useEffect, useCallback } from 'react';
import type { GameComponentProps } from './types';
import type { FilmStripeConfig, FilmStripeQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand, GamemasterControl } from '@/types/game';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { useArrowRightLongPress } from '@/hooks/useArrowRightLongPress';
import { scrollToCardBottom } from '@/utils/scrollToCardAnchor';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';
import RetryImage from '@/components/common/RetryImage';
import FilmStripeBar from '@/components/common/FilmStripeBar';
import { toMediaSrc } from '@/utils/assetUrl';
import BaseGameWrapper from './BaseGameWrapper';

const DEFAULT_PROMPT = 'Welcher Film ist das?';
/** Stills per second of the time-lapse: 48 stills run for 8 seconds. */
const TIMELAPSE_FPS = 6;
/** How many stills are fetched at once — well below the browser's 6-per-origin limit. */
const PRELOAD_PARALLEL = 3;

/** URL of one time-lapse still. The path is a query value, so it is encoded as one. */
export function filmStripeFrameUrl(video: string, index: number): string {
  const rel = video.replace(/^\/?videos\//, '');
  return `/api/film-stripe/frame?path=${encodeURIComponent(rel)}&i=${index}`;
}

/**
 * Fetch the stills of one film ahead of the time-lapse and report how many are in
 * the browser cache, counted from the start. Uses `fetch()` — never `new Image()`,
 * which leaks keep-alive connections (specs/asset-resilience.md). The <img> of the
 * time-lapse then reads the same URLs from the HTTP cache.
 */
function usePreloadedFrames(video: string | undefined, frames: number): number {
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    setLoaded(0);
    if (!video || frames <= 0) return;
    const controller = new AbortController();
    const done = new Array<boolean>(frames).fill(false);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < frames && !controller.signal.aborted) {
        const i = next++;
        try {
          const res = await fetch(filmStripeFrameUrl(video, i), { signal: controller.signal });
          if (res.ok) await res.blob();
        } catch {
          // Aborted, or the still failed to load: the time-lapse skips what it
          // cannot show, so a gap is harmless.
        }
        if (controller.signal.aborted) return;
        done[i] = true;
        // Report the contiguous run from the start, so playback never runs into a
        // still that is not there yet.
        let run = 0;
        while (run < frames && done[run]) run++;
        setLoaded(run);
      }
    };
    for (let w = 0; w < Math.min(PRELOAD_PARALLEL, frames); w++) void worker();

    return () => controller.abort();
  }, [video, frames]);

  return loaded;
}

export default function FilmStripe(props: GameComponentProps) {
  const config = props.config as FilmStripeConfig;
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
      rules={config.rules || ['Errate den Film anhand seines Farbstreifens.']}
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
        <FilmStripeInner
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
  questions: FilmStripeQuestion[];
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

function FilmStripeInner({
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
  /** The hint stage: the film as a time-lapse above the stripe. */
  const [timelapse, setTimelapse] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const { open: openLightbox } = useFullscreen();

  const q = questions[qIdx];
  const stripe = q?.stripe;
  const frameCount = stripe?.frames ?? 0;
  const hasTimelapse = frameCount > 0;
  const loadedFrames = usePreloadedFrames(hasTimelapse ? q?.video : undefined, frameCount);

  // Keyed on qKey, not qIdx: with a live edit the same position can become a
  // different film, and a time-lapse left running would show the previous one's
  // stage. See specs/live-question-order.md.
  useEffect(() => {
    setTimelapse(false);
    setFrameIdx(0);
  }, [qKey]);

  const playing = timelapse && !showAnswer && loadedFrames > 0;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      // Loop over what has arrived so far; the range grows as stills load.
      setFrameIdx(prev => (prev + 1) % loadedFrames);
    }, 1000 / TIMELAPSE_FPS);
    return () => window.clearInterval(id);
  }, [playing, loadedFrames]);

  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Film ${qIdx} von ${questions.length - 1}`;
  const prompt = q?.question || DEFAULT_PROMPT;

  useRegisterFullscreenMedia(showAnswer && q?.answerImage ? { type: 'image', src: q.answerImage } : null);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      gmInfo: q.gmInfo,
      question: prompt,
      answer: q.answer,
      answerImage: q.answerImage,
      nextAnswer: nextQ
        ? { question: nextQ.question || DEFAULT_PROMPT, answer: nextQ.answer, image: nextQ.answerImage }
        : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData, q, prompt]);

  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  const handleNext = useCallback(() => {
    if (!showAnswer && !timelapse && hasTimelapse) {
      setTimelapse(true);
    } else if (!showAnswer) {
      setShowAnswer(true);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setShowAnswer(false);
    } else {
      onGameComplete();
    }
  }, [showAnswer, timelapse, hasTimelapse, qIdx, questions.length, onGameComplete, setQIdx]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    }
    if (timelapse) {
      setTimelapse(false);
      return true;
    }
    if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, timelapse, qIdx, setQIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  const reveal = useCallback(() => setShowAnswer(true), []);

  // A short tap advances one step; holding ArrowRight (≥500 ms) jumps straight to
  // the answer. Disabled once the answer is shown, so the key falls through to the
  // normal "next film" navigation.
  useArrowRightLongPress({
    enabled: !showAnswer,
    onShortPress: handleNext,
    onLongPress: reveal,
  });

  useEffect(() => {
    setGamemasterControls([
      {
        type: 'button-group',
        id: 'actions',
        buttons: [
          { id: 'film-stripe-timelapse', label: 'Zeitraffer', active: timelapse && !showAnswer, disabled: !hasTimelapse },
          { id: 'film-stripe-reveal', label: 'Auflösung', variant: 'primary', active: showAnswer },
        ],
      },
    ]);
  }, [timelapse, showAnswer, hasTimelapse, setGamemasterControls]);

  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'film-stripe-reveal') {
      reveal();
    } else if (cmd.controlId === 'nav-forward-long' && !showAnswer) {
      reveal();
    } else if (cmd.controlId === 'film-stripe-timelapse' && hasTimelapse) {
      // Toggles, and leaves the answer: the host can go back to the hint.
      setShowAnswer(false);
      setTimelapse(prev => (showAnswer ? true : !prev));
    }
  }, [reveal, showAnswer, hasTimelapse]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  useQuizAutoScroll(qKey, 'top', 'instant', !showAnswer);

  useEffect(() => {
    if (showAnswer) scrollToCardBottom();
  }, [showAnswer]);

  if (!q) return null;

  const timelapseVisible = timelapse && !showAnswer && hasTimelapse;
  const shownFrame = loadedFrames > 0 ? Math.min(frameIdx, loadedFrames - 1) : -1;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{prompt}</div>

      <div className={`film-stripe-stage${timelapseVisible ? ' film-stripe-stage--timelapse' : ''}`}>
        {timelapseVisible && (
          <div className="film-stripe-timelapse">
            {shownFrame >= 0 ? (
              <img
                className="film-stripe-timelapse__frame"
                src={filmStripeFrameUrl(q.video, shownFrame)}
                alt=""
                draggable={false}
              />
            ) : (
              <div className="film-stripe-timelapse__loading" role="status">Zeitraffer wird geladen…</div>
            )}
          </div>
        )}
        {stripe ? (
          <FilmStripeBar
            colors={stripe.colors}
            markerIndex={timelapseVisible && shownFrame >= 0 ? stripe.framePositions[shownFrame] : undefined}
            animationKey={String(qKey)}
          />
        ) : (
          <div className="film-stripe-missing" role="status">
            Für diesen Film wurde noch kein Farbstreifen berechnet.
          </div>
        )}
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
