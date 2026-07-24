/**
 * One audit-log entry for a single team-points mutation. Every point change —
 * positional awards AND inline-scored games (bet-quiz / quizjagd / final-quiz /
 * wer-kennt-mehr) — funnels through `applyPointDelta` in GameContext, which
 * appends an entry here. Backs the gamemaster scoring-undo panel. The list rides
 * the cached `gamemaster-team-state` channel and is capped (oldest dropped).
 * See specs/gamemaster-cockpit.md.
 */
export interface ScoreLogEntry {
  /** Unique id (`<ts>-<counter>`); the undo target. */
  id: string;
  team: 'team1' | 'team2';
  /** Signed, clamp-adjusted points delta actually applied. */
  delta: number;
  /** The team's total immediately after this delta. */
  pointsAfter: number;
  /** Epoch ms when the delta was applied. */
  ts: number;
  /** Index of the game that was active when the points were awarded, if known. */
  gameIndex?: number;
  /** Human label for the source game, if known. */
  gameTitle?: string;
  /** Optional free-text reason (unused by the award path; reserved). */
  reason?: string;
}

export interface TeamState {
  team1: string[];
  team2: string[];
  /** Optional custom name for team 1. Falls back to "Team 1" when unset/blank. */
  team1Name?: string;
  /** Optional custom name for team 2. Falls back to "Team 2" when unset/blank. */
  team2Name?: string;
  team1Points: number;
  team2Points: number;
  team1JokersUsed: string[];
  team2JokersUsed: string[];
  /**
   * Bounded audit log of point mutations (most recent last), powering the
   * gamemaster scoring-undo. Optional because legacy / minimal TeamState
   * literals omit it; the GameContext reducer and the inbound WS normalizer
   * always populate it on live state. See specs/gamemaster-cockpit.md.
   */
  scoreHistory?: ScoreLogEntry[];
  /**
   * Armed Aufholjoker (comeback-joker) multiplier target: the next awarded
   * game doubles this team's positional points, then clears. Transient pending
   * state (correct to store, unlike the trailing-team gate which is derived).
   * Rides the cached gamemaster-team-state channel. See specs/comeback-joker.md.
   */
  doubleNextGame?: 'team1' | 'team2' | null;
  /**
   * Presentation flag: when true the crowd-facing frontend shows `team2` on the
   * LEFT and `team1` on the right (for whichever way the teams are seated). Team
   * identities/points/jokers are unaffected — only display order flips. The
   * gamemaster screen always shows the mirror of the frontend order (it faces the
   * crowd). Rides the cached gamemaster-team-state channel + localStorage. See
   * specs/team-order-mirror.md and src/utils/teamOrder.ts.
   */
  orderSwapped?: boolean;
}

export interface GlobalSettings {
  pointSystemEnabled: boolean;
  teamRandomizationEnabled: boolean;
  /**
   * Master switch for the team-order/gamemaster-mirror feature — opt-in, default
   * false. When true the "Teams tauschen" control appears and every surface
   * shows the gamemaster mirror; when false (default) the natural
   * team1-left/team2-right order is used everywhere with no gamemaster mirror.
   * See specs/team-order-mirror.md.
   */
  teamMirrorEnabled: boolean;
  globalRules: string[];
  /**
   * True when the server fell back to the template-based default config
   * because config.json was missing, encrypted, or unparseable. Optional
   * so existing test fixtures don't need to provide it.
   * See specs/clean-install.md.
   */
  isCleanInstall?: boolean;
  /** Joker IDs enabled for the active gameshow. */
  enabledJokers: string[];
  /**
   * Generic joker explanation for the global rules screen (operator-editable in
   * the admin). Empty → frontend falls back to the built-in
   * `GENERIC_JOKER_RULES` default. See specs/jokers.md.
   */
  jokerRules: string[];
  /**
   * When true, jokers stay available in the last game like any other game.
   * When false (default), the joker UI is hidden in the last game.
   */
  jokersInLastGame: boolean;
  /**
   * Whether a used joker persists for the whole show (`per-gameshow`, default)
   * or refreshes at the start of each game (`per-game`). The Aufholjoker
   * (`comeback`) is always per-gameshow regardless of this setting.
   * Mirrors `JokerUsageScope` in config.ts. See specs/jokers.md.
   */
  jokerUsageScope: 'per-gameshow' | 'per-game';
  /**
   * Roster of the active gameshow (`GameshowConfig.players`), configured in the
   * admin Gameshows tab. Prefills the HomeScreen randomization textarea so the
   * host only has to click "Teams zuweisen". Empty when the gameshow has no
   * configured roster. See specs/team-management.md.
   */
  players: string[];
}

