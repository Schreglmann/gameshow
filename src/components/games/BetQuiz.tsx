import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { BetQuizConfig, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { toMediaSrc } from '@/utils/assetUrl';
import { fadeAudio } from '@/utils/fadeAudio';
import { useMusicPlayer } from '@/context/MusicContext';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function BetQuiz(props: GameComponentProps) {
  const config = props.config as BetQuizConfig;
  const music = useMusicPlayer();
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const hasAudio = questions.some(q => q.answerAudio || q.questionAudio);
  const skipAudioCleanupRef = useRef(false);

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
        skipAudioCleanupRef.current = true;
        const answerAudio = answerAudioRef.current;
        const questionAudio = questionAudioRef.current;
        answerAudioRef.current = null;
        questionAudioRef.current = null;
        if (answerAudio) fadeAudio(answerAudio);
        if (questionAudio) fadeAudio(questionAudio);
        setTimeout(() => music.fadeIn(3000), 500);
      }
    : undefined;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Vor jeder Frage wird die Kategorie enthüllt.',
        'Beide Teams setzen geheim einen Teil ihrer Punkte.',
        'Das Team mit dem höheren Einsatz beantwortet die Frage.',
        'Richtig = Einsatz dazu, falsch = Einsatz weg.',
      ]}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      requiresPoints
      skipPointsScreen
      hideCorrectTracker
      onRulesShow={hasAudio ? () => music.fadeOut(2000) : undefined}
      onNextShow={handleNextShow}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, deadlineActive, setStopAudioHandler, setAnswerRevealed, timerPaused, setGameTimerActive, setStopGameTimerHandler }) => (
        <BetQuizInner
          questions={questions}
          gameTitle={config.title}
          answerAudioRef={answerAudioRef}
          questionAudioRef={questionAudioRef}
          skipAudioCleanupRef={skipAudioCleanupRef}
          onGameComplete={onGameComplete}
          onAwardPoints={props.onAwardPoints}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setNavState={setNavState}
          deadlineActive={deadlineActive}
          setStopAudioHandler={setStopAudioHandler}
          setAnswerRevealed={setAnswerRevealed}
          timerPaused={timerPaused}
          setGameTimerActive={setGameTimerActive}
          setStopGameTimerHandler={setStopGameTimerHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

type Phase = 'category' | 'question' | 'answer';

interface InnerProps {
  questions: SimpleQuizQuestion[];
  gameTitle: string;
  answerAudioRef: React.RefObject<HTMLAudioElement | null>;
  questionAudioRef: React.RefObject<HTMLAudioElement | null>;
  skipAudioCleanupRef: React.RefObject<boolean>;
  onGameComplete: () => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  deadlineActive: boolean;
  setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
  timerPaused: boolean;
  setGameTimerActive: (active: boolean) => void;
  setStopGameTimerHandler: (fn: (() => void) | null) => void;
}

function BetQuizInner({
  questions,
  gameTitle,
  answerAudioRef,
  questionAudioRef,
  skipAudioCleanupRef,
  onGameComplete,
  onAwardPoints,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setGamemasterControls,
  setCommandHandler,
  setNavState,
  deadlineActive,
  setStopAudioHandler,
  setAnswerRevealed,
  timerPaused,
  setGameTimerActive,
  setStopGameTimerHandler,
}: InnerProps) {
  const { state } = useGameContext();
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('category');
  const [bettingTeam, setBettingTeam] = useState<'team1' | 'team2' | null>(null);
  const [bet, setBet] = useState('');
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  // GM Stop removes the per-question Timer from view entirely (not just
  // freezes it). Reset on every new question so navigating back/forward
  // restores the configured `q.timer` countdown.
  const [timerStopped, setTimerStopped] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;
  const showAnswer = phase === 'answer';

  const teamLabels: Record<'team1' | 'team2', string> = useMemo(
    () => ({ team1: teamName(state.teams, 1), team2: teamName(state.teams, 2) }),
    [state.teams.team1Name, state.teams.team2Name]
  );
  const team1Points = state.teams.team1Points;
  const team2Points = state.teams.team2Points;
  const team1Members = state.teams.team1;
  const team2Members = state.teams.team2;
  const currentTeamPoints = bettingTeam === 'team1' ? team1Points : bettingTeam === 'team2' ? team2Points : 0;

  // Keep latest values readable from the command handler without re-registering on every change.
  const bettingTeamRef = useRef(bettingTeam);
  bettingTeamRef.current = bettingTeam;
  const team1PointsRef = useRef(team1Points);
  team1PointsRef.current = team1Points;
  const team2PointsRef = useRef(team2Points);
  team2PointsRef.current = team2Points;

  const betNum = bet === '' ? NaN : parseInt(bet, 10);
  const betValid =
    bettingTeam !== null &&
    Number.isFinite(betNum) &&
    betNum >= 0 &&
    betNum <= currentTeamPoints;
  const betCapExceeded =
    bettingTeam !== null &&
    Number.isFinite(betNum) &&
    betNum > currentTeamPoints;

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: q.answer,
      answerImage: q.answerImage,
      extraInfo: [
        q.category ? `Kategorie: ${q.category}` : null,
        q.answerList?.join('\n'),
      ].filter(Boolean).join('\n\n') || undefined,
      nextAnswer: nextQ ? { question: nextQ.question, answer: nextQ.answer } : undefined,
    });
  }, [qIdx, gameTitle, questions, q, setGamemasterData]);

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

  const advanceToNext = useCallback(() => {
    if (qIdx < questions.length - 1) {
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
      setQIdx(prev => prev + 1);
      setPhase('category');
      setBettingTeam(null);
      setBet('');
      setResult(null);
      setTimerRunning(false);
      setTimerKey(k => k + 1);
    } else {
      onGameComplete();
    }
  }, [qIdx, questions.length, answerAudioRef, questionAudioRef, onGameComplete]);

  const judgeTeam = useCallback((correct: boolean) => {
    if (bettingTeam == null) return;
    const betApplied = Number.isFinite(betNum) ? betNum : 0;
    if (!isExample) {
      if (result !== null) {
        const prevPoints = result === 'correct' ? -betApplied : betApplied;
        onAwardPoints(bettingTeam, prevPoints);
      }
      onAwardPoints(bettingTeam, correct ? betApplied : -betApplied);
    }
    setResult(correct ? 'correct' : 'incorrect');
    // Auto-advance on judgment — no separate "Nächste Frage" button.
    advanceToNext();
  }, [bettingTeam, betNum, result, isExample, onAwardPoints, advanceToNext]);

  const submitBet = useCallback(() => {
    if (!betValid) return;
    setPhase('question');
  }, [betValid]);

  // Keyboard / nav forward
  const handleNext = useCallback(() => {
    // Category phase intentionally does NOT advance on keyboard/click — only the explicit
    // "Frage anzeigen" button submits the bet, to avoid accidentally skipping while typing.
    if (phase === 'category') {
      return;
    } else if (phase === 'question') {
      setPhase('answer');
      setTimerRunning(false);
      if (q?.answerAudio) {
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
      }
    }
    // Phase 'answer' does not auto-advance on keyboard/click — advancement happens
    // only when the host judges Richtig/Falsch.
  }, [phase, q?.answerAudio, questionAudioRef]);

  const handleBack = useCallback((): boolean => {
    if (phase === 'answer') {
      answerAudioRef.current?.pause();
      answerAudioRef.current = null;
      if (q?.questionAudio) {
        questionAudioRef.current?.pause();
        const audio = new Audio(toMediaSrc(q.questionAudio));
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
      setPhase('question');
      return true;
    }
    if (phase === 'question') {
      questionAudioRef.current?.pause();
      questionAudioRef.current = null;
      setPhase('category');
      return true;
    }
    if (phase === 'category' && qIdx > 0) {
      setQIdx(prev => prev - 1);
      setPhase('answer');
      return true;
    }
    return false;
  }, [phase, qIdx, q, answerAudioRef, questionAudioRef]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Gamemaster controls per phase
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Category: handleNext returns early; backNavHandler would rewind to the previous
    // answer screen, which is jarring when the host is selecting the betting team.
    // Answer: nav-forward is a no-op (judgment buttons advance), but Zurück still
    // rewinds to the question, so leave back visible.
    if (phase === 'category') {
      setNavState({ hideForward: true, hideBack: true });
    } else if (phase === 'answer') {
      setNavState({ hideForward: true });
    } else {
      setNavState({});
    }
    if (phase === 'category') {
      const team1Sub = team1Members.length > 0 ? team1Members.join(', ') : undefined;
      const team2Sub = team2Members.length > 0 ? team2Members.join(', ') : undefined;
      controls.push({
        type: 'button-group',
        id: 'team-selection',
        label: 'Wettgewinner',
        buttons: [
          { id: 'select-team1', label: teamLabels.team1, sublabel: team1Sub, variant: 'primary', active: bettingTeam === 'team1' },
          { id: 'select-team2', label: teamLabels.team2, sublabel: team2Sub, variant: 'primary', active: bettingTeam === 'team2' },
        ],
      });
      controls.push({
        type: 'input-group',
        id: 'betting-submit',
        inputs: [
          { id: `bet-q${qIdx}`, label: 'Einsatz', inputType: 'number', placeholder: 'Einsatz', value: bet, emitOnChange: true },
        ],
        submitLabel: 'Frage anzeigen',
        submitDisabled: bettingTeam === null,
      });
      if (betCapExceeded && bettingTeam !== null) {
        controls.push({
          type: 'info',
          id: 'bet-cap-warning',
          text: `Einsatz ${betNum} übersteigt die Punkte von ${teamLabels[bettingTeam]} (${currentTeamPoints}).`,
        });
      }
    } else if (phase === 'question') {
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
    } else if (phase === 'answer') {
      if (bettingTeam !== null) {
        controls.push({
          type: 'button-group',
          id: 'judgment',
          label: teamLabels[bettingTeam],
          buttons: [
            { id: 'judge-correct', label: 'Richtig', variant: 'success' },
            { id: 'judge-incorrect', label: 'Falsch', variant: 'danger' },
          ],
        });
      }
    }
    setGamemasterControls(controls);
  }, [phase, bettingTeam, bet, betValid, betCapExceeded, betNum, result, qIdx, questions.length, isExample, q?.questionAudio, audioDuration, audioPlaying, team1Members, team2Members, team1Points, team2Points, currentTeamPoints, teamLabels, setGamemasterControls, setNavState]);

  // Gamemaster command routing
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'select-team1') setBettingTeam('team1');
    else if (cmd.controlId === 'select-team2') setBettingTeam('team2');
    else if (cmd.controlId === 'betting-submit:change' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      const next = Object.values(vals)[0] ?? '';
      setBet(next);
    }
    else if (cmd.controlId === 'betting-submit' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      // Input key is `bet-q${qIdx}` so it resets between questions; take the single input value.
      const next = Object.values(vals)[0] ?? '';
      const n = next === '' ? NaN : parseInt(next, 10);
      const bt = bettingTeamRef.current;
      const pts = bt === 'team1' ? team1PointsRef.current : bt === 'team2' ? team2PointsRef.current : 0;
      setBet(next);
      if (bt !== null && Number.isFinite(n) && n >= 0 && n <= pts) {
        setPhase('question');
      }
    } else if (cmd.controlId === 'judge-correct') judgeTeam(true);
    else if (cmd.controlId === 'judge-incorrect') judgeTeam(false);
    else if (cmd.controlId === 'audio-playpause') handleAudioPlayPause();
    else if (cmd.controlId === 'audio-restart') handleAudioRestart();
  }, [judgeTeam, handleAudioPlayPause, handleAudioRestart]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Register a stop-audio handler so the GM-triggered deadline timer can
  // pause this game's detached `new Audio()` element on expiry. Returns a
  // resume callback the wrapper invokes on the next deadline start so the
  // player audio picks up where it left off.
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

  // Let the GM Stop button clear this game's per-question Timer.
  useEffect(() => {
    setStopGameTimerHandler(() => {
      setTimerRunning(false);
      setTimerStopped(true);
    });
    return () => setStopGameTimerHandler(null);
  }, [setStopGameTimerHandler]);

  // Reset the Stop flag on every new question so a fresh `q.timer` shows.
  useEffect(() => {
    setTimerStopped(false);
  }, [qIdx]);

  // Start timer when entering question phase
  useEffect(() => {
    if (phase === 'question' && q?.timer) setTimerRunning(true);
  }, [phase, q?.timer]);

  // Signal to BaseGameWrapper whether this game has a per-question Timer
  // currently visible. Drives the GM toolbar's Pause/Resume button visibility.
  // A GM deadline timer overrides (hides) the per-question Timer on the show, so
  // don't report it as active while one runs — otherwise the GM keeps showing it
  // as a running timer the show is no longer rendering.
  useEffect(() => {
    const active = phase === 'question' && Boolean(q?.timer) && timerRunning && !deadlineActive;
    setGameTimerActive(active);
    return () => setGameTimerActive(false);
  }, [phase, q?.timer, timerRunning, deadlineActive, setGameTimerActive]);

  // Mirror SimpleQuiz: scroll the card just below the sticky header when it
  // overflows the viewport. Re-fires on every qIdx + phase change so each new
  // screen (category / question / answer) is positioned correctly.
  useQuizAutoScroll(`${qIdx}:${phase}`);

  // Auto-play answer audio when answer is revealed
  useEffect(() => {
    if (phase === 'answer' && q?.answerAudio) {
      answerAudioRef.current?.pause();
      const audio = new Audio(toMediaSrc(q.answerAudio));
      audio.volume = 1;
      answerAudioRef.current = audio;
      if (q.answerAudioStart !== undefined) audio.currentTime = q.answerAudioStart;
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
  }, [phase, q?.answerAudio, q?.answerAudioStart, q?.answerAudioEnd, q?.answerAudioLoop, answerAudioRef]);

  // Auto-play question audio when entering question phase
  useEffect(() => {
    if (phase !== 'question' && phase !== 'answer') {
      setAudioCurrentTime(0);
      setAudioDuration(0);
      setAudioPlaying(false);
      return;
    }
    if (phase !== 'question') return;
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioPlaying(false);
    if (q?.questionAudio) {
      questionAudioRef.current?.pause();
      const audio = new Audio(toMediaSrc(q.questionAudio));
      audio.volume = 1;
      questionAudioRef.current = audio;
      const startTime = q.questionAudioStart;
      const endTime = q.questionAudioEnd;
      const loop = q.questionAudioLoop;
      if (startTime !== undefined) audio.currentTime = startTime;
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
  }, [qIdx, phase, q?.questionAudio]);

  if (!q) return null;

  if (phase === 'category') {
    return (
      <>
        <h2 className="quiz-question-number">{questionLabel}</h2>
        <div className="bet-quiz-category">{q.category || ''}</div>
        <div className="bet-quiz-host-panel">
          <div className="bet-quiz-host-row">
            <div className="bet-quiz-team-choice">
              {team1Members.length > 0 && (
                <div className="bet-quiz-team-members">{team1Members.join(', ')}</div>
              )}
              <button
                type="button"
                className={`quiz-button${bettingTeam === 'team1' ? ' active' : ''}`}
                onClick={() => setBettingTeam('team1')}
              >
                {teamLabels.team1}
              </button>
            </div>
            <div className="bet-quiz-team-choice">
              {team2Members.length > 0 && (
                <div className="bet-quiz-team-members">{team2Members.join(', ')}</div>
              )}
              <button
                type="button"
                className={`quiz-button${bettingTeam === 'team2' ? ' active' : ''}`}
                onClick={() => setBettingTeam('team2')}
              >
                {teamLabels.team2}
              </button>
            </div>
          </div>
          <div className="bet-quiz-host-row">
            <input
              type="number"
              className="guess-input betting-input"
              placeholder="Einsatz"
              value={bet}
              min={0}
              max={currentTeamPoints}
              onChange={e => setBet(e.target.value)}
            />
            <button
              type="button"
              className="quiz-button"
              disabled={!betValid}
              onClick={submitBet}
            >
              Frage anzeigen
            </button>
          </div>
          {betCapExceeded && bettingTeam !== null && (
            <div className="bet-quiz-host-hint bet-quiz-host-hint--error">
              Einsatz {betNum} übersteigt die Punkte von {teamLabels[bettingTeam]} ({currentTeamPoints}).
            </div>
          )}
        </div>
      </>
    );
  }

  const betNumber = Number.isFinite(betNum) ? betNum : 0;
  const bannerTeamLabel = bettingTeam ? teamLabels[bettingTeam] : '';
  const bannerMembers = bettingTeam === 'team1'
    ? team1Members.join(', ')
    : bettingTeam === 'team2'
      ? team2Members.join(', ')
      : '';

  return (
    <>
      {bettingTeam && (
        <div className="bet-quiz-banner">
          <span className="bet-quiz-banner-team">{bannerTeamLabel}</span>
          {bannerMembers && <span className="bet-quiz-banner-members"> · {bannerMembers}</span>}
          <span className="bet-quiz-banner-bet"> · Einsatz: {betNumber} Punkte</span>
        </div>
      )}
      <QuizQuestionView
        question={q}
        questionLabel={questionLabel}
        showAnswer={showAnswer}
        timerKey={timerKey}
        timerRunning={timerRunning && !timerPaused}
        onTimerComplete={() => setTimerRunning(false)}
        timerSuppressed={deadlineActive || timerStopped}
        audioCurrentTime={audioCurrentTime}
        audioDuration={audioDuration}
        audioPlaying={audioPlaying}
        onAudioPlayPause={handleAudioPlayPause}
        onAudioRestart={handleAudioRestart}
      />
      {phase === 'answer' && bettingTeam && (
        <div className="bet-quiz-host-panel">
          <div className="bet-quiz-host-row">
            <button
              type="button"
              className="quiz-button"
              onClick={() => judgeTeam(true)}
            >
              Richtig
            </button>
            <button
              type="button"
              className="quiz-button"
              onClick={() => judgeTeam(false)}
            >
              Falsch
            </button>
          </div>
        </div>
      )}
    </>
  );
}
