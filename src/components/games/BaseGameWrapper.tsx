import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import AwardPoints, { type AwardPointsWinners } from '@/components/common/AwardPoints';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
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
  /** Navigate back to the previous game (its title screen). Invoked when the
   * user presses back on the landing phase and this isn't the first game. */
  onPrevGame?: () => void;
  /** True when entered via back-navigation — start in the 'game' phase so the
   * game can open at its last question for review. See specs/game-back-review.md. */
  resumeAtEnd?: boolean;
  /** The main game content rendered in 'game' phase */
  children: (props: {
    onGameComplete: () => void;
    /** One-shot resume signal for the game's inner state: true only on the
     * initial game-phase mount after a back-arrival, so the game inits at its
     * end (last question, answer revealed). False once the game phase has been
     * left, so replaying forward after a review starts at question 0. */
    resumeAtEnd: boolean;
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
    /** Register a callback that pauses the game's currently-playing audio when
     * the countdown (deadline OR per-question timer) expires. Required for games
     * using detached `new Audio()` (SimpleQuiz, BetQuiz). Games using JSX
     * `<audio>` / `<video>` elements don't need to register — the wrapper pauses
     * every such element via a `document.querySelectorAll` fallback. The callback
     * may return a resume function (or undefined); if it does, the wrapper invokes
     * that resume function when the GM starts another deadline so the player audio
     * continues from where it left off. */
    setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void;
    /** Signal that the game has entered its answer-reveal phase. The wrapper
     * uses this to auto-hide the active countdown the moment the answer
     * appears — answer-reveal supersedes any countdown. */
    setAnswerRevealed: (revealed: boolean) => void;
    /** Declare the per-question `q.timer` countdown. Call with the duration in
     * seconds to (re)start it for the current question, or `null` to clear it.
     * The wrapper owns the absolute deadline, renders the ring on the show, and
     * broadcasts the remaining time to the GM mirror — so the game no longer
     * renders its own Timer. A GM-triggered deadline takes precedence while
     * active. See specs/gamemaster-deadline-timer.md. */
    setGameTimer: (seconds: number | null) => void;
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
  onPrevGame,
  resumeAtEnd,
  children,
}: BaseGameWrapperProps) {
  // Back-arrival resumes in the game phase (skips landing/rules); a normal
  // forward/fresh entry starts at the title. See specs/game-back-review.md.
  const [phase, setPhase] = useState<Phase>(resumeAtEnd ? 'game' : 'landing');
  // The resume is a ONE-SHOT: once the game phase is left (reviewed back to the
  // start), a later forward re-entry must start at question 0, so we stop
  // signalling resume to the game the moment we first leave the game phase.
  const leftInitialGamePhaseRef = useRef(false);
  useEffect(() => {
    if (phase !== 'game') leftInitialGamePhaseRef.current = true;
  }, [phase]);
  const childResumeAtEnd = !!resumeAtEnd && !leftInitialGamePhaseRef.current;
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
  // Per-question `q.timer` (SimpleQuiz / BetQuiz / WerKenntMehr). The game just
  // declares its duration via the `setGameTimer` render-prop; the wrapper owns
  // the absolute deadline so the show ring and the GM mirror both derive from
  // ONE source of truth. Kept SEPARATE from the GM `deadlineEndsAt` so a GM
  // deadline takes precedence (see `activeEndsAt` below).
  const [gameTimerEndsAt, setGameTimerEndsAt] = useState<number | null>(null);
  const [gameTimerTotalSeconds, setGameTimerTotalSeconds] = useState<number | null>(null);
  const [gameTimerRunning, setGameTimerRunning] = useState(false);
  // Records which timer was frozen by the last Pause / hold so Resume re-derives
  // the correct endsAt (deadline vs per-question).
  const pausedTimerKindRef = useRef<'deadline' | 'game' | null>(null);
  const stopAudioHandlerRef = useRef<(() => (() => void) | void) | null>(null);
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
  // GM per-game "mute ticking" toggle (`timer-mute-toggle` command). Suppresses
  // only the per-second tick on the show (the "time's up" finish motif still
  // plays). Persists for the whole game — resets on game change because this
  // wrapper remounts.
  const [tickMuted, setTickMuted] = useState(false);
  const deadlineActive = deadlineEndsAt !== null;
  // The currently-visible timer: a GM deadline takes precedence over a
  // per-question timer (spec: a running deadline overrides + hides q.timer).
  const activeEndsAt = deadlineEndsAt ?? gameTimerEndsAt;
  const activeTotalSeconds = deadlineActive ? deadlineTotalSeconds : gameTimerTotalSeconds;
  const activeKind: 'deadline' | 'question' | null =
    deadlineActive ? 'deadline' : (gameTimerEndsAt !== null ? 'question' : null);
  const timerActive = (deadlineRunning && deadlineActive) || (gameTimerRunning && !deadlineActive);

  // A game declares its per-question timer here. Imperative (re-arms on every
  // call) so two consecutive questions with the SAME `q.timer` value still
  // restart. Stays SEPARATE from the GM deadline, which overrides it for
  // display/broadcast via `activeEndsAt` — so a game timer running "underneath"
  // an active GM deadline resurfaces at its true remaining if the GM stops the
  // deadline mid-question.
  const setGameTimer = useCallback((seconds: number | null) => {
    if (seconds === null || !(seconds > 0)) {
      setGameTimerEndsAt(null);
      setGameTimerTotalSeconds(null);
      setGameTimerRunning(false);
      return;
    }
    setGameTimerTotalSeconds(seconds);
    setGameTimerEndsAt(Date.now() + seconds * 1000);
    setGameTimerRunning(true);
  }, []);
  // Latest endsAt values in refs so the freeze/resume helpers read fresh values
  // without being recreated (they're called from the memoized command listener).
  const deadlineEndsAtRef = useRef(deadlineEndsAt);
  deadlineEndsAtRef.current = deadlineEndsAt;
  const gameTimerEndsAtRef = useRef(gameTimerEndsAt);
  gameTimerEndsAtRef.current = gameTimerEndsAt;
  // Freeze whichever timer is active (deadline takes precedence): capture the
  // remaining ms + which kind, so Resume re-derives a fresh absolute endsAt on
  // the correct timer (a frozen absolute timestamp would keep counting down on
  // a reconnecting tab).
  const freezeActiveTimer = useCallback(() => {
    if (deadlineEndsAtRef.current !== null) {
      pausedRemainingMsRef.current = Math.max(0, deadlineEndsAtRef.current - Date.now());
      pausedTimerKindRef.current = 'deadline';
    } else if (gameTimerEndsAtRef.current !== null) {
      pausedRemainingMsRef.current = Math.max(0, gameTimerEndsAtRef.current - Date.now());
      pausedTimerKindRef.current = 'game';
    }
  }, []);
  const resumeActiveTimer = useCallback(() => {
    const remaining = pausedRemainingMsRef.current;
    if (remaining !== null) {
      if (pausedTimerKindRef.current === 'game') setGameTimerEndsAt(Date.now() + remaining);
      else setDeadlineEndsAt(Date.now() + remaining);
      pausedRemainingMsRef.current = null;
    }
    pausedTimerKindRef.current = null;
  }, []);
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
        freezeActiveTimer();
        setTimerPaused(true);
        autoPausedByHoldRef.current = true;
      }
    } else if (autoPausedByHoldRef.current) {
      resumeActiveTimer();
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
    }
  }, [holdActive, timerActive, timerPaused, freezeActiveTimer, resumeActiveTimer]);
  // Rebroadcast the active timer's remaining ms ~once per second while it runs,
  // so the GM mirror rebases it onto ITS OWN clock (skew-proof + correct on
  // reconnect) instead of trusting the show's absolute timestamp. Frozen at the
  // paused remaining while paused; null when no timer is active. Rides the
  // cached gamemaster-controls channel — a tiny field that only churns while a
  // timer runs. See specs/gamemaster-deadline-timer.md.
  const [broadcastRemainingMs, setBroadcastRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    if (activeEndsAt === null) {
      setBroadcastRemainingMs(null);
      return;
    }
    if (timerPaused) {
      setBroadcastRemainingMs(pausedRemainingMsRef.current ?? Math.max(0, activeEndsAt - Date.now()));
      return;
    }
    const emit = () => setBroadcastRemainingMs(Math.max(0, activeEndsAt - Date.now()));
    emit();
    const id = window.setInterval(emit, 1000);
    return () => window.clearInterval(id);
  }, [activeEndsAt, timerPaused]);
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
    } else if (phase === 'landing') {
      // In-game phases are exhausted — hand back-navigation to the parent, which
      // steps to the previous game, or (on the first game) out to the global
      // rules / start page. GameScreen owns the destination decision.
      onPrevGame?.();
    }
  }, [phase, backNavHandler, rules.length, onPrevGame]);

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
      // Back is always available here — the landing phase steps out to the
      // previous game / global rules / start page, and the rules phase steps
      // back to landing — so the gamemaster back button is always shown.
      return [{ type: 'nav', id: 'nav' } as GamemasterControl];
    }
    if (phase === 'game') {
      return [
        { type: 'nav', id: 'nav', hideForward: navState.hideForward, hideBack: navState.hideBack } as GamemasterControl,
        ...gameControls,
      ];
    }
    if (phase === 'points') {
      // GM control panel → mirror the frontend order (GM faces the crowd). IDs stay
      // team-keyed, so only display order changes; "Unentschieden" stays last.
      return [{
        type: 'button-group',
        id: 'award',
        label: 'Punkte vergeben',
        buttons: [
          ...teamDisplayOrder(gameState.teams.orderSwapped, true, gameState.settings.teamMirrorEnabled).map(teamKey => ({
            id: `award-${teamKey}`,
            label: teamName(gameState.teams, teamKey === 'team1' ? 1 : 2),
            variant: 'primary' as const,
          })),
          { id: 'award-draw', label: 'Unentschieden', variant: 'primary' },
        ],
      }];
    }
    return [];
  }, [phase, gameControls, navState.hideForward, navState.hideBack, gameState.teams, gameState.settings.teamMirrorEnabled]);

  useGamemasterControlsSync(allControls, phase, currentIndex, hideCorrectTracker, gameState.currentGame?.totalGames, deadlineActive, timerActive, timerPaused, answerRevealed, scrollAnchors, fullscreenMedia !== null, fullscreenOpen, broadcastRemainingMs ?? undefined, activeTotalSeconds ?? undefined, activeKind ?? undefined, tickMuted);

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
      pausedTimerKindRef.current = null;
      // NB: the per-question game timer is NOT cleared here — the game re-arms it
      // via `setGameTimer` on the new question (its effect runs first, as a child),
      // so clearing it here would clobber the fresh arm.
      if (expiryClearTimerRef.current) {
        window.clearTimeout(expiryClearTimerRef.current);
        expiryClearTimerRef.current = null;
      }
    }
  }, [gamemasterData?.questionNumber]);

  // Auto-hide the active timer the moment the game reveals its answer — the
  // countdown is no longer relevant once players see the solution. Covers both
  // the GM deadline and the per-question game timer.
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
    if (answerRevealed && gameTimerEndsAt !== null) {
      setGameTimerEndsAt(null);
      setGameTimerTotalSeconds(null);
      setGameTimerRunning(false);
    }
  }, [answerRevealed, deadlineEndsAt, gameTimerEndsAt]);

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

  // Shared expiry audio-pause, reused by both the GM deadline and the
  // per-question game timer when they reach zero.
  const pauseActiveAudioOnExpiry = useCallback(() => {
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
  }, []);

  const handleDeadlineComplete = useCallback(() => {
    // Flip off so <DeadlineTimer> renders its "Zeit abgelaufen!" state.
    setDeadlineRunning(false);
    pauseActiveAudioOnExpiry();
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
  }, [pauseActiveAudioOnExpiry]);

  // Per-question game timer reached zero: pause audio like a deadline, but keep
  // the "Zeit abgelaufen!" ring on screen (no auto-clear) until the game reveals
  // its answer / advances the question — matching the old per-question Timer.
  const handleGameTimerComplete = useCallback(() => {
    setGameTimerRunning(false);
    pauseActiveAudioOnExpiry();
  }, [pauseActiveAudioOnExpiry]);

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
      // Freeze whichever timer is active (deadline OR per-question): capture the
      // remaining ms so Resume re-derives a fresh absolute endsAt on the correct
      // timer (a frozen absolute timestamp would keep counting down on a
      // reconnecting tab).
      freezeActiveTimer();
      setTimerPaused(true);
      autoPausedByHoldRef.current = false;
    } else if (cmd.controlId === 'timer-resume') {
      resumeActiveTimer();
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
    } else if (cmd.controlId === 'timer-mute-toggle') {
      // Toggle the per-game mute of the per-second timer tick (the finish motif
      // still plays). Persists for the whole game.
      setTickMuted(m => !m);
    } else if (cmd.controlId === 'timer-stop') {
      // Remove the running timer entirely — clears both the GM deadline state
      // and the per-question game timer. The game won't re-arm until the next
      // question (its arm-effect deps don't change on stop), which reproduces
      // the old "stopped stays stopped until next question" behaviour.
      if (expiryClearTimerRef.current) {
        window.clearTimeout(expiryClearTimerRef.current);
        expiryClearTimerRef.current = null;
      }
      pausedMediaRef.current = [];
      resumeGameAudioRef.current = null;
      pausedRemainingMsRef.current = null;
      pausedTimerKindRef.current = null;
      setDeadlineRunning(false);
      setDeadlineEndsAt(null);
      setDeadlineTotalSeconds(null);
      setGameTimerEndsAt(null);
      setGameTimerTotalSeconds(null);
      setGameTimerRunning(false);
      setTimerPaused(false);
      autoPausedByHoldRef.current = false;
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
  }, [handleNav, handleBackNav, handleComplete, commandHandler, gameDispatch, resumePausedAudio, freezeActiveTimer, resumeActiveTimer]));

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
            resumeAtEnd: childResumeAtEnd,
            handleNav,
            handleBackNav,
            setNavHandler: fn => setNavHandlerState(() => fn),
            setBackNavHandler: fn => setBackNavHandlerState(() => fn),
            setGamemasterData,
            setGamemasterControls: setGameControls,
            setCommandHandler: fn => setCommandHandlerState(() => fn),
            setNavState,
            setStopAudioHandler: fn => { stopAudioHandlerRef.current = fn; },
            setAnswerRevealed: setAnswerRevealedState,
            setGameTimer,
          })}
        </div>
      )}

      {phase === 'points' && (
        <AwardPoints onComplete={handleComplete} />
      )}

      {/* One countdown ring for BOTH timer kinds: the GM deadline takes
          precedence over a per-question timer (activeEndsAt). Each has its own
          onComplete — the deadline auto-hides its badge after a few seconds,
          the game timer keeps "Zeit abgelaufen!" until the answer is revealed. */}
      {phase === 'game' && deadlineEndsAt !== null && createPortal(
        <div className="deadline-timer-portal">
          <DeadlineTimer
            endsAt={deadlineEndsAt}
            totalSeconds={deadlineTotalSeconds ?? 0}
            paused={timerPaused}
            muteTicks={tickMuted}
            onComplete={handleDeadlineComplete}
          />
        </div>,
        document.body,
      )}
      {phase === 'game' && deadlineEndsAt === null && gameTimerEndsAt !== null && createPortal(
        <div className="deadline-timer-portal">
          <DeadlineTimer
            endsAt={gameTimerEndsAt}
            totalSeconds={gameTimerTotalSeconds ?? 0}
            paused={timerPaused}
            muteTicks={tickMuted}
            onComplete={handleGameTimerComplete}
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