export interface CurrentGame {
  currentIndex: number;
  totalGames: number;
}

/**
 * Panic/pause hold overlay state, sent by the gamemaster on the cached
 * `show-hold` channel. When `active`, the show drops a branded full-screen hold
 * over the projector (for disputes / breaks). See specs/gamemaster-cockpit.md.
 */
export interface ShowHoldState {
  active: boolean;
  /** Optional custom German message shown under the title. */
  message?: string;
}

export interface GamemasterAnswerData {
  gameTitle: string;
  questionNumber: number;
  totalQuestions: number;
  answer: string;
  answerImage?: string;
  /**
   * Optional image representing the current QUESTION (not the answer) — e.g. the
   * random video frame players currently see in `random-frame`. Rendered at the top
   * of the gamemaster card, always visible (not gated by the answer-image toggle), so
   * the GM can judge the frame and decide whether to regenerate it.
   */
  questionImage?: string;
  extraInfo?: string;
  /** Optional question text, shown above the answer in the gamemaster card */
  question?: string;
  /** Label shown in gamemaster when no question is active (e.g. "Titelbildschirm") */
  screenLabel?: string;
  /**
   * Structured list of answers for games that reveal multiple items in order
   * (ranking). When present, the gamemaster view renders this as a grid with
   * rank chips and revealed/unrevealed states instead of the plain `answer`
   * field. `revealed` reflects what the audience can already see.
   */
  answerList?: { rank: number; text: string; revealed: boolean }[];
  /**
   * Preview of the NEXT question's answer, shown in the gamemaster card while
   * the current answer is revealed in the frontend (`answerRevealed`), gated by
   * the GM "Nächste Frage" toolbar toggle. Undefined on the last question.
   */
  nextAnswer?: { question?: string; answer: string; image?: string };
}

// ── Game phases ──

/** The phases a single game cycles through inside BaseGameWrapper. */
export type GamePhase = 'landing' | 'rules' | 'game' | 'points';

/**
 * Screen label shown in the gamemaster answer card for each phase. The 'game'
 * phase shows the real question, so its label is empty. Single source of truth
 * shared by BaseGameWrapper (which emits the label on the `gamemaster-answer`
 * channel) and GamemasterView (which compares the answer channel's `screenLabel`
 * against the `gamemaster-controls` channel's `phase` to detect a desync — see
 * specs/cross-device-gamemaster.md).
 */
export const PHASE_SCREEN_LABELS: Record<GamePhase, string> = {
  landing: 'Titel',
  rules: 'Regeln',
  game: '',
  points: 'Punktevergabe',
};

// ── Gamemaster remote controls ──

export interface GamemasterButtonDef {
  id: string;
  label: string;
  /** Optional secondary line shown below the main label (e.g. team member names). */
  sublabel?: string;
  variant?: 'success' | 'danger' | 'primary';
  active?: boolean;
  disabled?: boolean;
}

export interface GamemasterInputDef {
  id: string;
  label: string;
  inputType: 'number' | 'text';
  placeholder?: string;
  value?: string;
  emitOnChange?: boolean;
}

export type GamemasterControl =
  | { type: 'button'; id: string; label: string; variant?: 'success' | 'danger' | 'primary'; disabled?: boolean }
  | { type: 'button-group'; id: string; label?: string; buttons: GamemasterButtonDef[] }
  | { type: 'input-group'; id: string; inputs: GamemasterInputDef[]; submitLabel: string; submitDisabled?: boolean }
  | { type: 'info'; id: string; text: string }
  | { type: 'nav'; id: string; hideBack?: boolean; hideForward?: boolean };

