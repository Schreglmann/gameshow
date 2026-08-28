import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import AwardPoints, { selectedTeams, drawHint, type AwardPointsWinners, type AutoAwardVerdict } from '@/components/common/AwardPoints';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { isTeamKey, teamKeys, type TeamKey } from '@/utils/teams';
import { tallyLeader, tallyTotals } from '@/utils/correctAnswers';
import { gamePointValue } from '@/utils/pointMode';
import { detectShowScrollAnchors, scrollShowToAnchor } from '@/utils/scrollToCardAnchor';
import { FullscreenProvider, type FullscreenMedia } from '@/context/FullscreenContext';
import { Lightbox, VideoLightbox } from '@/components/layout/Lightbox';
import { useWsChannel } from '@/services/useBackendSocket';
import type { QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand, GamemasterScrollAnchor, GamePhase, ShowHoldState } from '@/types/game';
import { PHASE_SCREEN_LABELS } from '@/types/game';

type Phase = GamePhase;

/** Nothing picked yet on the award screen. Module-level so the identity is stable. */
const NO_WINNERS: AwardPointsWinners = {};

interface BaseGameWrapperProps {
  title: string;
  rules: string[];
  totalQuestions?: number;
  pointSystemEnabled: boolean;
  /** Game index (0-based); when 0, hides 'back' nav on landing/rules phases. Also
   *  the game's position, which is what the `positional` point mode scores by —
   *  games do not pass a point value, the wrapper derives it. */
  currentIndex?: number;
  /** If the game type always uses points (e.g. quizjagd, final-quiz) */
  requiresPoints?: boolean;
  /** Skip the award-points screen after game completion (e.g. final-quiz awards points inline) */
  skipPointsScreen?: boolean;
  /** Hide the gamemaster correct-answers tracker — for game types whose scoring
   * is already reflected in team points (bet-quiz, quizjagd, final-quiz). */
  hideCorrectTracker?: boolean;
  /** The game keeps the per-question tally itself (guessing-game's automatic scoring), so
   *  the gamemaster shows those counters without their edit buttons — with the show awarding
   *  the points, an edit control there would make it unclear who scored what. */
  autoScored?: boolean;
  /** Called when the rules screen is shown (landing → rules transition) */
  onRulesShow?: () => void;
  /** Called when the award-points phase is shown (or at game completion if points are skipped) */
  onNextShow?: () => void;
  onAwardPoints: (team: TeamKey, points: number) => void;
  onNextGame: () => void;
  /** Navigate back to the previous game (its title screen). Invoked when the
   * user presses back on the landing phase and this isn't the first game. */
  onPrevGame?: () => void;
  /** True when entered via back-navigation — start in the 'game' phase so the
   * game can open at its last question for review. See specs/game-back-review.md. */
  resumeAtEnd?: boolean;
  /** The game's live-stable question order, from `useQuestionOrder`. Pass it
   * whenever the game holds a question index, so the wrapper can tell a real
   * question change from a question *index* that merely shifted because a
   * question was added or removed live. See specs/live-question-order.md. */
  order?: QuestionOrderHandle;
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
    /** Hand the wrapper a verdict the game worked out itself (guessing-game's
     * `scoringMode: 'auto'`). The award screen then states who won and how many
     * questions each team took, and the host only confirms — one press books the
     * positional points for `winners` and advances. Pass `null` to fall back to the
     * manual winner selection. See specs/base-game-wrapper.md. */
    setAutoAward: (verdict: AutoAwardVerdict | null) => void;
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
  requiresPoints,
  skipPointsScreen,
  hideCorrectTracker,
  autoScored,
  onRulesShow,
  onNextShow,
  onAwardPoints,
  onNextGame,
  onPrevGame,
  resumeAtEnd,
  order,
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
  // A verdict the game computed itself (guessing-game's auto scoring). When set, the
  // award screen preselects those winners instead of starting empty.
  const [autoAward, setAutoAwardState] = useState<AutoAwardVerdict | null>(null);
  // The host's winner pick on the award screen. `null` means untouched, so a
  // preselection still shows through; the first toggle pins the selection.
  const [pickedWinners, setPickedWinners] = useState<AwardPointsWinners | null>(null);
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

