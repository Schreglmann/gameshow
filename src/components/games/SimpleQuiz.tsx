import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { SimpleQuizConfig, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { toMediaSrc } from '@/utils/assetUrl';
import { useMusicPlayer } from '@/context/MusicContext';
import { safePlay } from '@/utils/safePlay';
import { fadeAudio } from '@/utils/fadeAudio';
import { watchMediaLoad, MEDIA_SLOW_LOAD_MS } from '@/utils/mediaLoadTimeout';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';
import { useGmConnected } from '@/hooks/useGmConnected';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import AssetReloadButton from '@/components/common/AssetReloadButton';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function SimpleQuiz(props: GameComponentProps) {
  const config = props.config as SimpleQuizConfig;
  const music = useMusicPlayer();
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit, props.gameId);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const hasAudio = questions.some(q => q.answerAudio || q.questionAudio);
  // Set to true by handleNextShow so QuizInner's effect cleanup skips the hard pause
  const skipAudioCleanupRef = useRef(false);

  // Stop audio when this component unmounts (navigating away)
  useEffect(() => {
    return () => {
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
    };
  }, []);

  const handleNextShow = hasAudio
    ? () => {
        // Signal QuizInner's effect cleanup to skip the hard pause
        skipAudioCleanupRef.current = true;
        // Detach refs so the outer unmount cleanup also skips them
        const answerAudio = answerAudioRef.current;
        const questionAudio = questionAudioRef.current;
        answerAudioRef.current = null;
        questionAudioRef.current = null;
        if (answerAudio) fadeAudio(answerAudio);
        // Same-file case: answerAudio and questionAudio reference the same element — avoid double-fading it.
        if (questionAudio && questionAudio !== answerAudio) fadeAudio(questionAudio);
        // Fade background music back in
        setTimeout(() => music.fadeIn(3000), 500);
      }
    : undefined;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Jede Frage wird gleichzeitig an die Teams gestellt.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onRulesShow={hasAudio ? () => music.fadeOut(2000) : undefined}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setStopAudioHandler, setAnswerRevealed, setGameTimer }) => (
        <QuizInner
          questions={questions}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          answerAudioRef={answerAudioRef}
          questionAudioRef={questionAudioRef}
          skipAudioCleanupRef={skipAudioCleanupRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setStopAudioHandler={setStopAudioHandler}
          setAnswerRevealed={setAnswerRevealed}
          setGameTimer={setGameTimer}
        />
      )}
    </BaseGameWrapper>
  );
}

interface QuizInnerProps {
  questions: SimpleQuizQuestion[];
  resumeAtEnd: boolean;
  gameTitle: string;
  answerAudioRef: React.RefObject<HTMLAudioElement | null>;
  questionAudioRef: React.RefObject<HTMLAudioElement | null>;
  skipAudioCleanupRef: React.RefObject<boolean>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
  setGameTimer: (seconds: number | null) => void;
}

