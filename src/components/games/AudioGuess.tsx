import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import type { GameComponentProps } from './types';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';
import { useMusicPlayer } from '@/context/MusicContext';
import BaseGameWrapper from './BaseGameWrapper';

export default function AudioGuess(props: GameComponentProps) {
  const config = props.config as AudioGuessConfig;
  const questions = config.questions || [];
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const music = useMusicPlayer();
  const longAudioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio when navigating away
  useEffect(() => {
    return () => {
      longAudioRef.current?.pause();
    };
  }, []);

  const handleNextShow = () => {
    const audio = longAudioRef.current;
    if (audio && !audio.paused) {
      const startVolume = audio.volume;
      const steps = 40;
      const interval = 2000 / steps;
      let step = 0;
      const timer = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVolume * (1 - step / steps));
        if (step >= steps) {
          clearInterval(timer);
          audio.pause();
        }
      }, interval);
    }
    setTimeout(() => music.fadeIn(3000), 500);
  };

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Erkennt den Song anhand eines kurzen Ausschnittes.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <AudioInner
          questions={questions}
          longAudioRef={longAudioRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: AudioGuessQuestion[];
  longAudioRef: RefObject<HTMLAudioElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function AudioInner({ questions, longAudioRef, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // When navigating back to an already-answered question, play long instead of short
  const playLongOnLoadRef = useRef(false);

  const q = questions[qIdx];
  const isExample = q?.isExample || qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Song ${qIdx} von ${questions.length - 1}`;

  // Play the short clip (trimmed segment)
  const playShort = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !q) return;
    audio.currentTime = q.audioStart ?? 0;
    audio.play().catch(() => {});
  }, [q]);

  // Play the long version (from audioStart or start of file)
  const playLong = useCallback(() => {
    const audio = longAudioRef.current;
    if (!audio || !q) return;
    audio.currentTime = q.audioStart ?? 0;
    audio.play().catch(() => {});
  }, [q, longAudioRef]);

  // Stop short clip at audioEnd
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !q?.audioEnd) return;
    const endTime = q.audioEnd;
    const onTimeUpdate = () => {
      if (audio.currentTime >= endTime) {
        audio.pause();
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => audio.removeEventListener('timeupdate', onTimeUpdate);
  }, [q, qIdx]);

  // When question changes: reload and autoplay
  useEffect(() => {
    const audio = audioRef.current;
    const longAudio = longAudioRef.current;
    if (!audio || !longAudio || !q) return;

    // Stop whatever was playing
    audio.pause();
    longAudio.pause();

    // Reload sources
    audio.load();
    longAudio.load();

    // Autoplay short or long depending on navigation direction
    if (playLongOnLoadRef.current) {
      playLongOnLoadRef.current = false;
      longAudio.currentTime = q.audioStart ?? 0;
      longAudio.play().catch(() => {});
    } else {
      audio.currentTime = q.audioStart ?? 0;
      audio.play().catch(() => {});
    }

    return () => {
      audio.pause();
      longAudio.pause();
    };
  }, [qIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      audioRef.current?.pause();
      // Auto-play long version only if not already playing
      if (longAudioRef.current && q && longAudioRef.current.paused) {
        longAudioRef.current.currentTime = q.audioStart ?? 0;
        longAudioRef.current.play().catch(() => {});
      }
    } else {
      if (qIdx < questions.length - 1) {
        longAudioRef.current?.pause();
        audioRef.current?.pause();
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        // Last question: let long audio keep playing so handleNextShow can fade it out
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete, q, longAudioRef]);

  const handleBack = useCallback(() => {
    audioRef.current?.pause();
    longAudioRef.current?.pause();
    if (showAnswer) {
      setShowAnswer(false);
      // Replay short clip when un-revealing the answer
      if (audioRef.current && q) {
        audioRef.current.currentTime = q.audioStart ?? 0;
        audioRef.current.play().catch(() => {});
      }
    } else if (qIdx > 0) {
      // Going back to previous question with answer shown — play long version
      playLongOnLoadRef.current = true;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
    }
  }, [showAnswer, qIdx, q]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {/* Short clip audio — uses same file with trim markers */}
      <audio ref={audioRef}>
        <source src={q.audio} />
      </audio>
      {/* Long version audio — same file, different start point */}
      <audio ref={longAudioRef}>
        <source src={q.audio} />
      </audio>

      {!showAnswer && (
        <div className="button-row">
          <button className="music-control-button" onClick={playShort}>
            🔄 Ausschnitt wiederholen
          </button>
          <button className="music-control-button" onClick={playLong}>
            🎵 Ganzer Song
          </button>
        </div>
      )}

      {showAnswer && (
        <div className="quiz-answer">
          <p>{q.answer}</p>
        </div>
      )}
    </>
  );
}
