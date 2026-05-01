import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { SimpleQuizConfig, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { randomizeQuestions } from '@/utils/questions';
import { useMusicPlayer } from '@/context/MusicContext';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function SimpleQuiz(props: GameComponentProps) {
  const config = props.config as SimpleQuizConfig;
  const music = useMusicPlayer();
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions, config.questionLimit),
    [config.questions, config.randomizeQuestions, config.questionLimit]
  );

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

  const fadeAudio = (audio: HTMLAudioElement) => {
    if (audio.paused) return;
    const startVolume = audio.volume;
    const duration = 2000;
    const steps = 40;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        clearInterval(timer);
        audio.pause();
      }
    }, interval);
  };

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
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }) => (
        <QuizInner
          questions={questions}
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
        />
      )}
    </BaseGameWrapper>
  );
}

interface QuizInnerProps {
  questions: SimpleQuizQuestion[];
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
}

function QuizInner({ questions, gameTitle, answerAudioRef, questionAudioRef, skipAudioCleanupRef, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }: QuizInnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  // Active end/loop/start constraints for the question-audio element.
  // These are mutable so the same element can switch to answer-side limits
  // when questionAudio and answerAudio reference the same file.
  const activeAudioStartRef = useRef<number | undefined>(undefined);
  const activeAudioEndRef = useRef<number | undefined>(undefined);
  const activeAudioLoopRef = useRef<boolean | undefined>(undefined);
  const q = questions[qIdx];

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
      extraInfo: q.answerList?.join('\n'),
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const handleAudioPlayPause = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [questionAudioRef]);

  const handleAudioRestart = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    audio.currentTime = q?.questionAudioStart ?? 0;
    audio.play().catch(() => {});
  }, [questionAudioRef, q?.questionAudioStart]);
  const questionLabel = qIdx === 0 ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;

  // Forward nav
  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      setTimerRunning(false);
      // Stop question audio only if a *different* answer audio file will take over.
      // Same-file case: keep the existing audio element playing; the answer-audio effect
      // reuses it and swaps to answer end/loop settings.
      if (q?.answerAudio && q.answerAudio !== q.questionAudio) {
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
      }
    } else {
      if (qIdx < questions.length - 1) {
        // Stop both audios immediately when moving to the next question
        answerAudioRef.current?.pause();
        answerAudioRef.current = null;
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
        setTimerRunning(false);
        setTimerKey(k => k + 1);
      } else {
        // Last question: let audio keep playing until "next game" is pressed (unmount)
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions, q, onGameComplete]);

  // Back nav
  const handleBack = useCallback((): boolean => {
    if (showAnswer) {
      const currentQuestionAudio = questionAudioRef.current;
      const currentAnswerAudio = answerAudioRef.current;
      // If the question audio is still active — either because there's no
      // separate answer audio, or because answerAudio is the same file (so the
      // same audio element kept playing) — keep it running. Just swap back to
      // question-side start/end/loop limits and clear the answer-side ref so
      // the active timeupdate listener stops enforcing answer-side limits.
      const questionAudioStillActive =
        q?.questionAudio &&
        currentQuestionAudio &&
        (!q.answerAudio || q.answerAudio === q.questionAudio);
      if (questionAudioStillActive) {
        if (currentAnswerAudio && currentAnswerAudio !== currentQuestionAudio) {
          currentAnswerAudio.pause();
        }
        answerAudioRef.current = null;
        activeAudioStartRef.current = q.questionAudioStart;
        activeAudioEndRef.current = q.questionAudioEnd;
        activeAudioLoopRef.current = q.questionAudioLoop;
        setShowAnswer(false);
        return true;
      }
      // Otherwise: a different answerAudio took over and the question audio
      // was paused at reveal time. Stop the answer audio and restart the
      // question audio from the beginning (or questionAudioStart).
      currentAnswerAudio?.pause();
      answerAudioRef.current = null;
      if (q?.questionAudio) {
        currentQuestionAudio?.pause();
        const audio = new Audio(q.questionAudio);
        audio.volume = 1;
        questionAudioRef.current = audio;
        activeAudioStartRef.current = q.questionAudioStart;
        activeAudioEndRef.current = q.questionAudioEnd;
        activeAudioLoopRef.current = q.questionAudioLoop;
        if (q.questionAudioStart !== undefined) audio.currentTime = q.questionAudioStart;
        audio.addEventListener('timeupdate', () => {
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
        });
        audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('durationchange', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('play', () => setAudioPlaying(true));
        audio.addEventListener('pause', () => setAudioPlaying(false));
        setAudioCurrentTime(q.questionAudioStart ?? 0);
        setAudioDuration(0);
        setAudioPlaying(false);
        audio.play().catch(() => {});
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
      questionAudioRef.current = null;
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx, q, questionAudioRef, answerAudioRef]);

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
    setGamemasterControls(controls);
  }, [q?.questionAudio, audioDuration, audioPlaying, setGamemasterControls]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'audio-playpause') handleAudioPlayPause();
    else if (cmd.controlId === 'audio-restart') handleAudioRestart();
  }, [handleAudioPlayPause, handleAudioRestart]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Start timer when showing a question that has one
  useEffect(() => {
    if (q?.timer && !showAnswer) {
      setTimerRunning(true);
    }
  }, [qIdx, q?.timer, showAnswer]);

  // Position the page so the card sits just below the sticky header (with a
  // small margin) when it's taller than the viewport. Re-evaluates on question
  // change and whenever the card's height changes (audio metadata loading,
  // images loading, answer reveal). Instant scroll — no smooth animation —
  // so the first paint already shows the final position.
  useLayoutEffect(() => {
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    const header = document.querySelector('header') as HTMLElement | null;
    // Reset scroll on every question change so measurements start from a known
    // baseline (rect.top + scrollY == absolute card top).
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
      // Use offsetTop/offsetHeight instead of getBoundingClientRect — the card
      // has a `scaleIn` CSS animation on mount and getBoundingClientRect
      // reports transformed coordinates, which are smaller/shifted during the
      // animation. offsetTop/offsetHeight give the final layout dimensions.
      const cardTop = absoluteOffsetTop(card);
      const cardH = card.offsetHeight;
      const overflow = cardTop + cardH - window.innerHeight;
      const maxScroll = Math.max(0, cardTop - headerH - 8);
      // Only auto-scroll when the card is slightly taller than the viewport
      // and a small scroll can bring the bottom into view. When it fits
      // (overflow<=0) or overflows by more than the available budget, leave
      // the current scroll alone — so answer-reveal (which expands the card)
      // can smooth-scroll from the current position instead of snapping to 0.
      if (overflow <= 0 || overflow > maxScroll) return;
      const target = Math.round(Math.min(overflow + 16, maxScroll));
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
      }
    };
    applyScroll();
    // Observe both the card and the header — jokers render asynchronously on
    // first paint and the header's height settles after the card's. Without
    // observing the header, the first scroll uses an undersized header and
    // the example question ends up at a different offset than subsequent
    // ones, where the header is already at its final size.
    const observer = new ResizeObserver(applyScroll);
    observer.observe(card);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [qIdx]);

  // Auto-play answer audio when answer is revealed.
  // No cleanup here — audio intentionally keeps playing when advancing questions.
  useEffect(() => {
    if (!showAnswer || !q?.answerAudio) return;

    // Same-file case: continue playback on the existing question-audio element
    // rather than creating a new one. Swap active end/loop constraints so the
    // existing timeupdate/ended listeners start enforcing answer-side limits.
    if (q.answerAudio === q.questionAudio && questionAudioRef.current) {
      const audio = questionAudioRef.current;
      answerAudioRef.current = audio;
      activeAudioStartRef.current = q.answerAudioStart ?? q.questionAudioStart;
      activeAudioEndRef.current = q.answerAudioEnd;
      activeAudioLoopRef.current = q.answerAudioLoop;
      if (audio.paused) audio.play().catch(() => {});
      return;
    }

    // Different-file case: start a fresh answer-audio element.
    answerAudioRef.current?.pause();
    const audio = new Audio(q.answerAudio);
    audio.volume = 1;
    answerAudioRef.current = audio;
    if (q.answerAudioStart !== undefined) {
      audio.currentTime = q.answerAudioStart;
    }
    const answerEndTime = q.answerAudioEnd;
    const answerLoop = q.answerAudioLoop;
    const answerStartTime = q.answerAudioStart;
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
      if (answerLoop) {
        audio.addEventListener('ended', () => {
          audio.currentTime = answerStartTime ?? 0;
          audio.play().catch(() => {});
        });
      }
    }
    audio.play().catch(() => {});
  }, [showAnswer, q?.answerAudio, q?.questionAudio, q?.answerAudioStart, q?.answerAudioEnd, q?.answerAudioLoop, q?.questionAudioStart, answerAudioRef, questionAudioRef]);

  // Auto-play question audio when a new question is shown
  useEffect(() => {
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
        questionAudioRef.current = null;
      };
    }
    if (q?.questionAudio) {
      questionAudioRef.current?.pause();
      const audio = new Audio(q.questionAudio);
      audio.volume = 1;
      questionAudioRef.current = audio;
      activeAudioStartRef.current = q.questionAudioStart;
      activeAudioEndRef.current = q.questionAudioEnd;
      activeAudioLoopRef.current = q.questionAudioLoop;
      if (q.questionAudioStart !== undefined) {
        audio.currentTime = q.questionAudioStart;
      }
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
          audio.play().catch(() => {});
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
      audio.play().catch(() => {});
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('durationchange', onDuration);
        audio.removeEventListener('loadedmetadata', onDuration);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        if (!skipAudioCleanupRef.current) audio.pause();
        questionAudioRef.current = null;
      };
    }
    return () => {
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, q?.questionAudio]); // intentionally excludes showAnswer — audio keeps playing while answer is shown

  // (Cleanup on unmount is handled by the outer SimpleQuiz component)

  if (!q) return null;

  return (
    <QuizQuestionView
      question={q}
      questionLabel={questionLabel}
      showAnswer={showAnswer}
      timerKey={timerKey}
      timerRunning={timerRunning}
      onTimerComplete={() => {
        setTimerRunning(false);
        questionAudioRef.current?.pause();
      }}
      audioCurrentTime={audioCurrentTime}
      audioDuration={audioDuration}
      audioPlaying={audioPlaying}
      onAudioPlayPause={handleAudioPlayPause}
      onAudioRestart={handleAudioRestart}
    />
  );
}
