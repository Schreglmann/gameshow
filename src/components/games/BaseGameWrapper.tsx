import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import AwardPoints, { type AwardPointsWinners } from '@/components/common/AwardPoints';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { detectShowScrollAnchors, scrollShowToAnchor } from '@/utils/scrollToCardAnchor';
import { FullscreenProvider, type FullscreenMedia } from '@/context/FullscreenContext';
import { Lightbox, VideoLightbox } from '@/components/layout/Lightbox';
import { useWsChannel } from '@/services/useBackendSocket';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand, GamemasterScrollAnchor, GamePhase, ShowHoldState } from '@/types/game';
import { PHASE_SCREEN_LABELS } from '@/types/game';

type Phase = GamePhase;

interface BaseGameWrapperProps {
  title: string;
  rules: string[];
  totalQuestions?: number;
  pointSystemEnabled: boolean;
  /** Game index (0-based); when 0, hides 'back' nav on landing/rules phases */
  currentIndex?: number;
  /** Points awarded to the winning team (should be currentIndex + 1) */
  pointValue?: number;
  /** If the game type always uses points (e.g. quizjagd, final-quiz) */
  requiresPoints?: boolean;
  /** Skip the award-points screen after game completion (e.g. final-quiz awards points inline) */
  skipPointsScreen?: boolean;
  /** Hide the gamemaster correct-answers tracker — for game types whose scoring
   * is already reflected in team points (bet-quiz, quizjagd, final-quiz). */
  hideCorrectTracker?: boolean;
  /** Called when the rules screen is shown (landing → rules transition) */
  onRulesShow?: () => void;
  /** Called when the award-points phase is shown (or at game completion if points are skipped) */
  onNextShow?: () => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  onNextGame: () => void;
  /** The main game content rendered in 'game' phase */
  children: (props: {
    onGameComplete: () => void;
    /** Navigate within game on click/keypress */
    handleNav: () => void;
    handleBackNav: () => void;
    setNavHandler: (fn: (() => void) | null) => void;
    setBackNavHandler: (fn: (() => boolean) | null) => void;
    setGamemasterData: (data: GamemasterAnswerData | null) => void;
    setGamemasterControls: (controls: GamemasterControl[]) => void;
    setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
    /** Hide Weiter / Zurück on the gamemaster nav row when the current sub-phase
     * makes them no-ops (e.g. FinalQuiz betting, GuessingGame question input). */
    setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
    /** True while a GM-triggered deadline timer is counting down. Games with their
     * own per-question Timer (SimpleQuiz, BetQuiz) should suppress it while this
     * is true so only one Timer is visible at a time. */
    deadlineActive: boolean;
    /** Register a callback that pauses the game's currently-playing audio when
     * the deadline timer expires. Required for games using detached `new Audio()`
     * (SimpleQuiz, BetQuiz). Games using JSX `<audio>` / `<video>` elements
     * don't need to register — the wrapper pauses every such element via a
     * `document.querySelectorAll` fallback. The callback may return a resume
     * function (or undefined); if it does, the wrapper invokes that resume
     * function when the GM starts another deadline timer so the player audio
     * continues from where it left off. */
    setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
    /** Signal that the game has entered its answer-reveal phase. The wrapper
     * uses this to auto-hide an active deadline timer the moment the answer
     * appears — answer-reveal supersedes any countdown. */
    setAnswerRevealed: (revealed: boolean) => void;
    /** True when the GM has paused the active timer. Games rendering a
     * per-question Timer (SimpleQuiz / BetQuiz) freeze their countdown while
     * this is true. */
    timerPaused: boolean;
    /** Games with a per-question Timer call this whenever the Timer is
     * visible so the wrapper can broadcast a unified `timerActive` flag to
     * the gamemaster toolbar (drives the Pause/Resume button visibility). */
    setGameTimerActive: (active: boolean) => void;
    /** Games with a per-question Timer register a stop callback here so the
     * GM's Stop button can clear the game's internal `timerRunning` state.
     * Returning a teardown is not required — pass `null` on unmount. */
    setStopGameTimerHandler: (fn: (() => void) | null) => void;
  }) => ReactNode;
}