function QuizInner({ questions, resumeAtEnd, gameTitle, answerAudioRef, questionAudioRef, skipAudioCleanupRef, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setStopAudioHandler, setAnswerRevealed, setGameTimer }: QuizInnerProps) {
  const gmConnected = useGmConnected();
  // Resuming (entered via back-navigation): open at the last question with its
  // answer revealed, so back-stepping walks the whole game in reverse.
  const [qIdx, setQIdx] = useState(() => (resumeAtEnd ? Math.max(0, questions.length - 1) : 0));
  const [showAnswer, setShowAnswer] = useState(resumeAtEnd);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Constraints for the active question-audio element. Captured in refs so
  // the timeupdate listener stays referentially stable across renders.
  const activeAudioStartRef = useRef<number | undefined>(undefined);
  const activeAudioEndRef = useRef<number | undefined>(undefined);
  const activeAudioLoopRef = useRef<boolean | undefined>(undefined);
  // Listener removers for audio elements created outside the qIdx effect
  // (handleBack rewind path). Keeps listener attachment symmetrical so a
  // late timeupdate from a rewound-and-discarded element can't push stale
  // state into the next question.
  const questionAudioCleanupRef = useRef<(() => void) | null>(null);
  const answerAudioCleanupRef = useRef<(() => void) | null>(null);
  const q = questions[qIdx];

  // Eagerly prefetch the next question's audio + answer image so a network
  // glitch has time to recover before the host advances. Re-fires on
  // showAnswer flip as a second chance.
  const nextQ = questions[qIdx + 1];
  usePreloadAsset({
    image: nextQ?.answerImage ?? nextQ?.questionImage,
    audio: nextQ?.questionAudio ?? nextQ?.answerAudio,
  });
  // Warm the CURRENT question's answer image during the question phase so the
  // reveal swap (especially `replaceImage`, which swaps in place over the
  // question image) decodes from cache instantly — no load-in flash.
  usePreloadAsset({ image: q?.answerImage });

  useEffect(() => {
    setAssetFailed(false);
  }, [qIdx]);

  const onPlayError = useCallback((err: unknown, attempt: number) => {
    console.warn('[asset-resilience] SimpleQuiz play failed', { qIdx, attempt, err });
    if (attempt >= 1) setAssetFailed(true);
  }, [qIdx]);

  const onAssetFailure = useCallback(() => {
    console.warn('[asset-resilience] SimpleQuiz image final failure', { qIdx });
    setAssetFailed(true);
  }, [qIdx]);

  const onSlowAudio = useCallback((kind: 'question' | 'answer') => {
    console.warn('[asset-resilience] SimpleQuiz audio slow-load timeout', { qIdx, kind });
    setAssetFailed(true);
  }, [qIdx]);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
      extraInfo: q.answerList?.join('\n'),
      nextAnswer: nextQ ? { question: nextQ.question, answer: nextQ.answer } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const handleAudioPlayPause = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    if (audio.paused) void safePlay(audio, { onError: onPlayError });
    else audio.pause();
  }, [questionAudioRef, onPlayError]);

  const handleAudioRestart = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    audio.currentTime = q?.questionAudioStart ?? 0;
    void safePlay(audio, { onError: onPlayError });
  }, [questionAudioRef, q?.questionAudioStart, onPlayError]);
  const questionLabel = qIdx === 0 ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;

  // Forward nav
  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      // Stop question audio whenever an answer audio is configured — the answer-audio
      // effect will start a fresh Audio element from answerAudioStart. Without an
      // answer audio, leave the question audio playing through.
      if (q?.answerAudio) {
        questionAudioRef.current?.pause();
        questionAudioCleanupRef.current?.();
        questionAudioCleanupRef.current = null;
        questionAudioRef.current = null;
      }
    } else {
      if (qIdx < questions.length - 1) {
        // Stop both audios immediately when moving to the next question
        answerAudioRef.current?.pause();
        answerAudioCleanupRef.current?.();
        answerAudioCleanupRef.current = null;
        answerAudioRef.current = null;
        questionAudioRef.current?.pause();
        questionAudioCleanupRef.current?.();
        questionAudioCleanupRef.current = null;
        questionAudioRef.current = null;
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        // Last question: let audio keep playing until "next game" is pressed (unmount)
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions, q, onGameComplete, answerAudioRef, questionAudioRef]);

  // Back nav
  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      const currentQuestionAudio = questionAudioRef.current;
      const currentAnswerAudio = answerAudioRef.current;
      // If there's no separate answer audio, the question audio kept playing
      // through reveal — just clear the answer flag.
      const questionAudioStillActive =
        q?.questionAudio && currentQuestionAudio && !q.answerAudio;
      if (questionAudioStillActive) {
        setShowAnswer(false);
        return true;
      }
      // Otherwise: an answerAudio took over and the question audio was paused
      // at reveal time. Stop the answer audio and recreate the question audio
      // from the beginning (or questionAudioStart).
      currentAnswerAudio?.pause();
      answerAudioCleanupRef.current?.();
      answerAudioCleanupRef.current = null;
      answerAudioRef.current = null;
      if (q?.questionAudio) {
        currentQuestionAudio?.pause();
        questionAudioCleanupRef.current?.();
        const { audio, cleanup } = createQuestionAudio(q, {
          activeAudioStartRef,
          activeAudioEndRef,
          activeAudioLoopRef,
          setAudioCurrentTime,
          setAudioDuration,
          setAudioPlaying,
          onPlayError,
        });
        const stopSlowWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, () => onSlowAudio('question'));
        questionAudioRef.current = audio;
        questionAudioCleanupRef.current = () => { stopSlowWatch(); cleanup(); };
        setAudioCurrentTime(q.questionAudioStart ?? 0);
        setAudioDuration(0);
        setAudioPlaying(false);
        void safePlay(audio, { onError: onPlayError });
      }
      setShowAnswer(false);
      return true;
    } else if (qIdx > 0) {
      // Pause whatever is currently in the refs — including audio elements
      // created manually by the answer→question rewind branch above, which the
      // qIdx effect's cleanup can't reach (its closed-over `audio` is the
      // *original* element from when the effect last ran, not whatever
      // handleBack later swapped in).
      questionAudioRef.current?.pause();
      questionAudioCleanupRef.current?.();
      questionAudioCleanupRef.current = null;
      questionAudioRef.current = null;
      answerAudioRef.current?.pause();
      answerAudioCleanupRef.current?.();
      answerAudioCleanupRef.current = null;
      answerAudioRef.current = null;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx, q, questionAudioRef, answerAudioRef, onPlayError]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Broadcast gamemaster controls (only when question audio is active)
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    if (q?.questionAudio && audioDuration > 0) {
      controls.push({
        type: 'button-group',
        id: 'audio-controls',
        buttons: [
          { id: 'audio-playpause', label: audioPlaying ? 'Pause' : 'Abspielen' },
          { id: 'audio-restart', label: 'Von vorne' },
        ],
      });
    }
    if (assetFailed) {
      controls.push({ type: 'button', id: 'asset-reload', label: 'Asset neu laden' });
    }
    setGamemasterControls(controls);
  }, [q?.questionAudio, audioDuration, audioPlaying, assetFailed, setGamemasterControls]);

  const handleAssetReload = useCallback(() => {
    setAssetFailed(false);
    setReloadKey(k => k + 1);
  }, []);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'audio-playpause') handleAudioPlayPause();
    else if (cmd.controlId === 'audio-restart') handleAudioRestart();
    else if (cmd.controlId === 'asset-reload') handleAssetReload();
  }, [handleAudioPlayPause, handleAudioRestart, handleAssetReload]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Register a stop-audio handler so the GM-triggered deadline timer can
  // pause this game's detached `new Audio()` element on expiry. The handler
  // returns a resume callback the wrapper invokes on the next deadline start,
  // so the player audio picks up where it left off. Cleared on unmount.
  useEffect(() => {
    setStopAudioHandler(() => {
      const audio = questionAudioRef.current;
      if (!audio || audio.paused) return;
      audio.pause();
      return () => { void audio.play().catch(() => {}); };
    });
    return () => setStopAudioHandler(null);
  }, [setStopAudioHandler, questionAudioRef]);

  // Signal answer-reveal to the wrapper so any active deadline timer hides.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  // Declare the per-question `q.timer` to BaseGameWrapper, which owns the
  // countdown (renders the ring on the show + broadcasts remaining to the GM).
  // Re-arms on every question; clears on the answer phase. A GM `timer-stop`
  // clears it in the wrapper and it won't re-arm until the next question,
  // because these deps don't change on stop.
  useEffect(() => {
    setGameTimer(!showAnswer && q?.timer ? q.timer : null);
  }, [qIdx, q?.timer, showAnswer, setGameTimer]);

  useQuizAutoScroll(qIdx);

  // Auto-play answer audio when answer is revealed.
  // No cleanup here — audio intentionally keeps playing when advancing questions.
  useEffect(() => {
    if (!showAnswer || !q?.answerAudio) return;

    // Always start a fresh answer-audio element from answerAudioStart, even when
    // it points at the same file as questionAudio. handleNext has already paused
    // the question audio.
    answerAudioRef.current?.pause();
    answerAudioCleanupRef.current?.();
    answerAudioCleanupRef.current = null;
    const audio = new Audio(toMediaSrc(q.answerAudio));
    audio.volume = 1;
    answerAudioRef.current = audio;
    if (q.answerAudioStart !== undefined) {
      audio.currentTime = q.answerAudioStart;
    }
    const answerEndTime = q.answerAudioEnd;
    const answerLoop = q.answerAudioLoop;
    const answerStartTime = q.answerAudioStart;
    const listeners: Array<[string, (e?: Event) => void]> = [];
    if (answerEndTime !== undefined || answerLoop) {
      const onTimeUpdate = () => {
        if (answerEndTime !== undefined && audio.currentTime >= answerEndTime) {
          if (answerLoop) {
            audio.currentTime = answerStartTime ?? 0;
          } else {
            audio.pause();
            audio.currentTime = answerEndTime;
          }
        }
      };
      audio.addEventListener('timeupdate', onTimeUpdate);
      listeners.push(['timeupdate', onTimeUpdate]);
      if (answerLoop) {
        const onEnded = () => {
          audio.currentTime = answerStartTime ?? 0;
          void safePlay(audio, { onError: onPlayError });
        };
        audio.addEventListener('ended', onEnded);
        listeners.push(['ended', onEnded]);
      }
    }
    const stopSlowWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, () => onSlowAudio('answer'));
    answerAudioCleanupRef.current = () => {
      stopSlowWatch();
      for (const [event, fn] of listeners) audio.removeEventListener(event, fn);
    };
    void safePlay(audio, { onError: onPlayError });
  }, [showAnswer, q?.answerAudio, q?.questionAudio, q?.answerAudioStart, q?.answerAudioEnd, q?.answerAudioLoop, q?.questionAudioStart, answerAudioRef, questionAudioRef, onPlayError, onSlowAudio]);

  // Auto-play question audio when a new question is shown
  useEffect(() => {
    // Reset the skip-cleanup flag at the start of every new question. Without
    // this reset, once handleNextShow sets it true (game completion), the
    // cleanup-skip leaks into any subsequent question if the component re-renders.
    skipAudioCleanupRef.current = false;
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioPlaying(false);
    // Skip when navigating backwards into a previous question's answer view
    // (qIdx changed while showAnswer is already true). The answer-audio effect
    // is about to create the answer-side element; starting question audio here
    // would produce two overlapping tracks. handleBack() handles the answer →
    // question rewind path explicitly — and that handleBack-created audio must
    // be paused on the *next* deps change, so the skip branch still registers
    // a cleanup. Without it, jumping two questions back would leave the
    // manually-created audio playing behind the next answer track.
    if (showAnswer) {
      return () => {
        questionAudioRef.current?.pause();
        questionAudioCleanupRef.current?.();
        questionAudioCleanupRef.current = null;
        questionAudioRef.current = null;
      };
    }
    if (q?.questionAudio) {
      questionAudioRef.current?.pause();
      questionAudioCleanupRef.current?.();
      const { audio, cleanup } = createQuestionAudio(q, {
        activeAudioStartRef,
        activeAudioEndRef,
        activeAudioLoopRef,
        setAudioCurrentTime,
        setAudioDuration,
        setAudioPlaying,
        onPlayError,
      });
      const stopSlowWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, () => onSlowAudio('question'));
      questionAudioRef.current = audio;
      questionAudioCleanupRef.current = () => { stopSlowWatch(); cleanup(); };
      void safePlay(audio, { onError: onPlayError });
      return () => {
        stopSlowWatch();
        cleanup();
        questionAudioCleanupRef.current = null;
        if (!skipAudioCleanupRef.current) audio.pause();
        questionAudioRef.current = null;
      };
    }
    return () => {
      questionAudioRef.current?.pause();
      questionAudioCleanupRef.current?.();
      questionAudioCleanupRef.current = null;
      questionAudioRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, q?.questionAudio, reloadKey]); // intentionally excludes showAnswer — audio keeps playing while answer is shown

  // (Cleanup on unmount is handled by the outer SimpleQuiz component)

  if (!q) return null;

  return (
    <>
      <QuizQuestionView
        key={reloadKey}
        question={q}
        questionLabel={questionLabel}
        showAnswer={showAnswer}
        audioCurrentTime={audioCurrentTime}
        audioDuration={audioDuration}
        audioPlaying={audioPlaying}
        onAudioPlayPause={handleAudioPlayPause}
        onAudioRestart={handleAudioRestart}
        onAssetFailure={onAssetFailure}
      />
      {assetFailed && !gmConnected && (
        <div className="asset-reload-button-wrap">
          <AssetReloadButton onClick={handleAssetReload} />
        </div>
      )}
    </>
  );
}

