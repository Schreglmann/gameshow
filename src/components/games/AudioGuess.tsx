import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { GameComponentProps } from './types';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useMusicPlayer } from '@/context/MusicContext';
import { useCoverUrl } from '@/context/AudioCoverMetaContext';
import { safePlay } from '@/utils/safePlay';
import { watchMediaLoad, MEDIA_SLOW_LOAD_MS } from '@/utils/mediaLoadTimeout';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';
import { useGmConnected } from '@/hooks/useGmConnected';
import RetryImage from '@/components/common/RetryImage';
import AssetReloadButton from '@/components/common/AssetReloadButton';
import BaseGameWrapper from './BaseGameWrapper';

export default function AudioGuess(props: GameComponentProps) {
  const config = props.config as AudioGuessConfig;
  const questions = useMemo(
    () => {
      const all = config.questions || [];
      if (all.length === 0) return all;
      return [all[0], ...all.slice(1).filter(q => !q.disabled)];
    },
    [config.questions]
  );
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
      currentIndex={props.currentIndex}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }) => (
        <AudioInner
          questions={questions}
          gameTitle={config.title}
          longAudioRef={longAudioRef}
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
  questions: AudioGuessQuestion[];
  gameTitle: string;
  longAudioRef: RefObject<HTMLAudioElement | null>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function AudioInner({ questions, gameTitle, longAudioRef, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }: InnerProps) {
  const coverUrl = useCoverUrl();
  const gmConnected = useGmConnected();
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // When navigating back to an already-answered question, play long instead of short
  const playLongOnLoadRef = useRef(false);

  const q = questions[qIdx];
  const isExample = q?.isExample || qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Song ${qIdx} von ${questions.length - 1}`;

  // Eagerly prefetch the next question's audio + cover. Re-checks on answer
  // reveal as a second chance if the first attempt failed.
  const nextQ = questions[qIdx + 1];
  usePreloadAsset({
    image: nextQ?.answerImage,
    audio: nextQ?.audio,
  });

  // Tracks the scheduled "stop short clip at audioEnd" timer so we can clear
  // it when the user pauses, replays, or moves on.
  const shortStopTimerRef = useRef<number | null>(null);
  const clearShortStopTimer = useCallback(() => {
    if (shortStopTimerRef.current !== null) {
      clearTimeout(shortStopTimerRef.current);
      shortStopTimerRef.current = null;
    }
  }, []);

  // Clear failure flag when moving to a new question.
  useEffect(() => {
    setAssetFailed(false);
  }, [qIdx]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  const onPlayError = useCallback((err: unknown, attempt: number) => {
    console.warn('[asset-resilience] AudioGuess play failed', { qIdx, attempt, err });
    if (attempt >= 1) setAssetFailed(true);
  }, [qIdx]);

  const onImageFailure = useCallback(() => {
    console.warn('[asset-resilience] AudioGuess image final failure', { qIdx, src: q?.answerImage });
    setAssetFailed(true);
  }, [qIdx, q?.answerImage]);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: q.answer,
      answerImage: q.answerImage,
      nextAnswer: nextQ ? { answer: nextQ.answer } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  // Play the short clip (trimmed segment) and schedule a precise stop at
  // audioEnd. Using setTimeout instead of `timeupdate` avoids the up-to-250ms
  // overshoot caused by the browser's timeupdate cadence.
  const playShort = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !q) return;
    clearShortStopTimer();
    const start = q.audioStart ?? 0;
    audio.currentTime = start;
    void safePlay(audio, { onError: onPlayError });
    if (q.audioEnd && q.audioEnd > start) {
      const ms = (q.audioEnd - start) * 1000;
      shortStopTimerRef.current = window.setTimeout(() => {
        if (!audio.paused) audio.pause();
        shortStopTimerRef.current = null;
      }, ms);
    }
  }, [q, clearShortStopTimer, onPlayError]);

  // Play the long version (from audioStart or start of file)
  const playLong = useCallback(() => {
    const audio = longAudioRef.current;
    if (!audio || !q) return;
    audio.currentTime = q.audioStart ?? 0;
    void safePlay(audio, { onError: onPlayError });
  }, [q, longAudioRef, onPlayError]);

  // Fallback: cancel any leftover stop timer if the audio gets paused for
  // other reasons (user interaction, navigation).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPause = () => clearShortStopTimer();
    audio.addEventListener('pause', onPause);
    return () => audio.removeEventListener('pause', onPause);
  }, [clearShortStopTimer]);

  // When question changes (or gamemaster bumps reloadKey): swap src + autoplay
  useEffect(() => {
    const audio = audioRef.current;
    const longAudio = longAudioRef.current;
    if (!audio || !longAudio || !q) return;

    clearShortStopTimer();
    audio.pause();
    longAudio.pause();

    // Imperative src + load — more reliable than rendering a <source> child
    audio.src = q.audio;
    longAudio.src = q.audio;
    audio.load();
    longAudio.load();

    // Slow-load watcher: surface the retry button if neither audio element
    // becomes playable within MEDIA_SLOW_LOAD_MS. A truly broken URL fires
    // `error` quickly via safePlay's onError path; this catches the worse
    // case where the request just hangs (server overloaded, slow disk, etc).
    const stopShortWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, () => {
      console.warn('[asset-resilience] AudioGuess short audio slow-load timeout', { qIdx, src: q.audio });
      setAssetFailed(true);
    });
    const stopLongWatch = watchMediaLoad(longAudio, MEDIA_SLOW_LOAD_MS, () => {
      console.warn('[asset-resilience] AudioGuess long audio slow-load timeout', { qIdx, src: q.audio });
      setAssetFailed(true);
    });

    if (playLongOnLoadRef.current) {
      playLongOnLoadRef.current = false;
      longAudio.currentTime = q.audioStart ?? 0;
      void safePlay(longAudio, { onError: onPlayError });
    } else {
      playShort();
    }

    return () => {
      stopShortWatch();
      stopLongWatch();
      clearShortStopTimer();
      audio.pause();
      longAudio.pause();
    };
  }, [qIdx, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      audioRef.current?.pause();
      // Auto-play long version only if not already playing
      if (longAudioRef.current && q && longAudioRef.current.paused) {
        longAudioRef.current.currentTime = q.audioStart ?? 0;
        void safePlay(longAudioRef.current, { onError: onPlayError });
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
  }, [showAnswer, qIdx, questions.length, onGameComplete, q, longAudioRef, onPlayError]);

  const handleBack = useCallback((): boolean => {
    audioRef.current?.pause();
    longAudioRef.current?.pause();
    if (showAnswer) {
      setShowAnswer(false);
      // Replay short clip when un-revealing the answer
      if (audioRef.current && q) {
        audioRef.current.currentTime = q.audioStart ?? 0;
        void safePlay(audioRef.current, { onError: onPlayError });
      }
      return true;
    } else if (qIdx > 0) {
      // Going back to previous question with answer shown — play long version
      playLongOnLoadRef.current = true;
      setQIdx(prev => prev - 1);
      setShowAnswer(true);
      return true;
    }
    return false;
  }, [showAnswer, qIdx, q, longAudioRef, onPlayError]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, setNavHandler, handleBack, setBackNavHandler]);

  // Broadcast gamemaster controls. Add the "Asset neu laden" recovery button
  // only after an auto-retry has exhausted for the current question.
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    if (!showAnswer) {
      controls.push({
        type: 'button-group',
        id: 'audio-controls',
        buttons: [
          { id: 'audio-replay-short', label: 'Ausschnitt wiederholen' },
          { id: 'audio-play-long', label: 'Ganzer Song' },
        ],
      });
    }
    if (assetFailed) {
      controls.push({ type: 'button', id: 'asset-reload', label: 'Asset neu laden' });
    }
    setGamemasterControls(controls);
  }, [showAnswer, assetFailed, setGamemasterControls]);

  const handleAssetReload = useCallback(() => {
    setAssetFailed(false);
    setReloadKey(k => k + 1);
  }, []);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'audio-replay-short') playShort();
    else if (cmd.controlId === 'audio-play-long') playLong();
    else if (cmd.controlId === 'asset-reload') handleAssetReload();
  }, [playShort, playLong, handleAssetReload]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      {/* Short clip audio — same file, played with trim markers via setTimeout */}
      <audio ref={audioRef} />
      {/* Long version audio — same file, plays from audioStart through end */}
      <audio ref={longAudioRef} />

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
          {q.answerImage && (
            <RetryImage
              key={`${q.answerImage}-${reloadKey}`}
              src={coverUrl(q.answerImage) ?? q.answerImage}
              alt=""
              className="quiz-image"
              onFinalFailure={onImageFailure}
            />
          )}
        </div>
      )}

      {assetFailed && !gmConnected && (
        <div className="asset-reload-button-wrap">
          <AssetReloadButton onClick={handleAssetReload} />
        </div>
      )}
    </>
  );
}