  /**
   * The question a tally or point award belongs to right now, or null when
   * nothing is attributable: any non-`game` phase (so a positional award on the
   * points screen is filed under "Gesamt", not against the last question) and
   * the example question, which is never scored. Feeds both the GM (via
   * `scoringQuestion` on the answer channel, which the tally buttons write
   * against) and the reducer (via `currentQuestion`, which stamps every point
   * delta). See specs/gamemaster-question-scores.md.
   */
  const scoringQuestion = useMemo((): number | null => {
    if (phase !== 'game') return null;
    const q = gamemasterData?.questionNumber;
    return typeof q === 'number' && q > 0 ? q : null;
  }, [phase, gamemasterData?.questionNumber]);

  const syncData = useMemo((): GamemasterAnswerData | null => {
    if (phase === 'game') {
      if (!gamemasterData) return null;
      return scoringQuestion === null
        ? gamemasterData
        : { ...gamemasterData, scoringQuestion };
    }
    return {
      gameTitle: title,
      questionNumber: 0,
      totalQuestions: totalQuestions ?? 0,
      answer: '',
      screenLabel: PHASE_SCREEN_LABELS[phase],
    };
  }, [phase, gamemasterData, scoringQuestion, title, totalQuestions]);

  useGamemasterSync(syncData);

  // Publish the live question into app state so AWARD_POINTS can stamp it — the
  // same pattern as `currentGame` → `gameIndex`. Keeping this out of
  // `onAwardPoints` is what leaves every game component untouched.
  useEffect(() => {
    gameDispatch({ type: 'SET_CURRENT_QUESTION', payload: scoringQuestion });
  }, [scoringQuestion, gameDispatch]);

  // Unmount-only: leaving the game entirely (e.g. to the summary screen) must not
  // leave a stale question behind for a later award to be filed under. Separate
  // from the effect above so a question CHANGE doesn't dispatch a transient null.
  useEffect(
    () => () => {
      gameDispatch({ type: 'SET_CURRENT_QUESTION', payload: null });
    },
    [gameDispatch],
  );

  // The teams this gameshow runs with. Memoised: it is a dependency of the award
  // callbacks and the controls memo, both of which feed the gamemaster sync.
  const teamCount = gameState.settings.teamCount;
  const activeTeams = useMemo(() => teamKeys(teamCount), [teamCount]);

  const shouldShowPoints = !skipPointsScreen && (pointSystemEnabled || requiresPoints);