export interface GamemasterControlsData {
  controls: GamemasterControl[];
  phase?: GamePhase;
  gameIndex?: number;
  /** Total games in the active gameshow. Broadcast so the gamemaster zone
   * (which doesn't run GameScreen and otherwise has no way of knowing) can
   * tell when the current game is the last one — used for the joker
   * lockout in the last game. */
  totalGames?: number;
  /** Game types that track progress via team points (bet-quiz, quizjagd, final-quiz)
   * don't need a separate correct-answers tally on the gamemaster screen. */
  hideCorrectTracker?: boolean;
  /** True while a GM-triggered deadline timer has a value set (counting down
   * OR showing the "Zeit abgelaufen!" badge until auto-clear). */
  deadlineActive?: boolean;
  /** True while ANY timer is currently ticking — deadline OR per-question
   * `q.timer`. The GM toolbar uses this to surface the Pause/Resume button
   * for both timer types. False the instant a timer expires naturally so the
   * button doesn't linger on screen. See [specs/gamemaster-deadline-timer.md](../../specs/gamemaster-deadline-timer.md). */
  timerActive?: boolean;
  /** True when the GM has paused the active timer. The GM toolbar flips the
   * Pause button label to "Weiter" (resume) while this is true. */
  timerPaused?: boolean;
  /** Remaining milliseconds of the currently-active timer — a GM-triggered
   * deadline OR a per-question `q.timer` — sampled on the SHOW and refreshed
   * ~once per second while running (frozen while paused). The GM rebases this
   * onto its OWN clock (`endsAt = Date.now() + timerRemainingMs`) instead of
   * trusting the show's absolute wall-clock timestamp, which is what keeps the
   * two surfaces in sync across device clock skew and correct after a reconnect.
   * null/omitted when no timer is active.
   * See [specs/gamemaster-deadline-timer.md](../../specs/gamemaster-deadline-timer.md). */
  timerRemainingMs?: number;
  /** Total duration (seconds) of the active timer, for the ring fraction on the
   * GM mirror. Paired with timerRemainingMs; covers both timer kinds. */
  timerTotalSeconds?: number;
  /** Which timer is currently active. The GM uses it only to gate the
   * deadline-only `+10s` button (per-question timers can still be paused/stopped
   * /muted, but not extended). Omitted when no timer is active. */
  timerKind?: 'deadline' | 'question';
  /** True while the GM has muted the per-second timer ticking on the show. Only
   * the tick is suppressed — the "Zeit abgelaufen!" finish motif still plays.
   * Persists for the whole game (resets on game change). Drives the GM toolbar's
   * mute-toggle button label/state. See [specs/gamemaster-deadline-timer.md](../../specs/gamemaster-deadline-timer.md). */
  timerMuted?: boolean;
  /** True while the game is in its answer-reveal phase. The GM toolbar
   * hides the entire deadline-timer row while this is true — a countdown
   * makes no sense once players see the answer. */
  answerRevealed?: boolean;
  /** Scroll jump-points currently available on the show, in display order
   * (`top`, optional `answer`, `bottom`). Reported by the show ONLY while the
   * card overflows its viewport; empty / omitted otherwise. The GM toolbar
   * renders one button per anchor and emits a `scroll-to:<anchor>` command.
   * See [specs/gamemaster-scroll.md](../../specs/gamemaster-scroll.md). */
  scrollAnchors?: GamemasterScrollAnchor[];
  /** True while the show is displaying an image/video that can be enlarged.
   * The GM toolbar renders the Vollbild toggle only while this is true. */
  fullscreenAvailable?: boolean;
  /** True while the fullscreen overlay is open on the show. Drives the
   * Vollbild toggle's label / active state. See [specs/gamemaster-fullscreen.md](../../specs/gamemaster-fullscreen.md). */
  fullscreenOpen?: boolean;
}

/** Named scroll jump-points on the show frontend. `top`/`bottom` scroll to the
 * very top / bottom of the page; `answer` is offered only when the
 * `.quiz-answer` landmark is on screen. */
export type GamemasterScrollAnchor = 'top' | 'answer' | 'bottom';

export interface GamemasterCommand {
  controlId: string;
  value?: string | Record<string, string>;
  timestamp: number;
}

// ── Background-music remote control (show ↔ gamemaster) ──
// See specs/gamemaster-music-control.md.

/** Snapshot of the active show's background-music player, broadcast to the GM. */
export interface MusicPlayerState {
  isPlaying: boolean;
  currentSong: string;
  currentTime: number;
  duration: number;
  volume: number;
}

/**
 * A music control command sent from the GM to the active show.
 * `value` carries the volume (0–1) for `volume` and the seek fraction (0–1)
 * for `seek`; it is unused for `toggle` / `skip`.
 */
export interface MusicCommand {
  action: 'toggle' | 'skip' | 'volume' | 'seek';
  value?: number;
  timestamp: number;
}