// ── Question-audio helpers ──

interface CreateQuestionAudioDeps {
  activeAudioStartRef: React.MutableRefObject<number | undefined>;
  activeAudioEndRef: React.MutableRefObject<number | undefined>;
  activeAudioLoopRef: React.MutableRefObject<boolean | undefined>;
  setAudioCurrentTime: (n: number) => void;
  setAudioDuration: (n: number) => void;
  setAudioPlaying: (b: boolean) => void;
  onPlayError: (err: unknown, attempt: number) => void;
}

function createQuestionAudio(
  q: SimpleQuizQuestion,
  deps: CreateQuestionAudioDeps,
): { audio: HTMLAudioElement; cleanup: () => void } {
  const {
    activeAudioStartRef, activeAudioEndRef, activeAudioLoopRef,
    setAudioCurrentTime, setAudioDuration, setAudioPlaying, onPlayError,
  } = deps;
  const audio = new Audio(toMediaSrc(q.questionAudio));
  audio.volume = 1;
  activeAudioStartRef.current = q.questionAudioStart;
  activeAudioEndRef.current = q.questionAudioEnd;
  activeAudioLoopRef.current = q.questionAudioLoop;
  if (q.questionAudioStart !== undefined) audio.currentTime = q.questionAudioStart;
  const onTimeUpdate = () => {
    setAudioCurrentTime(audio.currentTime);
    const end = activeAudioEndRef.current;
    if (end !== undefined && audio.currentTime >= end) {
      if (activeAudioLoopRef.current) {
        audio.currentTime = activeAudioStartRef.current ?? 0;
      } else {
        audio.pause();
        audio.currentTime = end;
      }
    }
  };
  const onEnded = () => {
    if (activeAudioLoopRef.current) {
      audio.currentTime = activeAudioStartRef.current ?? 0;
      void safePlay(audio, { onError: onPlayError });
    }
  };
  const onDuration = () => setAudioDuration(audio.duration || 0);
  const onPlay = () => setAudioPlaying(true);
  const onPause = () => setAudioPlaying(false);
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('durationchange', onDuration);
  audio.addEventListener('loadedmetadata', onDuration);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  return {
    audio,
    cleanup: () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    },
  };
}
