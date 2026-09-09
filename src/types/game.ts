import type { PointMode, TeamColors } from './config.js';
import type { TeamKey } from '../utils/teams.js';

/**
 * The manual correct-answer tally for a single question, keyed by team.
 *
 * Partial because a gameshow runs with 0–4 teams and only the active ones ever
 * get a bucket — read it through `questionTally`/`tallyTotals` in
 * src/utils/correctAnswers.ts, never by indexing. See specs/team-count.md.
 */
export type QuestionTally = Partial<Record<TeamKey, number>>;

/**
 * Manual correct-answer tally for one game, keyed by question.
 *
 * Keys are `String(scoringQuestion)`, where `'0'` is the example question, plus
 * the reserved `'none'` bucket for taps made while no question was attributable
 * (a tap during a live show must never be silently dropped). The per-game total
 * is DERIVED by summing the buckets — see `tallyTotals` in
 * src/utils/correctAnswers.ts — never stored.
 */
export type CorrectAnswersByQuestion = Record<string, QuestionTally>;

/**
 * The whole tally map: game index → question key → per-team counts. Persisted
 * under localStorage `correctAnswersByQuestion` and synced on the cached
 * `gamemaster-question-tally` channel. See specs/gamemaster-question-scores.md.
 */
export type CorrectAnswersMap = Record<string, CorrectAnswersByQuestion>;

/** Reserved tally/breakdown key for awards with no attributable question. */
export const NO_QUESTION_KEY = 'none';

/**
 * One audit-log entry for a single team-points mutation. Every point change —
 * positional awards AND inline-scored games (bet-quiz / quizjagd / final-quiz /
 * wer-kennt-mehr) — funnels through `applyPointDelta` in GameContext, which
 * appends an entry here. Backs the gamemaster scoring-undo panel. The list rides
 * the cached `gamemaster-team-state-v2` channel and is capped (oldest dropped).
 * See specs/gamemaster-cockpit.md.
 */
export interface ScoreLogEntry {
  /** Unique id (`<ts>-<counter>`); the undo target. */
  id: string;
  team: TeamKey;
  /** Signed, clamp-adjusted points delta actually applied. */
  delta: number;
  /** The team's total immediately after this delta. */
  pointsAfter: number;
  /** Epoch ms when the delta was applied. */
  ts: number;
  /** Index of the game that was active when the points were awarded, if known. */
  gameIndex?: number;
  /**
   * Question the delta belongs to, sourced from `AppState.currentQuestion` in the
   * reducer. Omitted for whole-game (positional) awards — those happen in the
   * `points` phase, where no question is live — and whenever nothing was
   * attributable. Backs the per-question breakdown panel; see
   * specs/gamemaster-question-scores.md.
   */
  questionNumber?: number;
  /** Human label for the source game, if known. */
  gameTitle?: string;
  /** Optional free-text reason (unused by the award path; reserved). */
  reason?: string;
}

/**
 * Live state of every team in the show.
 *
 * The fields are FLAT per team (`teamN`, `teamNName`, `teamNPoints`,
 * `teamNJokersUsed`) rather than an array, so the localStorage keys and the
 * `gamemaster-team-state-v2` payload stay purely additive as the supported team
 * count grew from 2 to 4 — nothing had to be migrated.
 *
 * `team1`/`team2` are required (they always exist, and every pre-existing state
 * literal has them); `team3`/`team4` are OPTIONAL and present only while a
 * gameshow is configured for 3-4 teams. Never index those fields directly —
 * read through `teamRoster` / `teamPoints` / `teamJokersUsed` in
 * src/utils/teams.ts, which default a missing team to `[]` / `0`.
 * See specs/team-count.md.
 */
export interface TeamState {
  team1: string[];
  team2: string[];
  team3?: string[];
  team4?: string[];
  /** Optional custom name for team 1. Falls back to "Team 1" when unset/blank. */
  team1Name?: string;
  /** Optional custom name for team 2. Falls back to "Team 2" when unset/blank. */
  team2Name?: string;
  team3Name?: string;
  team4Name?: string;
  team1Points: number;
  team2Points: number;
  team3Points?: number;
  team4Points?: number;
  team1JokersUsed: string[];
  team2JokersUsed: string[];
  team3JokersUsed?: string[];
  team4JokersUsed?: string[];
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
   * Rides the cached gamemaster-team-state-v2 channel. See specs/comeback-joker.md.
   */
  doubleNextGame?: TeamKey | null;
  /**
   * Presentation flag: when true the crowd-facing frontend REVERSES the team
   * display order (with two teams: `team2` on the LEFT and `team1` on the
   * right), for whichever way the teams are seated. Team
   * identities/points/jokers are unaffected — only display order flips. The
   * gamemaster screen always shows the mirror of the frontend order (it faces the
   * crowd). Rides the cached gamemaster-team-state-v2 channel + localStorage. See
   * specs/team-order-mirror.md and src/utils/teamOrder.ts.
   */
  orderSwapped?: boolean;
  /**
   * Monotonic revision counter (Lamport clock) guarding against a client
   * publishing a snapshot older than one already in circulation. Every local
   * mutation sets `rev = (highest rev this client has seen) + 1`; the server
   * relays a `gamemaster-team-state-v2` write only when its `rev` is strictly
   * higher than the cached one, and echoes the cache back to a rejected writer
   * so it converges instead of diverging. Never reset to 0 (not even by
   * RESET_POINTS / CLEAR_ALL) — a reset that lost the race would resurrect the
   * old score. Optional so legacy literals and test fixtures may omit it;
   * missing counts as 0. See specs/cross-device-gamemaster.md.
   */
  rev?: number;
}

