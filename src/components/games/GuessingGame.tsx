import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import type { GameComponentProps } from './types';
import type { GuessingGameConfig, GuessingGameQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { formatNumber } from '@/utils/questions';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { toMediaSrc } from '@/utils/assetUrl';
import { useGameContext } from '@/context/GameContext';
import { useMusicPlayer } from '@/context/MusicContext';
import { safePlay } from '@/utils/safePlay';
import { fadeAudio } from '@/utils/fadeAudio';
import { watchMediaLoad, MEDIA_SLOW_LOAD_MS } from '@/utils/mediaLoadTimeout';
import { usePreloadAsset } from '@/hooks/usePreloadAsset';
import { useGmConnected } from '@/hooks/useGmConnected';
import AssetReloadButton from '@/components/common/AssetReloadButton';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';

export default function GuessingGame(props: GameComponentProps) {
  const config = props.config as GuessingGameConfig;
  const music = useMusicPlayer();
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  // Set to true by handleNextShow so GuessingInner's effect cleanup skips the hard pause
  const skipAudioCleanupRef = useRef(false);

  const { questions, order } = useQuestionOrder(config.questions, config.randomizeQuestions, undefined, props.gameId);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const hasAudio = questions.some(q => q.questionAudio);

  // Stop audio when this component unmounts (navigating away)
  useEffect(() => {
    return () => {
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
    };
  }, []);

  const handleNextShow = hasAudio
    ? () => {
        // Signal GuessingInner's effect cleanup to skip the hard pause
        skipAudioCleanupRef.current = true;
        // Detach the ref so the outer unmount cleanup also skips it
        const questionAudio = questionAudioRef.current;
        questionAudioRef.current = null;
        if (questionAudio) fadeAudio(questionAudio);
        // Fade background music back in
        setTimeout(() => music.fadeIn(3000), 500);
      }
    : undefined;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Jedes Team gibt seinen Tipp ab.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onRulesShow={hasAudio ? () => music.fadeOut(2000) : undefined}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setStopAudioHandler, setNavState, setAnswerRevealed }) => (
        <GuessingInner
          questions={questions}
          order={order}
          gameTitle={config.title}
          questionAudioRef={questionAudioRef}
          skipAudioCleanupRef={skipAudioCleanupRef}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setStopAudioHandler={setStopAudioHandler}
          setNavState={setNavState}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface GuessingInnerProps {
  questions: GuessingGameQuestion[];
  order: QuestionOrderHandle;
  gameTitle: string;
  questionAudioRef: React.RefObject<HTMLAudioElement | null>;
  skipAudioCleanupRef: React.RefObject<boolean>;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function GuessingInner({ questions, order, gameTitle, questionAudioRef, skipAudioCleanupRef, onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setStopAudioHandler, setNavState, setAnswerRevealed }: GuessingInnerProps) {
  const { state } = useGameContext();
  const t1 = teamName(state.teams, 1);
  const t2 = teamName(state.teams, 2);
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order);
  const [phase, setPhase] = useState<'question' | 'result'>('question');
  const [team1Guess, setTeam1Guess] = useState('');
  const [team2Guess, setTeam2Guess] = useState('');
  const [resultInfo, setResultInfo] = useState<{
    answer: number;
    t1Guess: number;
    t2Guess: number;
    t1Diff: number;
    t2Diff: number;
  } | null>(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const gmConnected = useGmConnected();

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;
  // Trim bounds, hoisted so the audio callbacks depend on plain numbers.
  const audioStart = q?.questionAudioStart ?? 0;
  const audioEnd = q?.questionAudioEnd;

  // Eagerly prefetch the next question's audio + answer image so a network
  // glitch has time to recover before the host advances.
  const nextQ = questions[qIdx + 1];
  usePreloadAsset({ image: nextQ?.answerImage, audio: nextQ?.questionAudio });

  useEffect(() => {
    setAssetFailed(false);
  }, [qKey]);

  const { open: openFullscreen } = useFullscreen();
  // The answer image appears only in the result phase — expose it then.
  useRegisterFullscreenMedia(phase === 'result' && q?.answerImage ? { type: 'image', src: q.answerImage! } : null);

  // The index is read through a ref purely so the audio callbacks stay
  // referentially stable (see SimpleQuiz for the same pattern).
  const qIdxRef = useRef(qIdx);
  qIdxRef.current = qIdx;

  const onPlayError = useCallback((err: unknown, attempt: number) => {
    console.warn('[asset-resilience] GuessingGame play failed', { qIdx: qIdxRef.current, attempt, err });
    if (attempt >= 1) setAssetFailed(true);
  }, []);

  const onSlowAudio = useCallback(() => {
    console.warn('[asset-resilience] GuessingGame audio slow-load timeout', { qIdx: qIdxRef.current });
    setAssetFailed(true);
  }, []);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: formatNumber(q.answer),
      answerImage: q.answerImage,
      nextAnswer: nextQ ? { question: nextQ.question, answer: formatNumber(nextQ.answer) } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  // GuessingGame's "answer revealed" maps to the result phase. Signal the
  // wrapper so an active deadline timer hides as soon as the answer shows.
  useEffect(() => {
    setAnswerRevealed(phase === 'result');
  }, [phase, setAnswerRevealed]);

  const doSubmit = useCallback((t1: string, t2: string) => {
    const t1Val = parseFloat(t1) || 0;
    const t2Val = parseFloat(t2) || 0;
    const answer = q!.answer;
    setResultInfo({
      answer,
      t1Guess: t1Val,
      t2Guess: t2Val,
      t1Diff: Math.abs(t1Val - answer),
      t2Diff: Math.abs(t2Val - answer),
    });
    setPhase('result');
  }, [q]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    doSubmit(team1Guess, team2Guess);
  };

  const handleNext = useCallback(() => {
    if (phase === 'result') {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setPhase('question');
        setTeam1Guess('');
        setTeam2Guess('');
        setResultInfo(null);
      } else {
        // Last question: let audio keep playing until "next game" is pressed
        onGameComplete();
      }
    }
  }, [phase, qIdx, questions.length, onGameComplete, setQIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  const handleAudioPlayPause = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    if (audio.paused) void safePlay(audio, { onError: onPlayError });
    else audio.pause();
  }, [questionAudioRef, onPlayError]);

  const handleAudioRestart = useCallback(() => {
    const audio = questionAudioRef.current;
    if (!audio) return;
    audio.currentTime = audioStart;
    void safePlay(audio, { onError: onPlayError });
  }, [questionAudioRef, audioStart, onPlayError]);

  const handleAssetReload = useCallback(() => {
    setAssetFailed(false);
    setReloadKey(k => k + 1);
  }, []);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Question phase: GM uses input fields + submit button; nav has no meaning.
    setNavState(phase === 'question' ? { hideForward: true, hideBack: true } : {});
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
    if (phase === 'question') {
      // GM control panel → mirror the frontend order (GM faces the crowd). Input
      // IDs stay team-keyed, so only display order changes.
      controls.push({
        type: 'input-group',
        id: 'guess-submit',
        inputs: teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled).map(teamKey => ({
          id: `${teamKey}Guess`,
          label: `Tipp ${teamKey === 'team1' ? t1 : t2}`,
          inputType: 'number' as const,
          placeholder: `Tipp ${teamKey === 'team1' ? t1 : t2}`,
          value: teamKey === 'team1' ? team1Guess : team2Guess,
          emitOnChange: true,
        })),
        submitLabel: 'Tipp Abgeben',
      });
    }
    if (phase === 'result') {
      controls.push({
        type: 'button',
        id: 'next-question',
        label: 'Nächste Frage',
        variant: 'primary',
      });
    }
    if (assetFailed) {
      controls.push({ type: 'button', id: 'asset-reload', label: 'Asset neu laden' });
    }
    setGamemasterControls(controls);
  }, [phase, team1Guess, team2Guess, q?.questionAudio, audioDuration, audioPlaying, assetFailed, setGamemasterControls, setNavState, t1, t2, state.teams.orderSwapped, state.settings.teamMirrorEnabled]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'guess-submit:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM input is reflected in the
      // frontend's input fields so spectators can see the guesses being typed.
      const vals = cmd.value as Record<string, string>;
      setTeam1Guess(vals.team1Guess ?? '');
      setTeam2Guess(vals.team2Guess ?? '');
    } else if (cmd.controlId === 'guess-submit' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      const t1 = vals.team1Guess ?? '';
      const t2 = vals.team2Guess ?? '';
      setTeam1Guess(t1);
      setTeam2Guess(t2);
      doSubmit(t1, t2);
    } else if (cmd.controlId === 'next-question') {
      handleNext();
    } else if (cmd.controlId === 'audio-playpause') {
      handleAudioPlayPause();
    } else if (cmd.controlId === 'audio-restart') {
      handleAudioRestart();
    } else if (cmd.controlId === 'asset-reload') {
      handleAssetReload();
    }
  }, [doSubmit, handleNext, handleAudioPlayPause, handleAudioRestart, handleAssetReload]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Register a stop-audio handler so the GM-triggered deadline timer can pause
  // this game's detached `new Audio()` element on expiry (resumes on restart).
  useEffect(() => {
    setStopAudioHandler(() => {
      const audio = questionAudioRef.current;
      if (!audio || audio.paused) return;
      audio.pause();
      return () => { void audio.play().catch(() => {}); };
    });
    return () => setStopAudioHandler(null);
  }, [setStopAudioHandler, questionAudioRef]);

  // Auto-play question audio when a new question is shown. The audio
  // intentionally keeps playing through the result phase (the reveal doesn't
  // change qKey); it stops when advancing to the next question and fades out
  // on game completion via handleNextShow.
  useEffect(() => {
    skipAudioCleanupRef.current = false;
    setAudioCurrentTime(q?.questionAudioStart ?? 0);
    setAudioDuration(0);
    setAudioPlaying(false);
    if (!q?.questionAudio) {
      return () => {
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
      };
    }
    questionAudioRef.current?.pause();
    const audio = new Audio(toMediaSrc(q.questionAudio));
    audio.volume = 1;
    // Trim bounds captured at creation, mirroring SimpleQuiz: a mid-show edit of
    // the trim must not re-arm playback for a question that never moved.
    const start = q.questionAudioStart;
    const end = q.questionAudioEnd;
    const loop = q.questionAudioLoop;
    if (start !== undefined) audio.currentTime = start;
    const onTimeUpdate = () => {
      setAudioCurrentTime(audio.currentTime);
      if (end !== undefined && audio.currentTime >= end) {
        if (loop) {
          audio.currentTime = start ?? 0;
        } else {
          audio.pause();
          audio.currentTime = end;
        }
      }
    };
    const onEnded = () => {
      if (loop) {
        audio.currentTime = start ?? 0;
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
    const stopSlowWatch = watchMediaLoad(audio, MEDIA_SLOW_LOAD_MS, onSlowAudio);
    questionAudioRef.current = audio;
    void safePlay(audio, { onError: onPlayError });
    return () => {
      stopSlowWatch();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      if (!skipAudioCleanupRef.current) audio.pause();
      questionAudioRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, q?.questionAudio, reloadKey]);

  useQuizAutoScroll(`${qKey}:${phase}`);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {q.questionAudio && audioDuration > 0 && (
        <div className="audio-controls">
          <span className="audio-timestamp">
            {formatTime(Math.max(0, audioCurrentTime - audioStart))} / {formatTime(Math.max(0, (audioEnd ?? audioDuration) - audioStart))}
          </span>
          <span className="audio-ctrl-divider" />
          <button
            className="audio-ctrl-btn"
            onClick={handleAudioPlayPause}
            title={audioPlaying ? 'Pause' : 'Abspielen'}
            aria-label={audioPlaying ? 'Pause' : 'Abspielen'}
          >
            {audioPlaying ? (
              <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                <rect x="0" y="0" width="4" height="14" rx="1" />
                <rect x="8" y="0" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="8" height="10" viewBox="0 0 12 14" fill="currentColor">
                <polygon points="0,0 12,7 0,14" />
              </svg>
            )}
          </button>
          <button
            className="audio-ctrl-btn"
            onClick={handleAudioRestart}
            title="Von vorne"
            aria-label="Von vorne abspielen"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
              <rect x="0" y="0" width="2.5" height="14" rx="1" />
              <polygon points="14,0 3,7 14,14" />
            </svg>
          </button>
        </div>
      )}

      {assetFailed && !gmConnected && (
        <div className="asset-reload-button-wrap">
          <AssetReloadButton onClick={handleAssetReload} />
        </div>
      )}

      {phase === 'question' && (
        <form className="guess-form" onSubmit={handleSubmit}>
          <div className="guess-fields">
            {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
              const label = teamKey === 'team1' ? t1 : t2;
              const value = teamKey === 'team1' ? team1Guess : team2Guess;
              const setValue = teamKey === 'team1' ? setTeam1Guess : setTeam2Guess;
              return (
                <div className="guess-field" key={teamKey}>
                  <label htmlFor={`${teamKey}Guess`}>Tipp {label}:</label>
                  <input
                    type="number"
                    id={`${teamKey}Guess`}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    required
                  />
                </div>
              );
            })}
          </div>
          <button type="submit" className="quiz-button">
            Tipp Abgeben
          </button>
        </form>
      )}

      {phase === 'result' && resultInfo && (
        <div className="guess-result">
          <div className="guess-result-answer">
            <span className="guess-result-label">Richtige Antwort</span>
            <span className="guess-result-value">{formatNumber(resultInfo.answer)}</span>
          </div>
          <div className="guess-result-teams">
            {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
              const label = teamKey === 'team1' ? t1 : t2;
              const guess = teamKey === 'team1' ? resultInfo.t1Guess : resultInfo.t2Guess;
              const diff = teamKey === 'team1' ? resultInfo.t1Diff : resultInfo.t2Diff;
              const isTie = resultInfo.t1Diff === resultInfo.t2Diff;
              const isWinner = !isTie && diff < Math.max(resultInfo.t1Diff, resultInfo.t2Diff);
              return (
                <div className={`guess-result-team${isWinner ? ' is-winner' : ''}`} key={teamKey}>
                  <span className="guess-result-team-name">{label}</span>
                  <span className="guess-result-guess">{formatNumber(guess)}</span>
                  <span className="guess-result-diff">Differenz: {formatNumber(diff)}</span>
                  {isWinner && <span className="guess-result-badge">Näher dran!</span>}
                  {isTie && <span className="guess-result-badge is-tie">Gleichstand!</span>}
                </div>
              );
            })}
          </div>
          {q.answerImage && (
            <img
              src={toMediaSrc(q.answerImage)}
              alt=""
              className="quiz-image"
              style={{ cursor: 'pointer' }}
              onClick={() => openFullscreen({ type: 'image', src: q.answerImage! })}
            />
          )}
          <button className="quiz-button" onClick={handleNext}>
            Nächste Frage
          </button>
        </div>
      )}

    </>
  );
}
