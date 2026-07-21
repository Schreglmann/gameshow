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
import { teamDisplayOrder } from '@/utils/teamOrder';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function BetQuiz(props: GameComponentProps) {
  const config = props.config as BetQuizConfig;
  const music = useMusicPlayer();
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit, props.gameId);

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
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setStopAudioHandler, setAnswerRevealed, setGameTimer }) => (
        <BetQuizInner
          questions={questions}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          pointSystemEnabled={props.pointSystemEnabled}
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
          setStopAudioHandler={setStopAudioHandler}
          setAnswerRevealed={setAnswerRevealed}
          setGameTimer={setGameTimer}
        />
      )}
    </BaseGameWrapper>
  );
}

type Phase = 'category' | 'question' | 'answer';

interface InnerProps {
  questions: SimpleQuizQuestion[];
  resumeAtEnd: boolean;
  gameTitle: string;
  pointSystemEnabled: boolean;
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
  setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
  setAnswerRevealed: (revealed: boolean) => void;
  setGameTimer: (seconds: number | null) => void;
}

function BetQuizInner({
  questions,
  resumeAtEnd,
  gameTitle,
  pointSystemEnabled,
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
  setStopAudioHandler,
  setAnswerRevealed,
  setGameTimer,
}: InnerProps) {
  const { state } = useGameContext();
  // Resuming (back-navigation): open at the last question's answer phase. The
  // live bet/result of that round isn't reconstructed — the answer is shown for
  // review (see specs/game-back-review.md).
  const [qIdx, setQIdx] = useState(() => (resumeAtEnd ? Math.max(0, questions.length - 1) : 0));
  const [phase, setPhase] = useState<Phase>(resumeAtEnd ? 'answer' : 'category');
  const [bettingTeam, setBettingTeam] = useState<'team1' | 'team2' | null>(null);
  const [bet, setBet] = useState('');
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null);
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
    if (phase === 'category') {
      // With points off there's no bet to place — nav-forward simply reveals the
      // question. With points on, only the explicit "Frage anzeigen" button
      // submits the bet, to avoid accidentally skipping while typing.
      if (!pointSystemEnabled) setPhase('question');
      return;
    } else if (phase === 'question') {
      setPhase('answer');
      if (q?.answerAudio) {
        questionAudioRef.current?.pause();
        questionAudioRef.current = null;
      }
    } else if (phase === 'answer') {
      // Points on: advancement happens only when the host judges Richtig/Falsch.
      // Points off: no judging — nav-forward just moves to the next question.
      if (!pointSystemEnabled) advanceToNext();
    }
  }, [phase, q?.answerAudio, questionAudioRef, pointSystemEnabled, advanceToNext]);

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
      // Points off: no bet to place — leave nav-forward visible so "Weiter" reveals
      // the question (only hide Back on the very first question).
      setNavState(pointSystemEnabled ? { hideForward: true, hideBack: true } : { hideBack: qIdx === 0 });
    } else if (phase === 'answer') {
      // Points off: nav-forward advances to the next question (no judging).
      setNavState(pointSystemEnabled ? { hideForward: true } : {});
    } else {
      setNavState({});
    }
    if (phase === 'category' && pointSystemEnabled) {
      const team1Sub = team1Members.length > 0 ? team1Members.join(', ') : undefined;
      const team2Sub = team2Members.length > 0 ? team2Members.join(', ') : undefined;
      // GM control panel → mirror the frontend order (GM faces the crowd).
      const teamSubs = { team1: team1Sub, team2: team2Sub };
      controls.push({
        type: 'button-group',
        id: 'team-selection',
        label: 'Wettgewinner',
        buttons: teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled).map(teamKey => ({
          id: `select-${teamKey}`,
          label: teamLabels[teamKey],
          sublabel: teamSubs[teamKey],
          variant: 'primary' as const,
          active: bettingTeam === teamKey,
        })),
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
      if (pointSystemEnabled && bettingTeam !== null) {
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
  }, [phase, pointSystemEnabled, bettingTeam, bet, betValid, betCapExceeded, betNum, result, qIdx, questions.length, isExample, q?.questionAudio, audioDuration, audioPlaying, team1Members, team2Members, team1Points, team2Points, currentTeamPoints, teamLabels, state.teams.orderSwapped, state.settings.teamMirrorEnabled, setGamemasterControls, setNavState]);

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
  // Declare the per-question `q.timer` to BaseGameWrapper, which owns the
  // countdown (renders the ring on the show + broadcasts remaining to the GM).
  // Armed only during the question phase; cleared otherwise. A GM `timer-stop`
  // clears it in the wrapper and it won't re-arm until the next question.
  useEffect(() => {
    setGameTimer(phase === 'question' && q?.timer ? q.timer : null);
  }, [qIdx, phase, q?.timer, setGameTimer]);

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
        {/* Points off: no betting and no "Frage anzeigen" button — nav-forward
            (keyboard / gamemaster) reveals the question. */}
        {pointSystemEnabled && (
          <div className="bet-quiz-host-panel">
            <div className="bet-quiz-host-row">
              {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
                const members = teamKey === 'team1' ? team1Members : team2Members;
                return (
                  <div className="bet-quiz-team-choice" key={teamKey}>
                    {members.length > 0 && (
                      <div className="bet-quiz-team-members">{members.join(', ')}</div>
                    )}
                    <button
                      type="button"
                      className={`quiz-button${bettingTeam === teamKey ? ' active' : ''}`}
                      onClick={() => setBettingTeam(teamKey)}
                    >
                      {teamLabels[teamKey]}
                    </button>
                  </div>
                );
              })}
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
        )}
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
