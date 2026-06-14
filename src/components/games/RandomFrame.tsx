import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { RandomFrameConfig, RandomFrameQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { toMediaSrc } from '@/utils/assetUrl';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';
import RetryImage from '@/components/common/RetryImage';
import BaseGameWrapper from './BaseGameWrapper';

const DEFAULT_PROMPT = 'Aus welchem Film stammt dieses Bild?';

/** Build the random-frame endpoint URL for a question + seed + variant + question index. The
 *  seed pins which frame the server returns (so re-renders reuse the cached frame); `variant` is
 *  the GM rotate counter — for a reachable source the server folds it into the seed (each rotate =
 *  new frame); for the prerendered fallback it cycles the downloaded variants (`variant % count`).
 *  `qindex` is the question's original (pre-shuffle) index so prerendered frames are matched per
 *  question. With `prerenderedOnly`, the server serves only the downloaded fallback frame (skipping
 *  live extraction) — used as a stopgap while a live frame is still loading; 404 if none exists. */
function buildFrameUrl(q: RandomFrameQuestion, seed: number, variant: number, qindex: number, prerenderedOnly = false): string {
  const rel = q.video.replace(/^\/?videos\//, '');
  const params = new URLSearchParams({ path: rel, seed: String(seed), variant: String(variant), qindex: String(qindex) });
  if (prerenderedOnly) params.set('prerendered', '1');
  if (q.frameStart != null) params.set('start', String(q.frameStart));
  if (q.frameEnd != null) params.set('end', String(q.frameEnd));
  return `/api/random-frame?${params.toString()}`;
}

export default function RandomFrame(props: GameComponentProps) {
  const config = props.config as RandomFrameConfig;
  const questions = useShuffledQuestions(
    config.questions || [],
    config.randomizeQuestions,
    config.questionLimit,
  );
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  // ── Frame seeds (owned here, at the title screen, so they're truly random each play) ──
  // A fresh random base is generated once per mount — i.e. every time the game is entered or
  // the page is reloaded — so reloading gives genuinely different frames. The per-question seed
  // stays constant; the GM re-roll bumps a per-question `variant` counter (sent as the `variant`
  // query param) so "Neues Bild" / "Nächstes Bild" rotate the frame.
  const [baseSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [variants, setVariants] = useState<Record<number, number>>({});
  const seedFor = useCallback((idx: number) => baseSeed + idx * 7919, [baseSeed]);
  const variantFor = useCallback((idx: number) => variants[idx] ?? 0, [variants]);

  // Map each question back to its ORIGINAL index in config.questions (pre-shuffle) so prerendered
  // frames — stored per question — are matched correctly even when the deck is randomized. Keyed
  // by object identity; shuffle preserves references, and duplicated questions are distinct objects.
  const origIndexByRef = useMemo(() => {
    const m = new Map<RandomFrameQuestion, number>();
    (config.questions || []).forEach((q, i) => { if (!m.has(q)) m.set(q, i); });
    return m;
  }, [config.questions]);
  const qIndexFor = useCallback(
    (idx: number) => { const q = questions[idx]; return q ? (origIndexByRef.get(q) ?? idx) : idx; },
    [questions, origIndexByRef],
  );

  const frameUrlFor = useCallback(
    (idx: number) => (questions[idx] ? buildFrameUrl(questions[idx], seedFor(idx), variantFor(idx), qIndexFor(idx)) : undefined),
    [questions, seedFor, variantFor, qIndexFor],
  );
  // The downloaded-fallback URL for a question (forces the prerendered frame, skipping live
  // extraction). Used as a stopgap while a live frame is still loading.
  const fallbackUrlFor = useCallback(
    (idx: number) => (questions[idx] ? buildFrameUrl(questions[idx], seedFor(idx), variantFor(idx), qIndexFor(idx), true) : undefined),
    [questions, seedFor, variantFor, qIndexFor],
  );
  const regenerate = useCallback((idx: number) => {
    setVariants(prev => ({ ...prev, [idx]: (prev[idx] ?? 0) + 1 }));
  }, []);

  // Preload every frame in question order while the title/rules screens are up, so the server
  // extracts + caches them ahead of time and the early questions are already warm when the
  // host advances. Sequential (one fetch at a time) so the server isn't hammered and earlier
  // questions finish first. Uses the initial base seeds; re-rolled frames warm on demand.
  useEffect(() => {
    if (questions.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < questions.length; i++) {
        if (cancelled) break;
        try {
          const r = await fetch(buildFrameUrl(questions[i], baseSeed + i * 7919, 0, origIndexByRef.get(questions[i]) ?? i));
          await r.blob();
        } catch { /* best effort — the live <img> will retry if needed */ }
      }
    })();
    return () => { cancelled = true; };
  }, [questions, baseSeed, origIndexByRef]);

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ein zufälliges Standbild aus einem Film — erratet, aus welchem Film es stammt!']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }) => (
        <RandomFrameInner
          questions={questions}
          gameTitle={config.title}
          frameUrlFor={frameUrlFor}
          fallbackUrlFor={fallbackUrlFor}
          regenerate={regenerate}
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

/** How long the live frame may take to load before we drop in a downloaded frame as a stopgap.
 *  Preloaded frames load from cache well within this; a slow live extraction trips it. */
const FALLBACK_GRACE_MS = 600;

interface InnerProps {
  questions: RandomFrameQuestion[];
  gameTitle: string;
  frameUrlFor: (idx: number) => string | undefined;
  fallbackUrlFor: (idx: number) => string | undefined;
  regenerate: (idx: number) => void;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function RandomFrameInner({
  questions,
  gameTitle,
  frameUrlFor,
  fallbackUrlFor,
  regenerate,
  onGameComplete,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setGamemasterControls,
  setCommandHandler,
  setAnswerRevealed,
}: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  // Downloaded-frame stopgap: when the live frame is still loading after a short grace and a
  // downloaded frame is available, show the downloaded one — and keep it even if the live frame
  // finishes later. When the live source is reachable and warm, the live frame wins (fresh image).
  const [graceElapsed, setGraceElapsed] = useState(false);
  const [fallbackReady, setFallbackReady] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();

  const q = questions[qIdx];
  const nextQ = questions[qIdx + 1];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Bild ${qIdx} von ${questions.length - 1}`;
  const prompt = q?.question || DEFAULT_PROMPT;
  const frameUrl = frameUrlFor(qIdx) ?? '';
  const fallbackUrl = fallbackUrlFor(qIdx);
  const nextFrameUrl = frameUrlFor(qIdx + 1);
  const displaySrc = useFallback && fallbackUrl ? fallbackUrl : frameUrl;

  // Gamemaster sync: current frame (mirrors what the audience sees) + next frame preview.
  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
      question: prompt,
      questionImage: displaySrc,
      nextAnswer: nextQ ? { question: nextQ.question || DEFAULT_PROMPT, answer: nextQ.answer, image: nextFrameUrl } : undefined,
    });
  }, [q, qIdx, gameTitle, questions.length, prompt, displaySrc, nextQ, nextFrameUrl, setGamemasterData]);

  // Gamemaster controls: re-roll the current frame, plus the next frame once revealed.
  useEffect(() => {
    const buttons = [{ id: 'regenerate-frame', label: 'Neues Bild' }];
    if (showAnswer && nextQ) buttons.push({ id: 'regenerate-next-frame', label: 'Neues nächstes Bild' });
    setGamemasterControls([{ type: 'button-group', id: 'random-frame-actions', buttons }]);
  }, [showAnswer, nextQ, setGamemasterControls]);

  // Memoized so its identity is stable between renders — otherwise re-registering a
  // fresh handler each render would loop (setCommandHandler is an unstable inline prop).
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'regenerate-frame') regenerate(qIdx);
    else if (cmd.controlId === 'regenerate-next-frame') regenerate(qIdx + 1);
  }, [qIdx, regenerate]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Reset the loading + stopgap state whenever the frame URL changes (new question or re-roll).
  useEffect(() => {
    setFrameLoaded(false);
    setFrameFailed(false);
    setGraceElapsed(false);
    setFallbackReady(false);
    setUseFallback(false);
  }, [frameUrl]);

  // Probe (and warm) the downloaded fallback for the current question so it's instantly available
  // if the live frame turns out slow. A 404 (nothing downloaded) just leaves the stopgap disabled.
  useEffect(() => {
    if (!fallbackUrl) return;
    let cancelled = false;
    fetch(fallbackUrl)
      .then(r => { if (!cancelled && r.ok) setFallbackReady(true); })
      .catch(() => { /* no fallback available */ });
    return () => { cancelled = true; };
  }, [fallbackUrl]);

  // Start the grace clock when the frame URL changes; if the live frame hasn't loaded by then,
  // graceElapsed lets the stopgap kick in (gated on the fallback being ready).
  useEffect(() => {
    setGraceElapsed(false);
    const id = setTimeout(() => setGraceElapsed(true), FALLBACK_GRACE_MS);
    return () => clearTimeout(id);
  }, [frameUrl]);

  // Switch to the downloaded frame once: grace elapsed, live still not loaded, and a fallback is
  // ready. Sticky — once shown, the downloaded frame stays even if the live frame loads later.
  useEffect(() => {
    if (graceElapsed && !frameLoaded && fallbackReady && fallbackUrl && !useFallback) {
      setUseFallback(true);
    }
  }, [graceElapsed, frameLoaded, fallbackReady, fallbackUrl, useFallback]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  // Smooth scroll to bottom on answer reveal so the answer comes into view.
  useEffect(() => {
    if (!showAnswer) return;
    const id = setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(id);
  }, [showAnswer]);

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setShowAnswer(false);
    } else {
      onGameComplete();
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      setShowAnswer(false);
      return true;
    } else if (qIdx > 0) {
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      {prompt && <p className="quiz-question">{prompt}</p>}

      <div className="image-guess-container random-frame-container">
        {!frameLoaded && !frameFailed && (
          <div className="random-frame-loading" role="status" aria-live="polite">
            <div className="video-loading-spinner" />
            <span className="random-frame-loading-text">Bild wird geladen&hellip;</span>
          </div>
        )}
        <RetryImage
          key={displaySrc}
          src={displaySrc}
          alt=""
          className="image-guess-image"
          // First-time extraction of a large source can legitimately take several seconds;
          // give it a generous window before treating the load as failed so we don't kick off
          // a duplicate extraction. The spinner stays visible the whole time (gated on load).
          // A slow live frame is covered by the downloaded-frame stopgap above.
          slowLoadMs={25_000}
          onLoad={() => setFrameLoaded(true)}
          onFinalFailure={() => setFrameFailed(true)}
          onClick={showAnswer ? () => openLightbox(displaySrc) : undefined}
          style={{ cursor: showAnswer ? 'pointer' : 'default', opacity: frameLoaded ? 1 : 0, transition: 'opacity 0.2s ease' }}
        />
      </div>

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
          {q.answerImage && (
            <RetryImage
              src={toMediaSrc(q.answerImage)!}
              alt={q.answer}
              className="quiz-image"
              onClick={() => openLightbox(toMediaSrc(q.answerImage)!)}
              style={{ cursor: 'pointer' }}
            />
          )}
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={closeLightbox} />
    </>
  );
}