export default function BaseGameWrapper({
  title,
  rules,
  totalQuestions,
  pointSystemEnabled,
  currentIndex,
  pointValue = 1,
  requiresPoints,
  skipPointsScreen,
  hideCorrectTracker,
  onRulesShow,
  onNextShow,
  onAwardPoints,
  onNextGame,
  children,
}: BaseGameWrapperProps) {
  const [phase, setPhase] = useState<Phase>('landing');
  const [navHandler, setNavHandlerState] = useState<(() => void) | null>(null);
  const [backNavHandler, setBackNavHandlerState] = useState<(() => boolean) | null>(null);
  const [gamemasterData, setGamemasterData] = useState<GamemasterAnswerData | null>(null);
  const [gameControls, setGameControls] = useState<GamemasterControl[]>([]);
  const [navState, setNavState] = useState<{ hideForward?: boolean; hideBack?: boolean }>({});
  const [commandHandler, setCommandHandlerState] = useState<((cmd: GamemasterCommand) => void) | null>(null);
  // GM-triggered deadline timer (cross-game). Driven by an ABSOLUTE deadline
  // (`deadlineEndsAt`, epoch-ms) broadcast on the cached gamemaster-controls
  // channel so a reconnecting show/GM tab shows the correct remaining time —
  // not a local counter. `deadlineTotalSeconds` feeds the ring fraction.
  const [deadlineEndsAt, setDeadlineEndsAt] = useState<number | null>(null);
  const [deadlineTotalSeconds, setDeadlineTotalSeconds] = useState<number | null>(null);
  // Remaining ms captured at the moment of Pause, so Resume re-derives a fresh
  // absolute deadline (broadcasting a frozen absolute timestamp would keep
  // counting down on a reconnecting tab).
  const pausedRemainingMsRef = useRef<number | null>(null);
  // After the countdown hits 0 we flip this off so the toolbar's Pause/Stop
  // disappear while the "Zeit abgelaufen!" badge auto-clears.
  const [deadlineRunning, setDeadlineRunning] = useState(false);
  const stopAudioHandlerRef = useRef<(() => (() => void) | void) | null>(null);
  // Games with a per-question Timer register a callback here so the GM's Stop
  // button can clear their internal `timerRunning` state (the wrapper can't
  // reach into the game otherwise).
  const stopGameTimerHandlerRef = useRef<(() => void) | null>(null);
  // Tracks DOM media paused by the last deadline expiry + the game-supplied
  // resume callback, so the next deadline start can pick up where audio
  // left off instead of leaving the question silent.
  const pausedMediaRef = useRef<HTMLMediaElement[]>([]);
  const resumeGameAudioRef = useRef<(() => void) | null>(null);
  // setTimeout id used to auto-hide the "Zeit abgelaufen!" badge a few seconds
  // after the deadline expires (so a finished countdown doesn't linger on screen).
  const expiryClearTimerRef = useRef<number | null>(null);
  const [answerRevealed, setAnswerRevealedState] = useState(false);
  // GM Pause/Resume affects both the deadline timer (above) AND the
  // per-question q.timer in SimpleQuiz / BetQuiz. The flag is set by the
  // `timer-pause` / `timer-resume` commands.
  const [timerPaused, setTimerPaused] = useState(false);
  // Tracks whether the active game has a per-question Timer rendered (set by
  // SimpleQuiz/BetQuiz). Combined with the deadline state into a single
  // `timerActive` flag broadcast to the gamemaster zone so its toolbar knows
  // when to surface the Pause/Resume button.
  const [gameTimerActive, setGameTimerActive] = useState(false);
  const deadlineActive = deadlineEndsAt !== null;
  const timerActive = (deadlineRunning && deadlineEndsAt !== null) || gameTimerActive;
  // Pause/hold overlay state (cached `show-hold` channel). When the GM drops the
  // branded "Gleich geht's weiter" screen, any running countdown must freeze and
  // resume where it left off when the hold lifts — a paused show shouldn't keep
  // burning the clock. See specs/gamemaster-cockpit.md.
  const [holdActive, setHoldActive] = useState(false);
  useWsChannel<ShowHoldState | null>('show-hold', next => setHoldActive(next?.active ?? false));
  // Only resume the timer the HOLD paused — never one the GM had paused by hand
  // before the hold. Acts on the hold edge only (guarded by the previous value)
  // so a manual resume mid-hold isn't re-paused.
  const autoPausedByHoldRef = useRef(false);
  const prevHoldRef = useRef(false);
  useEffect(() => {
    if (holdActive === prevHoldRef.current) return;
    prevHoldRef.current = holdActive;
    if (holdActive) {
      if (timerActive && !timerPaused) {
        setDeadlineEndsAt(prev => {
          if (prev !== null) pausedRemainingMsRef.current = Math.max(0, prev - Date.now());
          return prev;
        });
        setTimerPaused(true);
        autoPausedByHoldRef.current = true;
      }
    } else if (autoPausedByHoldRef.current) {
      const remaining = pausedRemainingMsRef.current;
      if (remaining !== null) {
        setDeadlineEndsAt(Date.now() + remaining);
        pausedRemainingMsRef.current = null;
      }
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
    }
  }, [holdActive, timerActive, timerPaused]);
  // Scroll jump-points available on the show, reported to the GM toolbar.
  // Non-empty only while the card overflows the viewport (see detection effect).
  const [scrollAnchors, setScrollAnchors] = useState<GamemasterScrollAnchor[]>([]);
  // Fullscreen overlay for the currently-shown image/video. The active game
  // registers its visible media (drives the GM "Vollbild" toggle); both an
  // on-show click and the GM toggle open this single overlay.
  const [fullscreenMedia, setFullscreenMedia] = useState<FullscreenMedia | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  // When a specific element is clicked on the show we enlarge exactly that one;
  // the GM toggle (no click context) falls back to the registered media.
  const [fullscreenOverride, setFullscreenOverride] = useState<FullscreenMedia | null>(null);

  const { state: gameState, dispatch: gameDispatch } = useGameContext();

  const syncData = useMemo((): GamemasterAnswerData | null => {
    if (phase === 'game') return gamemasterData;
    return {
      gameTitle: title,
      questionNumber: 0,
      totalQuestions: totalQuestions ?? 0,
      answer: '',
      screenLabel: PHASE_SCREEN_LABELS[phase],
    };
  }, [phase, gamemasterData, title, totalQuestions]);

  useGamemasterSync(syncData);

  const shouldShowPoints = !skipPointsScreen && (pointSystemEnabled || requiresPoints);

  const handleNav = useCallback(() => {
    // Proceeding (reveal answer / next question / phase change) supersedes a
    // fullscreen overlay — close it so the host never advances behind it.
    setFullscreenOpen(false);
    setFullscreenOverride(null);
    if (phase === 'landing') {
      if (rules.length > 0) {
        setPhase('rules');
        onRulesShow?.();
      } else {
        setPhase('game');
      }
    } else if (phase === 'rules') {
      setPhase('game');
    } else if (phase === 'game') {
      navHandler?.();
    }
  }, [phase, navHandler]);

  const handleBackNav = useCallback(() => {
    setFullscreenOpen(false);
    setFullscreenOverride(null);
    if (phase === 'game') {
      const handled = backNavHandler?.() ?? false;
      if (!handled) {
        if (rules.length > 0) {
          setPhase('rules');
        } else {
          setPhase('landing');
        }
      }
    } else if (phase === 'rules') {
      setPhase('landing');
    }
  }, [phase, backNavHandler, rules.length]);

  useKeyboardNavigation({
    onNext: handleNav,
    onBack: handleBackNav,
    enabled: phase !== 'points',
  });

  const onGameComplete = useCallback(() => {
    if (shouldShowPoints) {
      setPhase('points');
      onNextShow?.();
    } else {
      // Inline-scored games (bet-quiz / quizjagd / final-quiz / wer-kennt-mehr
      // count modes) award points directly and never reach the AwardPoints
      // multiplier below. If an Aufholjoker was armed, this inline game consumed
      // the "next game" slot without doubling — clear it so it doesn't bleed
      // into a later game. (Documented limitation: the ×2 applies only to
      // AwardPoints games. See specs/comeback-joker.md.)
      if (gameState.teams.doubleNextGame) gameDispatch({ type: 'CLEAR_DOUBLE_NEXT_GAME' });
      onNextShow?.();
      onNextGame();
    }
  }, [shouldShowPoints, onNextShow, onNextGame, gameState.teams.doubleNextGame, gameDispatch]);

  const handleComplete = useCallback(
    (winners: AwardPointsWinners) => {
      // Aufholjoker: the armed team's positional points double for this award,
      // then the flag clears. Multiply the POSITIONAL value (never hardcode 2).
      const armed = gameState.teams.doubleNextGame;
      const ptsFor = (team: 'team1' | 'team2') => (armed === team ? pointValue * 2 : pointValue);
      if (winners.team1) onAwardPoints('team1', ptsFor('team1'));
      if (winners.team2) onAwardPoints('team2', ptsFor('team2'));
      if (armed) gameDispatch({ type: 'CLEAR_DOUBLE_NEXT_GAME' });
      onNextGame();
    },
    [onAwardPoints, pointValue, onNextGame, gameState.teams.doubleNextGame, gameDispatch]
  );

  // Build controls based on current phase
  const allControls = useMemo((): GamemasterControl[] => {
    if (phase === 'landing' || phase === 'rules') {
      return [{ type: 'nav', id: 'nav', hideBack: currentIndex === 0 } as GamemasterControl];
    }
    if (phase === 'game') {
      return [
        { type: 'nav', id: 'nav', hideForward: navState.hideForward, hideBack: navState.hideBack } as GamemasterControl,
        ...gameControls,
      ];
    }
    if (phase === 'points') {
      return [{
        type: 'button-group',
        id: 'award',
        label: 'Punkte vergeben',
        buttons: [
          { id: 'award-team1', label: teamName(gameState.teams, 1), variant: 'primary' },
          { id: 'award-team2', label: teamName(gameState.teams, 2), variant: 'primary' },
          { id: 'award-draw', label: 'Unentschieden', variant: 'primary' },
        ],
      }];
    }
    return [];
  }, [phase, gameControls, currentIndex, navState.hideForward, navState.hideBack, gameState.teams]);

  useGamemasterControlsSync(allControls, phase, currentIndex, hideCorrectTracker, gameState.currentGame?.totalGames, deadlineActive, timerActive, timerPaused, answerRevealed, scrollAnchors, fullscreenMedia !== null, fullscreenOpen, deadlineEndsAt ?? undefined, deadlineTotalSeconds ?? undefined);

  // Report which scroll jump-points the show currently exposes so the GM
  // toolbar can offer them — but only while the card overflows the viewport.
  // Mirrors useQuizAutoScroll's measurement strategy (offsetTop/offsetHeight,
  // observed for async growth from reveals / image loads). Runs on the show;
  // the controls sync gates emission to the active show tab.
  const questionNumber = gamemasterData?.questionNumber;
  useLayoutEffect(() => {
    if (phase !== 'game') {
      setScrollAnchors(prev => (prev.length ? [] : prev));
      return;
    }
    const update = () => {
      const next = detectShowScrollAnchors();
      setScrollAnchors(prev =>
        prev.length === next.length && prev.every((a, i) => a === next[i]) ? prev : next,
      );
    };
    update();
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    const header = document.querySelector('header') as HTMLElement | null;
    const observer = new ResizeObserver(update);
    if (card) observer.observe(card);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [phase, answerRevealed, questionNumber]);

  // Clear an active deadline timer whenever the question changes — deadlines
  // are per-question and must not bleed forward.
  const lastQuestionRef = useRef<number | undefined>(gamemasterData?.questionNumber);
  useEffect(() => {
    const current = gamemasterData?.questionNumber;
    if (current !== undefined && current !== lastQuestionRef.current) {
      lastQuestionRef.current = current;
      setDeadlineEndsAt(null);
      setDeadlineTotalSeconds(null);
      setDeadlineRunning(false);
      pausedRemainingMsRef.current = null;
      setFullscreenOpen(false);
      setFullscreenOverride(null);
      // The previous question's audio is no longer relevant — discard any
      // pending resume state so we don't try to replay a stale element.
      pausedMediaRef.current = [];
      resumeGameAudioRef.current = null;
      setAnswerRevealedState(false);
      setTimerPaused(false);
      if (expiryClearTimerRef.current) {
        window.clearTimeout(expiryClearTimerRef.current);
        expiryClearTimerRef.current = null;
      }
    }
  }, [gamemasterData?.questionNumber]);

  // Auto-hide the deadline timer the moment the game reveals its answer —
  // the countdown is no longer relevant once players see the solution.
  useEffect(() => {
    if (answerRevealed && deadlineEndsAt !== null) {
      setDeadlineEndsAt(null);
      setDeadlineTotalSeconds(null);
      setDeadlineRunning(false);
      pausedRemainingMsRef.current = null;
      if (expiryClearTimerRef.current) {
        window.clearTimeout(expiryClearTimerRef.current);
        expiryClearTimerRef.current = null;
      }
    }
  }, [answerRevealed, deadlineEndsAt]);

  // Close the fullscreen overlay the moment its media leaves the screen
  // (game hid it / advanced), so it can't linger over unrelated content.
  useEffect(() => {
    if (!fullscreenMedia) {
      setFullscreenOpen(false);
      setFullscreenOverride(null);
    }
  }, [fullscreenMedia]);

  // Stable fullscreen API exposed to descendant game components.
  const openFullscreen = useCallback((media?: FullscreenMedia) => {
    setFullscreenOverride(media ?? null);
    setFullscreenOpen(true);
  }, []);
  const closeFullscreen = useCallback(() => {
    setFullscreenOpen(false);
    setFullscreenOverride(null);
  }, []);
  const toggleFullscreen = useCallback(() => {
    setFullscreenOverride(null);
    setFullscreenOpen(o => !o);
  }, []);
  const fullscreenValue = useMemo(() => ({
    currentMedia: fullscreenMedia,
    isOpen: fullscreenOpen,
    registerMedia: setFullscreenMedia,
    open: openFullscreen,
    close: closeFullscreen,
    toggle: toggleFullscreen,
  }), [fullscreenMedia, fullscreenOpen, openFullscreen, closeFullscreen, toggleFullscreen]);
  // What the overlay actually shows: the clicked element if any, else the
  // registered "primary" media (the GM toggle target).
  const fullscreenShown = fullscreenOverride ?? fullscreenMedia;

  const handleDeadlineComplete = useCallback(() => {
    // Flip off so <Timer> renders its "Zeit abgelaufen!" state.
    setDeadlineRunning(false);
    // Detached `new Audio()` instances (SimpleQuiz / BetQuiz) — game-registered.
    // The handler may return a resume callback that we replay on the next start.
    const resume = stopAudioHandlerRef.current?.();
    resumeGameAudioRef.current = typeof resume === 'function' ? resume : null;
    // JSX <audio>/<video> elements (Bandle, AudioGuess, VideoGuess) — find them
    // in the DOM. Only remember the ones that were actually playing so we don't
    // spuriously start media the GM had already paused.
    const paused: HTMLMediaElement[] = [];
    document.querySelectorAll('audio, video').forEach(m => {
      const media = m as HTMLMediaElement;
      if (!media.paused) {
        try { media.pause(); paused.push(media); } catch { /* ignore */ }
      }
    });
    pausedMediaRef.current = paused;
    // Hide the expired "Zeit abgelaufen!" badge after a short delay so it
    // doesn't linger on screen indefinitely.
    if (expiryClearTimerRef.current) {
      window.clearTimeout(expiryClearTimerRef.current);
    }
    expiryClearTimerRef.current = window.setTimeout(() => {
      setDeadlineEndsAt(null);
      setDeadlineTotalSeconds(null);
      expiryClearTimerRef.current = null;
    }, 4000);
  }, []);

  // Cancel any pending auto-hide timeout if BaseGameWrapper unmounts (the
  // game advanced past this question or the user navigated away).
  useEffect(() => () => {
    if (expiryClearTimerRef.current) {
      window.clearTimeout(expiryClearTimerRef.current);
      expiryClearTimerRef.current = null;
    }
  }, []);

  // Resume any audio paused by a previous deadline expiry. Called whenever
  // the GM starts a new deadline (different duration after expiry, or same
  // duration after Stop / a fresh press).
  const resumePausedAudio = useCallback(() => {
    if (resumeGameAudioRef.current) {
      try { resumeGameAudioRef.current(); } catch { /* ignore */ }
      resumeGameAudioRef.current = null;
    }
    pausedMediaRef.current.forEach(m => {
      try { void m.play().catch(() => {}); } catch { /* ignore */ }
    });
    pausedMediaRef.current = [];
  }, []);

  // Route incoming commands from the gamemaster
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward') {
      handleNav();
    } else if (cmd.controlId === 'nav-forward-long') {
      // Long-press ArrowRight: forward to game (Bandle uses this to reveal answer),
      // fall back to normal nav if the game doesn't handle it. Either way it's a
      // proceed action, so close any open fullscreen overlay first.
      setFullscreenOpen(false);
      setFullscreenOverride(null);
      if (commandHandler) {
        commandHandler(cmd);
      } else {
        handleNav();
      }
    } else if (cmd.controlId === 'nav-back') {
      handleBackNav();
    } else if (cmd.controlId === 'award-team1') {
      handleComplete({ team1: true, team2: false });
    } else if (cmd.controlId === 'award-team2') {
      handleComplete({ team1: false, team2: true });
    } else if (cmd.controlId === 'award-draw') {
      handleComplete({ team1: true, team2: true });
    } else if (cmd.controlId === 'use-joker' && cmd.value && typeof cmd.value === 'object') {
      const { team, jokerId, used } = cmd.value as { team?: string; jokerId?: string; used?: string };
      if ((team === 'team1' || team === 'team2') && typeof jokerId === 'string') {
        gameDispatch({
          type: 'SET_JOKER_USED',
          payload: { team, jokerId, used: used !== 'false' },
        });
      }
    } else if (cmd.controlId === 'toggle-fullscreen') {
      // GM toggle has no click context — always show the registered media.
      setFullscreenOverride(null);
      setFullscreenOpen(o => !o);
    } else if (cmd.controlId === 'timer-pause') {
      // Freeze the absolute deadline: capture remaining ms so Resume re-derives
      // a fresh deadline (broadcasting a frozen absolute timestamp would keep
      // counting down on a reconnecting tab).
      setDeadlineEndsAt(prev => {
        if (prev !== null) pausedRemainingMsRef.current = Math.max(0, prev - Date.now());
        return prev;
      });
      setTimerPaused(true);
      autoPausedByHoldRef.current = false;
    } else if (cmd.controlId === 'timer-resume') {
      const remaining = pausedRemainingMsRef.current;
      if (remaining !== null) {
        setDeadlineEndsAt(Date.now() + remaining);
        pausedRemainingMsRef.current = null;
      }
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
    } else if (cmd.controlId === 'timer-stop') {
      // Remove the running timer entirely — clears both the GM deadline
      // state and any per-question q.timer registered by the active game.
      if (expiryClearTimerRef.current) {
        window.clearTimeout(expiryClearTimerRef.current);
        expiryClearTimerRef.current = null;
      }
      pausedMediaRef.current = [];
      resumeGameAudioRef.current = null;
      pausedRemainingMsRef.current = null;
      setDeadlineRunning(false);
      setDeadlineEndsAt(null);
      setDeadlineTotalSeconds(null);
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
      stopGameTimerHandlerRef.current?.();
    } else if (cmd.controlId.startsWith('scroll-to:')) {
      // GM jump-to-scroll-point — purely a viewport effect on the show, no
      // game-state change. No-op if the target landmark isn't present.
      scrollShowToAnchor(cmd.controlId.slice('scroll-to:'.length) as GamemasterScrollAnchor);
    } else if (cmd.controlId === 'deadline-extend') {
      // "+10s": push the active deadline 10s later (or extend the paused
      // remaining), and grow the total so the ring stays proportional.
      const EXTEND_MS = 10_000;
      if (timerPaused && pausedRemainingMsRef.current !== null) {
        pausedRemainingMsRef.current += EXTEND_MS;
        setDeadlineTotalSeconds(t => (t === null ? null : t + 10));
      } else {
        setDeadlineEndsAt(prev => (prev === null ? prev : prev + EXTEND_MS));
        setDeadlineTotalSeconds(t => (t === null ? null : t + 10));
      }
    } else if (cmd.controlId.startsWith('deadline-')) {
      const secs = parseInt(cmd.controlId.slice('deadline-'.length), 10);
      if (Number.isFinite(secs) && secs > 0) {
        if (expiryClearTimerRef.current) {
          window.clearTimeout(expiryClearTimerRef.current);
          expiryClearTimerRef.current = null;
        }
        resumePausedAudio();
        pausedRemainingMsRef.current = null;
        setDeadlineTotalSeconds(secs);
        setDeadlineEndsAt(Date.now() + secs * 1000);
        setDeadlineRunning(true);
        setTimerPaused(false);
        autoPausedByHoldRef.current = false;
      }
    } else {
      commandHandler?.(cmd);
    }
  }, [handleNav, handleBackNav, handleComplete, commandHandler, gameDispatch, resumePausedAudio]));

  return (
    <FullscreenProvider value={fullscreenValue}>
      {phase === 'landing' && (
        <div id="landingScreen" className="quiz-container">
          <h2>{title}</h2>
        </div>
      )}

      {phase === 'rules' && (
        <div id="rulesScreen" className="quiz-container">
          <h3>Regeln:</h3>
          <ul id="rulesList">
            {rules.map((rule, i) => (
              <li key={`${rule}-${i}`}>{rule}</li>
            ))}
            {totalQuestions !== undefined && totalQuestions > 0 && (
              <li>Es gibt insgesamt {totalQuestions} Fragen.</li>
            )}
          </ul>
        </div>
      )}

      {phase === 'game' && (
        <div id="gameScreen" className="quiz-container">
          {children({
            onGameComplete,
            handleNav,
            handleBackNav,
            setNavHandler: fn => setNavHandlerState(() => fn),
            setBackNavHandler: fn => setBackNavHandlerState(() => fn),
            setGamemasterData,
            setGamemasterControls: setGameControls,
            setCommandHandler: fn => setCommandHandlerState(() => fn),
            setNavState,
            deadlineActive,
            setStopAudioHandler: fn => { stopAudioHandlerRef.current = fn; },
            setAnswerRevealed: setAnswerRevealedState,
            timerPaused,
            setGameTimerActive,
            setStopGameTimerHandler: fn => { stopGameTimerHandlerRef.current = fn; },
          })}
        </div>
      )}

      {phase === 'points' && (
        <AwardPoints onComplete={handleComplete} />
      )}

      {phase === 'game' && deadlineEndsAt !== null && createPortal(
        <div className="deadline-timer-portal">
          <DeadlineTimer
            endsAt={deadlineEndsAt}
            totalSeconds={deadlineTotalSeconds ?? 0}
            paused={timerPaused}
            onComplete={handleDeadlineComplete}
          />
        </div>,
        document.body,
      )}

      {fullscreenOpen && fullscreenShown?.type === 'image' && (
        <Lightbox src={fullscreenShown.src} onClose={closeFullscreen} />
      )}
      {fullscreenOpen && fullscreenShown?.type === 'video' && (
        <VideoLightbox src={fullscreenShown.src} videoRef={fullscreenShown.videoRef} onClose={closeFullscreen} />
      )}
    </FullscreenProvider>
  );
}
