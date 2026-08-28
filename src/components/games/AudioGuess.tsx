import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import type { GameComponentProps } from './types';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useMusicPlayer } from '@/context/MusicContext';
import { useCoverUrl } from '@/context/AudioCoverMetaContext';
import { safePlay } from '@/utils/safePlay';
import { watchMediaLoad, MEDIA_SLOW_LOAD_MS } from '@/utils/mediaLoadTimeout';
import { toMediaSrc } from '@/utils/assetUrl';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';
import { useGmConnected } from '@/hooks/useGmConnected';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import RetryImage from '@/components/common/RetryImage';
import AssetReloadButton from '@/components/common/AssetReloadButton';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';

export default function AudioGuess(props: GameComponentProps) {
  const config = props.config as AudioGuessConfig;
  // Never randomized, but still routed through useQuestionOrder: it is what keeps
  // the host on the same question when one is added or removed live.
  // See specs/live-question-order.md.
  const { questions, order } = useQuestionOrder(config.questions || [], false, undefined, props.gameId);
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const music = useMusicPlayer();
  const longAudioRef = useRef<HTMLAudioElement | null>(null);
  // True while the end-of-game fade-out owns the long-audio element. AudioInner
  // unmounts the moment the host advances to the points screen, and its cleanup
  // used to pause the element immediately — cutting the song dead instead of
  // letting the 2s fade play. Only one owner may stop it.
  const fadingOutRef = useRef(false);

  // Stop audio when navigating away
  useEffect(() => {
    return () => {
      longAudioRef.current?.pause();
    };
  }, []);

  const handleNextShow = () => {
    const audio = longAudioRef.current;
    if (audio && !audio.paused) {
      fadingOutRef.current = true;
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
          audio.volume = startVolume;
          fadingOutRef.current = false;
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
      currentIndex={props.currentIndex}
      onRulesShow={() => music.fadeOut(2000)}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
      order={order}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }) => (
        <AudioInner
          questions={questions}
          order={order}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          longAudioRef={longAudioRef}
          fadingOutRef={fadingOutRef}
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
  order: QuestionOrderHandle;
  resumeAtEnd: boolean;
  gameTitle: string;
  longAudioRef: RefObject<HTMLAudioElement | null>;
  fadingOutRef: RefObject<boolean>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function AudioInner({ questions, order, resumeAtEnd, gameTitle, longAudioRef, fadingOutRef, onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setAnswerRevealed }: InnerProps) {
  const coverUrl = useCoverUrl();
  const gmConnected = useGmConnected();
  const { open: openFullscreen } = useFullscreen();
  // Resuming (back-navigation): open at the last question, answer revealed.
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  // Read through a ref so the asset callbacks stay referentially stable — an
  // identity change on a compensating index shift would restart playback for a
  // question that never moved.
  const qIdxRef = useRef(qIdx);
  qIdxRef.current = qIdx;
  const [showAnswer, setShowAnswer] = useState(resumeAtEnd);
  const [assetFailed, setAssetFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // When navigating back to an already-answered question, play long instead of short
  const playLongOnLoadRef = useRef(false);

  const q = questions[qIdx];

  // Cover art is the answer reveal — expose it to fullscreen only once shown.
  useRegisterFullscreenMedia(showAnswer && q?.answerImage ? { type: 'image', src: q.answerImage } : null);

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
  // Removes a not-yet-fired `playing` listener from a previous playShort, so a
  // superseded arm can never schedule a stop for the wrong segment.
  const shortArmCleanupRef = useRef<(() => void) | null>(null);
  const clearShortStopTimer = useCallback(() => {
    if (shortStopTimerRef.current !== null) {
      clearTimeout(shortStopTimerRef.current);
      shortStopTimerRef.current = null;
    }
  }, []);
  const clearShortArm = useCallback(() => {
    shortArmCleanupRef.current?.();
    shortArmCleanupRef.current = null;
  }, []);

  // Clear failure flag when moving to a new question.
  useEffect(() => {
    setAssetFailed(false);
  }, [qKey]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  const onPlayError = useCallback((err: unknown, attempt: number) => {
    console.warn('[asset-resilience] AudioGuess play failed', { qIdx: qIdxRef.current, attempt, err });
    if (attempt >= 1) setAssetFailed(true);
  }, []);

  const onImageFailure = useCallback(() => {
    console.warn('[asset-resilience] AudioGuess image final failure', { qIdx: qIdxRef.current, src: q?.answerImage });
    setAssetFailed(true);
  }, [q?.answerImage]);

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
    clearShortArm();
    const start = q.audioStart ?? 0;
    const end = q.audioEnd;
    audio.currentTime = start;

    // Arm the precise stop only once playback is ACTUALLY running, and measure
    // the remaining window from the element's own clock. Arming it at call time
    // meant a slow load consumed the whole window while the clip was still
    // buffering — the timer fired before a note had played, nothing stopped the
    // element, and the full song played out over the guessing round.
    const arm = () => {
      if (!end || end <= start) return;
      clearShortStopTimer();
      const remainingMs = Math.max(0, (end - audio.currentTime) * 1000);
      shortStopTimerRef.current = window.setTimeout(() => {
        if (!audio.paused) audio.pause();
        shortStopTimerRef.current = null;
      }, remainingMs);
    };
    audio.addEventListener('playing', arm, { once: true });
    shortArmCleanupRef.current = () => audio.removeEventListener('playing', arm);

    void safePlay(audio, { onError: onPlayError });
  }, [q, clearShortStopTimer, clearShortArm, onPlayError]);

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
    audio.src = toMediaSrc(q.audio) ?? q.audio;
    longAudio.src = toMediaSrc(q.audio) ?? q.audio;
    audio.load();
    longAudio.load();

    // Slow-load watcher: surface the retry button if neither audio element
    // becomes playable within MEDIA_SLOW_LOAD_MS. A truly broken URL fires
    // `error` quickly via safePlay's onError path; this catches the worse
    // case where the request just hangs (server overloaded, slow disk, etc).
    const stopShortWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, () => {
      console.warn('[asset-resilience] AudioGuess short audio slow-load timeout', { qIdx: qIdxRef.current, src: q.audio });
      setAssetFailed(true);
    });
    const stopLongWatch = watchMediaLoad(longAudio, MEDIA_SLOW_LOAD_MS, () => {
      console.warn('[asset-resilience] AudioGuess long audio slow-load timeout', { qIdx: qIdxRef.current, src: q.audio });
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
      clearShortArm();
      audio.pause();
      // Leave the long element alone while the end-of-game fade owns it.
      if (!fadingOutRef.current) longAudio.pause();
    };
  }, [qKey, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live edit: if the CURRENT question's audio URL changes while staying on the
  // same question (a config edit pushed via content-changed, not a navigation),
  // reload the media by reusing the existing reload path. A question CHANGE is a
  // navigation — the load effect above already handles it — so re-baseline
  // without bumping. Keyed on `qKey`, so a live add/remove that only shifts the
  // index still detects a URL edit instead of reading as navigation.
  // See specs/live-config-reload.md and specs/live-question-order.md.
  const mediaBaselineRef = useRef<{ qKey: number; url: string | undefined }>({ qKey: -1, url: undefined });
  useEffect(() => {
    const prev = mediaBaselineRef.current;
    const url = q?.audio;
    if (prev.qKey === qKey && prev.url !== undefined && prev.url !== url) {
      setReloadKey(k => k + 1);
    }
    mediaBaselineRef.current = { qKey, url };
  }, [qKey, q?.audio]);

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
  }, [showAnswer, qIdx, questions.length, onGameComplete, q, longAudioRef, onPlayError, setQIdx]);

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
  }, [showAnswer, qIdx, q, longAudioRef, onPlayError, setQIdx]);

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

  // Scroll the card just below the sticky header when it overflows (e.g. a large
  // answer cover image on reveal) — same behaviour as SimpleQuiz.
  useQuizAutoScroll(`${qKey}:${showAnswer}`);

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
              onClick={() => openFullscreen({ type: 'image', src: q.answerImage! })}
              style={{ cursor: 'pointer' }}
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