  const handleNav = useCallback(() => {
    // Proceeding (reveal answer / next question / phase change) supersedes a
    // fullscreen overlay — close it so the host never advances behind it.
    setFullscreenOpen(false);
    setFullscreenOverride(null);
    if (phase === 'landing') {
      // Starting a self-scored game from its title screen clears its per-question tally:
      // that tally IS the game's score, and it lives for the whole session, so a restart
      // would otherwise open with the previous run's standing. Only on this transition —
      // a back-navigated review enters the game phase directly and keeps its record.
      if (autoScored && typeof currentIndex === 'number') {
        gameDispatch({ type: 'RESET_GAME_TALLY', payload: { gameIndex: currentIndex } });
      }
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
  }, [phase, navHandler, autoScored, currentIndex, gameDispatch]);

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

  const gameTally = gameState.correctAnswersByGame[String(currentIndex)];
  const tallyByTeam = useMemo(() => tallyTotals(gameTally), [gameTally]);

  // How this gameshow scores — resolved HERE and nowhere else, so no game can opt out
  // of the operator's choice. `per-correct-answer` pays out the gamemaster's tally,
  // which only exists for games that show the tracker: the four that hide it keep the
  // scoring their type defines (see specs/point-system.md).
  const pointMode = gameState.settings.pointMode;
  const perCorrectAnswer = pointMode === 'per-correct-answer' && !hideCorrectTracker;
  const basePoints = gamePointValue(pointMode, currentIndex ?? 0);

  // Aufholjoker: the armed team's points double for this award, then the flag
  // clears. Multiply the MODE'S value (never hardcode 2). Hoisted out of
  // `handleComplete` so an auto verdict can STATE the same numbers it awards.
  const ptsFor = useCallback(
    (team: TeamKey) => {
      const base = perCorrectAnswer ? (tallyByTeam[team] ?? 0) : basePoints;
      return gameState.teams.doubleNextGame === team ? base * 2 : base;
    },
    [gameState.teams.doubleNextGame, perCorrectAnswer, tallyByTeam, basePoints],
  );

  const handleComplete = useCallback(
    (winners: AwardPointsWinners) => {
      const armed = gameState.teams.doubleNextGame;
      for (const team of selectedTeams(winners, activeTeams)) {
        // A zero delta states nothing and would still take a slot in the capped score
        // history — skip it. Only reachable in `per-correct-answer`, where selection
        // follows the tally rather than the host.
        const points = ptsFor(team);
        if (points > 0) onAwardPoints(team, points);
      }
      if (armed) gameDispatch({ type: 'CLEAR_DOUBLE_NEXT_GAME' });
      onNextGame();
    },
    [onAwardPoints, ptsFor, onNextGame, gameState.teams.doubleNextGame, gameDispatch, activeTeams]
  );

  // What the award screen starts with: in `per-correct-answer` everyone who answered
  // anything correctly — the screen is read-only there, so this IS the outcome —
  // otherwise a verdict the game worked out, else whoever leads the gamemaster's
  // correct-answer tally, else nothing. Derived (not seeded into state) so a tally edit
  // arriving from another device still moves it — until the host picks, which pins it.
  const preselectedWinners = useMemo((): AwardPointsWinners | null => {
    if (perCorrectAnswer) {
      const winners: AwardPointsWinners = {};
      for (const team of activeTeams) if ((tallyByTeam[team] ?? 0) > 0) winners[team] = true;
      return winners;
    }
    if (autoAward) return autoAward.winners;
    const leaders = tallyLeader(gameTally, activeTeams);
    if (leaders) {
      const winners: AwardPointsWinners = {};
      for (const team of leaders) winners[team] = true;
      return winners;
    }
    // With a single team the screen has nothing to choose BETWEEN — it is a
    // confirmation, not a decision. Preselect the one card so the host presses
    // confirm and moves on; deselecting it is still possible, for a round the
    // audience did not win. See specs/team-count.md.
    if (activeTeams.length === 1) return { [activeTeams[0]!]: true };
    return null;
  }, [perCorrectAnswer, tallyByTeam, autoAward, gameTally, activeTeams]);
  // Read-only mode has nothing to pick, so a stale pick can never override the tally.
  const selectedWinners = (perCorrectAnswer ? preselectedWinners : pickedWinners ?? preselectedWinners) ?? NO_WINNERS;
  const winnerKeys = selectedTeams(selectedWinners, activeTeams);
  // Confirm is gated on a selection only where the host makes one: with an empty tally
  // nobody is selected, and the host must still be able to advance.
  const anyWinnerSelected = perCorrectAnswer || winnerKeys.length > 0;

  // What each team would receive, from the same `ptsFor` the award books with — so
  // the preview and the booked points cannot diverge.
  const awardPointsPreview = useMemo(() => {
    const preview: Partial<Record<TeamKey, number>> = {};
    for (const team of activeTeams) preview[team] = ptsFor(team);
    return preview;
  }, [ptsFor, activeTeams]);

  // The cards' third line: won questions from an auto verdict, otherwise the
  // gamemaster's tally. Dropped entirely when nothing was tallied — "0 richtige
  // Antworten" on every card states nothing.
  const awardCounts = useMemo(() => {
    const line: Partial<Record<TeamKey, string>> = {};
    if (autoAward) {
      for (const team of activeTeams) {
        const n = autoAward.wins[team] ?? 0;
        line[team] = `${n} ${n === 1 ? 'gewonnene Frage' : 'gewonnene Fragen'}`;
      }
      return line;
    }
    if (activeTeams.every(t => tallyByTeam[t] === 0)) return null;
    for (const team of activeTeams) {
      const n = tallyByTeam[team];
      line[team] = `${n} ${n === 1 ? 'richtige Antwort' : 'richtige Antworten'}`;
    }
    return line;
  }, [autoAward, tallyByTeam, activeTeams]);

  // An untouched auto verdict states its own reason; once the host overrides it, the
  // screen falls back to its generic wording. In `per-correct-answer` nobody "wins" the
  // game — every team is paid its own count — so the verdict wording is suppressed and
  // the read-only screen states the mode instead.
  const autoWinnerKeys = autoAward ? selectedTeams(autoAward.winners, activeTeams) : [];
  const awardHint = !perCorrectAnswer && pickedWinners === null && autoAward
    ? (autoWinnerKeys.length > 1
      ? drawHint(gameState.teams, autoWinnerKeys, activeTeams)
      : `${teamName(gameState.teams, autoWinnerKeys[0] ?? activeTeams[0]!)} hat mehr Fragen gewonnen`)
    : undefined;

  const toggleWinner = useCallback((team: TeamKey) => {
    // Nothing to pick in `per-correct-answer` — the tally decides. Guarded here as
    // well as in the UI so a gamemaster command cannot pin a stale selection.
    if (perCorrectAnswer) return;
    // Toggling against what is currently SHOWN, so the first press after a
    // preselection deselects that team instead of starting from an empty pick.
    setPickedWinners(prev => {
      const base = prev ?? preselectedWinners ?? NO_WINNERS;
      return { ...base, [team]: base[team] !== true };
    });
  }, [perCorrectAnswer, preselectedWinners]);

  const confirmAward = useCallback(() => {
    // An empty tally is a legitimate outcome in `per-correct-answer` (nobody scored),
    // and the host must still be able to advance — so only the pick-a-winner modes
    // refuse to confirm an empty selection.
    if (!perCorrectAnswer && selectedTeams(selectedWinners, activeTeams).length === 0) return;
    handleComplete(selectedWinners);
  }, [perCorrectAnswer, selectedWinners, handleComplete, activeTeams]);

  // Leaving the award screen drops the pick so it can't leak into the next game.
  useEffect(() => {
    if (phase !== 'points') setPickedWinners(null);
  }, [phase]);

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
      const controls: GamemasterControl[] = [];
      // An auto-scored game states its standing as a read-only line; the winner it
      // worked out is preselected below, where the host can still override it. Not in
      // `per-correct-answer`: nobody "wins" there — every team is paid its own count —
      // and the award-summary control below already states those counts, so this line
      // would only repeat it with a wrong "gewinnt" framing.
      if (autoAward && !perCorrectAnswer) {
        const winners = selectedTeams(autoAward.winners, activeTeams);
        const standing = activeTeams
          .map(t => `${teamName(gameState.teams, t)}: ${autoAward.wins[t] ?? 0}`)
          .join(' · ');
        const winnerLabel = winners.length === 1
          ? `${teamName(gameState.teams, winners[0]!)} gewinnt`
          : 'Unentschieden';
        controls.push({
          type: 'info',
          id: 'award-auto-summary',
          text: `${standing} → ${winnerLabel}`,
        });
      }
      // GM control panel → mirror the frontend order (GM faces the crowd); IDs stay
      // team-keyed, so only display order changes.
      const displayOrder = teamDisplayOrder(
        gameState.teams.orderSwapped,
        true,
        gameState.settings.teamMirrorEnabled,
        teamCount,
      );
      if (perCorrectAnswer) {
        // Read-only: there is nothing to toggle, so the group becomes the same
        // statement the show's cards make. The GM corrects it in the tracker above,
        // which the show follows live — then confirms.
        controls.push({
          type: 'info',
          id: 'award-summary',
          text: displayOrder
            .map(t => `${teamName(gameState.teams, t)}: ${tallyByTeam[t] ?? 0}`)
            .join(' · '),
        });
      } else {
        // Toggles mirroring the show's cards, then one confirm — the same shape
        // wer-kennt-mehr's count mode uses.
        controls.push({
          type: 'button-group',
          id: 'award-selection',
          label: 'Welches Team hat gewonnen? (mehrere = unentschieden)',
          buttons: displayOrder.map(teamKey => ({
            id: `award-toggle-${teamKey}`,
            label: teamName(gameState.teams, teamKey),
            variant: 'primary' as const,
            active: selectedWinners[teamKey] === true,
          })),
        });
      }
      controls.push({
        type: 'button',
        id: 'award-confirm',
        label: 'Punkte vergeben & weiter',
        variant: 'primary',
        disabled: !anyWinnerSelected,
      });
      return controls;
    }
    return [];
  }, [phase, gameControls, navState.hideForward, navState.hideBack, gameState.teams, gameState.settings.teamMirrorEnabled, teamCount, activeTeams, autoAward, selectedWinners, anyWinnerSelected, perCorrectAnswer, tallyByTeam]);

  useGamemasterControlsSync(allControls, phase, currentIndex, hideCorrectTracker, gameState.currentGame?.totalGames, deadlineActive, timerActive, timerPaused, answerRevealed, scrollAnchors, fullscreenMedia !== null, fullscreenOpen, broadcastRemainingMs ?? undefined, activeTotalSeconds ?? undefined, activeKind ?? undefined, tickMuted, autoScored, !pointSystemEnabled);

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

  /**
   * Identity of the question currently on screen, as opposed to its *position*.
   *
   * A live question add/remove shifts every index after the edit, so keying
   * per-question resets on `questionNumber` would tear down a running question
   * (deadline, fullscreen, reveal state) just because an earlier question was
   * deleted. The slot key survives that shift and only changes on a real
   * question change. Games that don't pass an `order` keep the old behaviour.
   * See specs/live-question-order.md.
   */
  const questionToken = useMemo((): number | string | undefined => {
    const n = gamemasterData?.questionNumber;
    if (n === undefined) return undefined;
    if (!order) return n;
    return order.slotKeys[n] ?? `oob:${n}`;
  }, [order, gamemasterData?.questionNumber]);

  // Clear an active deadline timer whenever the question changes — deadlines
  // are per-question and must not bleed forward.
  const lastQuestionRef = useRef<number | string | undefined>(questionToken);
  useEffect(() => {
    const current = questionToken;
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
  }, [questionToken]);

  // A live question add/remove shifted this game's question indices. The
  // correct-answer tally is keyed by index, so re-key it in the same beat or
  // every bucket after the edit is misattributed on the GM's "Wertung pro Frage"
  // panel. See specs/gamemaster-question-scores.md.
  const orderRevision = order?.revision;
  const orderMoved = order?.moved;
  const lastOrderRevisionRef = useRef(orderRevision);
  useEffect(() => {
    if (orderRevision === undefined || orderRevision === lastOrderRevisionRef.current) return;
    lastOrderRevisionRef.current = orderRevision;
    if (currentIndex === undefined || !orderMoved) return;
    gameDispatch({ type: 'REMAP_QUESTION_TALLY', payload: { gameIndex: currentIndex, moved: orderMoved } });
  }, [orderRevision, orderMoved, currentIndex, gameDispatch]);

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
    } else if (cmd.controlId.startsWith('award-toggle-')) {
      // Mirrors a tap on the show's team card. Phase-guarded so a late command from a
      // GM that hasn't caught up can't pick a winner for a game still being played.
      const team = cmd.controlId.slice('award-toggle-'.length);
      if (phase === 'points' && isTeamKey(team)) toggleWinner(team);
    } else if (cmd.controlId === 'award-confirm') {
      confirmAward();
    } else if (cmd.controlId === 'award-auto') {
      if (autoAward) handleComplete(autoAward.winners);
    } else if (cmd.controlId === 'award-draw' || cmd.controlId === 'award-team1' || cmd.controlId === 'award-team2') {
      // The pre-toggle award ids. The three PWAs are cached separately, so a
      // gamemaster running an older bundle still emits these — honour them as an
      // immediate award rather than dropping the host's press on the floor. Such a
      // bundle only knows two teams, so `award-draw` means "everyone" here.
      const winners: AwardPointsWinners = {};
      if (cmd.controlId === 'award-draw') {
        for (const team of activeTeams) winners[team] = true;
      } else {
        winners[cmd.controlId === 'award-team1' ? 'team1' : 'team2'] = true;
      }
      handleComplete(winners);
    } else if (cmd.controlId === 'use-joker' && cmd.value && typeof cmd.value === 'object') {
      const { team, jokerId, used } = cmd.value as { team?: string; jokerId?: string; used?: string };
      if (isTeamKey(team) && typeof jokerId === 'string') {
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
  }, [handleNav, handleBackNav, handleComplete, autoAward, activeTeams, phase, toggleWinner, confirmAward, commandHandler, gameDispatch, resumePausedAudio, freezeActiveTimer, resumeActiveTimer]));

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
            setAutoAward: setAutoAwardState,
            setGameTimer,
          })}
        </div>
      )}

      {phase === 'points' && (
        <AwardPoints
          selected={selectedWinners}
          points={awardPointsPreview}
          counts={awardCounts}
          hint={awardHint}
          readOnly={perCorrectAnswer}
          onToggle={toggleWinner}
          onConfirm={confirmAward}
        />
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