/**
 * One entry of the active gameshow's `gameOrder` whose game type cannot be
 * scored at the configured team count. It still plays — just without scoring.
 * Surfaced as the HomeScreen warning banner. See specs/team-count.md.
 */
export interface IncompatibleGame {
  /** Position in the active gameshow's `gameOrder` (0-based). */
  index: number;
  title: string;
  type: string;
}

export interface GlobalSettings {
  /**
   * What the show calls itself — the landing-page heading, the gamemaster's
   * start/summary label and the browser tab title. Resolved server-side from
   * the active gameshow's `showTitle`, then the global one, then "Game Show"
   * (`DEFAULT_SHOW_TITLE`), so this is always a non-empty string.
   * See specs/show-title.md.
   */
  showTitle: string;
  pointSystemEnabled: boolean;
  /**
   * How many teams the active gameshow runs with (0-4). Derived server-side:
   * the global `pointSystemEnabled: false` forces 0, otherwise the active
   * gameshow's `teamCount` (default 2). `pointSystemEnabled` is exactly
   * `teamCount > 0`. See specs/team-count.md.
   */
  teamCount: number;
  /**
   * How the active gameshow turns a game result into points: `positional`
   * (default — game N is worth N points), `flat` (every game 1 point) or
   * `per-correct-answer` (one point per correct answer, off the gamemaster's
   * tally). Mirrors `PointMode` in config.ts. See specs/point-system.md.
   */
  pointMode: PointMode;
  /**
   * Games in the active gameshow that cannot be scored at `teamCount`. Empty
   * when everything fits (and always empty at `teamCount: 0`, where nothing
   * scores anyway).
   */
  incompatibleGames: IncompatibleGame[];
  teamRandomizationEnabled: boolean;
  /**
   * Master switch for the team-order/gamemaster-mirror feature — opt-in, default
   * false. When true the "Teams tauschen" control appears and every surface
   * shows the gamemaster mirror; when false (default) the natural
   * team1-left/team2-right order is used everywhere with no gamemaster mirror.
   * See specs/team-order-mirror.md.
   */
  teamMirrorEnabled: boolean;
  /**
   * Per-team accent colours, resolved server-side — empty when the operator has
   * the feature switched off, so this alone says whether to mark a team. No
   * component reads it directly: `useTeamColorVars` publishes it to CSS as
   * `--team1-color` … `--team4-color` and every team surface picks it up through
   * its `data-team` attribute. See specs/team-colors.md.
   */
  teamColors: TeamColors;
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
  /**
   * The question a tally or point award made *right now* belongs to. Omitted
   * whenever nothing is attributable: the example question, any non-`game`
   * phase, and summary screens.
   *
   * Deliberately NOT `questionNumber`: that field uses `0` for the example
   * question, and `emitCachedGamemasterState` republishes `questionNumber: 0`
   * after a show reload — so overloading it would silently file the host's taps
   * under "Beispiel". See specs/gamemaster-question-scores.md.
   */
  scoringQuestion?: number;
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
   * Structured list of the *hints* the audience is looking at, for games whose
   * puzzle is a set of clues around a single hidden answer (city-compass: the
   * neighbor cities on the rose). Rendered as its own labelled block, so unlike
   * `answerList` it does NOT replace `answer` — the host still needs the
   * solution while asking. `revealed` reflects what the audience can see; a
   * pending row is an upcoming clue, not the answer.
   */
  hintList?: { rank: number; text: string; revealed: boolean }[];
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
  /** True while the playing game keeps the per-question tally itself (guessing-game's
   *  automatic scoring). The counters and the "Wertung pro Frage" rows still SHOW, but
   *  their `+`/`−` are left out: with the show awarding the points, an edit control there
   *  would leave the host unsure who scored what. See specs/games/guessing-game.md. */
  tallyReadOnly?: boolean;
  /** True while the playing game awards no points at all — the show-wide point
   *  system is off, or the game's type cannot be scored at the configured team
   *  count. The gamemaster hides the "Wertung pro Frage" breakdown then: every
   *  row could only ever read "keine Wertung". The GM has no other way to know,
   *  since `pointSystemEnabled` is resolved PER GAME by `GET /api/game/:index`.
   *  See specs/team-count.md and specs/gamemaster-question-scores.md. */
  pointsDisabled?: boolean;
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
