import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
        if (questionAudio) fadeAudio(questionAudio);
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
      // Stop question audio only if answer audio will take over; otherwise keep it playing
      if (q?.answerAudio) {
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
      // Stop answer audio
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      // Restart question audio from the beginning (or start marker)
      if (q?.questionAudio) {
        questionAudioRef.current?.pause();
        const audio = new Audio(q.questionAudio);
        audio.volume = 1;
        questionAudioRef.current = audio;
        const startTime = q.questionAudioStart;
        const endTime = q.questionAudioEnd;
        if (startTime !== undefined) audio.currentTime = startTime;
        audio.addEventListener('timeupdate', () => {
          setAudioCurrentTime(audio.currentTime);
          if (endTime !== undefined && audio.currentTime >= endTime) {
            audio.pause();
            audio.currentTime = endTime;
          }
        });
        audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('durationchange', () => setAudioDuration(audio.duration || 0));
        audio.addEventListener('play', () => setAudioPlaying(true));
        audio.addEventListener('pause', () => setAudioPlaying(false));
        setAudioCurrentTime(startTime ?? 0);
        setAudioDuration(0);
        setAudioPlaying(false);
        audio.play().catch(() => {});
      }
      setShowAnswer(false);
      return true;
    } else if (qIdx > 0) {
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

  // Scroll to top when a new question is shown
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [qIdx]);

  // Auto-play answer audio when answer is revealed.
  // No cleanup here — audio intentionally keeps playing when advancing questions.
  useEffect(() => {
    if (showAnswer && q?.answerAudio) {
      // Stop any previously playing audio before starting a new one
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
    }
  }, [showAnswer, q?.answerAudio, answerAudioRef]);

  // Auto-play question audio when a new question is shown
  useEffect(() => {
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioPlaying(false);
    if (q?.questionAudio) {
      questionAudioRef.current?.pause();
      const audio = new Audio(q.questionAudio);
      audio.volume = 1;
      questionAudioRef.current = audio;
      const startTime = q.questionAudioStart;
      const endTime = q.questionAudioEnd;
      const loop = q.questionAudioLoop;
      if (startTime !== undefined) {
        audio.currentTime = startTime;
      }
      const onTimeUpdate = () => {
        setAudioCurrentTime(audio.currentTime);
        if (endTime !== undefined && audio.currentTime >= endTime) {
          if (loop) {
            audio.currentTime = startTime ?? 0;
          } else {
            audio.pause();
            audio.currentTime = endTime;
          }
        }
      };
      const onEnded = () => {
        if (loop) {
          audio.currentTime = startTime ?? 0;
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
      onTimerComplete={() => setTimerRunning(false)}
      audioCurrentTime={audioCurrentTime}
      audioDuration={audioDuration}
      audioPlaying={audioPlaying}
      onAudioPlayPause={handleAudioPlayPause}
      onAudioRestart={handleAudioRestart}
    />
  );
}
