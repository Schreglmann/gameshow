// ── Game configuration types ──

export type GameType =
  | 'simple-quiz'
  | 'bet-quiz'
  | 'guessing-game'
  | 'final-quiz'
  | 'audio-guess'
  | 'video-guess'
  | 'q1'
  | 'four-statements'
  | 'fact-or-fake'
  | 'quizjagd'
  | 'bandle'
  | 'image-guess'
  | 'colorguess'
  | 'ranking'
  | 'wer-kennt-mehr'
  | 'random-frame'
  | 'city-compass';

// ── Question types per game ──

export interface SimpleQuizQuestion {
  question: string;
  answer: string;
  /** Optional small-font subtitle rendered above the question text (simple-quiz only). */
  info?: string;
  /** Required for bet-quiz questions; ignored by simple-quiz. */
  category?: string;
  answerImage?: string;
  answerAudio?: string;
  answerAudioStart?: number;
  answerAudioEnd?: number;
  answerAudioLoop?: boolean;
  answerList?: string[];
  questionImage?: string;
  questionAudio?: string;
  questionAudioStart?: number;
  questionAudioEnd?: number;
  questionAudioLoop?: boolean;
  questionColors?: string[];
  replaceImage?: boolean;
  timer?: number;
  disabled?: boolean;
}

export interface WerKenntMehrQuestion {
  /** The prompt, e.g. "Nennt so viele europäische Hauptstädte wie möglich". */
  question: string;
  /** Optional small-font subtitle rendered above the question text. */
  info?: string;
  /** Optional question image (raw logical path; encoded at the DOM boundary). No answer image. */
  questionImage?: string;
  /** Single example answer (used when no list is given). */
  answer?: string;
  /** List of example answers, rendered as a compact grid on reveal. */
  answerList?: string[];
  /** Optional time limit in seconds (same behaviour as simple-quiz). */
  timer?: number;
  disabled?: boolean;
}

export interface GuessingGameQuestion {
  question: string;
  answer: number;
  answerImage?: string;
  /** Auto-played while the question is shown. */
  questionAudio?: string;
  /** Trim: playback starts here instead of 0 (seconds). */
  questionAudioStart?: number;
  /** Trim: playback stops here (seconds). */
  questionAudioEnd?: number;
  /** Restart at `questionAudioStart` when the trimmed section ends. */
  questionAudioLoop?: boolean;
  disabled?: boolean;
}

export interface FinalQuizQuestion {
  question: string;
  answer: string;
  answerImage?: string;
  disabled?: boolean;
}

export interface AudioGuessQuestion {
  answer: string;
  audio: string;
  audioStart?: number;
  audioEnd?: number;
  answerImage?: string;
  isExample?: boolean;
  disabled?: boolean;
}

export interface BandleTrack {
  label: string;
  audio: string;
}

export interface BandleQuestion {
  answer: string;
  tracks: BandleTrack[];
  hint?: string;
  hintEnabled?: boolean;
  answerImage?: string;
  releaseYear?: number;
  clicks?: number;
  difficulty?: number;
  isExample?: boolean;
  disabled?: boolean;
}

export interface BandleCatalogEntry {
  path: string;
  song: string;
  year: number;
  par: number;
  view: number;
  genre: string[];
  packs: string[];
  instruments: string[];
  clue?: string;
  bpm?: number;
  youtube?: string;
  spotifyId?: string;
  stream?: number;
  frontperson?: string;
  sources?: string[];
  /**
   * Bandle's own slot for the song, verbatim from the pack listing. Two forms:
   * `"202607/Wanted"` — the year+month it ran as a daily puzzle, i.e. when bandle added
   * it — and `"_kpop/Yeobo"` for songs that only belong to a themed pack and never had a
   * dated slot. The month is the finest "added" resolution bandle exposes; there is no
   * day and no running id (`path` is an opaque 20-char hex key).
   */
  folder?: string;
  /**
   * Exact date the song ran as bandle's daily puzzle (`"2026-07-15"`), from the
   * `/v2/planning/<date>.txt` files the app itself uses to pick each day. Set by
   * `scripts/bandle-sync.cjs`; absent for songs that only ever appeared in a themed pack,
   * which never had a daily slot. When absent the `folder` month is the best available date.
   */
  dailyDate?: string;
}

export interface VideoGuessQuestion {
  answer: string;
  video: string;
  /** Optional prompt shown above the video, e.g. "Welcher Film ist das?". */
  question?: string;
  videoStart?: number;
  videoQuestionEnd?: number;
  videoAnswerEnd?: number;
  answerImage?: string;
  /** Audio track index to use (0-based among audio streams). Omit for default. */
  audioTrack?: number;
  disabled?: boolean;
}

export interface ImageGuessQuestion {
  image: string;
  answer: string;
  obfuscation?: 'blur' | 'pixelate' | 'zoom' | 'swirl' | 'noise' | 'scatter' | 'random';
  duration?: number;
  disabled?: boolean;
}

export interface RandomFrameQuestion {
  /** DAM video path, e.g. "/videos/Movies/Film.mkv". The frame is extracted from this. */
  video: string;
  /** The movie/show title — the answer players must guess. */
  answer: string;
  /** Optional prompt shown above the frame. Defaults to "Aus welchem Film stammt dieses Bild?". */
  question?: string;
  /** Optional reveal image (e.g. a poster) shown alongside the answer text. */
  answerImage?: string;
  /** Earliest second a random frame may be picked from (skips the intro). Default 180 (3 min). */
  frameStart?: number;
  /** Latest second a random frame may be picked from (skips the outro). Default 900 (15 min),
   *  clamped to the real video duration for shorter videos. */
  frameEnd?: number;
  disabled?: boolean;
}

/** A single wedge in a colorguess pie chart. `percent` is 0–100. */
export interface ColorSlice {
  hex: string;
  percent: number;
}

export interface ColorGuessQuestion {
  image: string;
  answer: string;
  disabled?: boolean;
  /** Populated by the server from the sidecar color-profile cache.
   *  Never present in authored JSON. */
  colors?: ColorSlice[];
}

/** A city on the compass rose. Coordinates are stored, not looked up, so the show
 *  renders offline and the city dataset stays out of the show bundle. */
export interface CompassCity {
  name: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2, shown next to the name once the answer is revealed. */
  country?: string;
}

export interface CityCompassQuestion {
  /** The city teams have to name. Never rendered before the reveal. */
  center: CompassCity;
  /** 3-8 cities around it, in reveal order. */
  neighbors: CompassCity[];
  /** Overrides the default prompt "Welche Stadt liegt im Zentrum?". */
  question?: string;
  /** Optional small-font subtitle rendered above the question text. */
  info?: string;
  answerImage?: string;
  disabled?: boolean;
}

export interface Q1Question {
  Frage: string;
  trueStatements: string[];
  wrongStatement: string;
  answer?: string;
  disabled?: boolean;
}

export interface FourStatementsQuestion {
  topic: string;
  statements: string[];
  answer?: string;
  answerImage?: string;
  answerAudio?: string;
  answerAudioStart?: number;
  answerAudioEnd?: number;
  answerAudioLoop?: boolean;
  disabled?: boolean;
}

export interface RankingQuestion {
  /** Prompt shown at the top. May be empty when `items` provide the on-screen prompt instead. */
  question: string;
  answers: string[];
  /**
   * Optional bare candidate items presented to teams during the guessing phase
   * (shown shuffled). Their presence enables the item pool for this question.
   * Distinct from `answers`, which reveal the full solution (item + value).
   * Order here is irrelevant — the display is shuffled each playthrough.
   */
  items?: string[];
  topic?: string;
  /** Optional audio clip played during the reveal (raw logical path). */
  answerAudio?: string;
  /** Trim start (seconds): playback begins here instead of 0. */
  answerAudioStart?: number;
  /** Trim end (seconds): playback stops (or loops) here. */
  answerAudioEnd?: number;
  /** Loop the trimmed section instead of stopping at the end. */
  answerAudioLoop?: boolean;
  /** When the answer audio plays: on the first revealed answer (default) or once all are revealed. */
  answerAudioTrigger?: 'first' | 'all';
  disabled?: boolean;
}

export interface FactOrFakeQuestion {
  statement: string;
  answer?: 'FAKT' | 'FAKE';
  isFact?: boolean;
  description: string;
  questionImage?: string;
  answerImage?: string;
  disabled?: boolean;
}

export interface QuizjagdQuestionSet {
  easy: QuizjagdQuestion[];
  medium: QuizjagdQuestion[];
  hard: QuizjagdQuestion[];
}

export interface QuizjagdQuestion {
  question: string;
  answer: string;
  disabled?: boolean;
}

// ── Game config types ──

export interface BaseGameConfig {
  type: GameType;
  title: string;
  rules?: string[];
  /** References a preset id from AppConfig.rulesPresets; server resolves it on read. See specs/rules-presets.md. */
  rulesPreset?: string;
  randomizeQuestions?: boolean;
  questionLimit?: number;
  /** Override the frontend theme while this game is active */
  theme?: string;
  /**
   * When true, this game (single-instance file) — or this instance object, since
   * instances are Partial<GameConfig> — is hidden from the admin add-to-gameshow
   * pickers. Games already referenced in a gameshow's gameOrder keep resolving and
   * playing regardless. See specs/game-disable.md.
   */
  disabled?: boolean;
}

export interface SimpleQuizConfig extends BaseGameConfig {
  type: 'simple-quiz';
  questions: SimpleQuizQuestion[];
}

export interface BetQuizConfig extends BaseGameConfig {
  type: 'bet-quiz';
  questions: SimpleQuizQuestion[];
  /** 'standard' (default): only the answering (betting) team gains/loses the bet.
   *  'transfer': zero-sum — the opponent moves opposite (correct → opponent −bet, wrong → opponent +bet). */
  scoringMode?: 'standard' | 'transfer';
}

export interface GuessingGameConfig extends BaseGameConfig {
  type: 'guessing-game';
  questions: GuessingGameQuestion[];
  /** 'auto' (the DEFAULT, also when the field is absent): the show records the closer
   *  team per question (equidistant guesses count for both teams, the example question
   *  never counts) and the award screen states the verdict — confirming it books the
   *  positional game points (currentIndex + 1) for the team that won more questions, or
   *  for both on an overall tie. 'standard' opts out: the host picks the winner on the
   *  AwardPoints screen by hand, as in every other game. */
  scoringMode?: 'standard' | 'auto';
}

export interface FinalQuizConfig extends BaseGameConfig {
  type: 'final-quiz';
  questions: FinalQuizQuestion[];
}

export interface AudioGuessConfig extends BaseGameConfig {
  type: 'audio-guess';
  questions: AudioGuessQuestion[];
}

export interface BandleConfig extends BaseGameConfig {
  type: 'bandle';
  questions: BandleQuestion[];
}

export interface VideoGuessConfig extends BaseGameConfig {
  type: 'video-guess';
  questions: VideoGuessQuestion[];
  /** Default audio language for questions in this instance. ISO 639-2 three-letter code
   *  matching the ffprobe `language` tag (e.g. "deu", "eng", "fra"). When set, questions
   *  without an explicit `audioTrack` resolve to the first audio stream tagged with this
   *  language. Per-question `audioTrack` always wins. */
  language?: string;
  /** When true, questions and markers are frozen and the server refuses edits inside
   *  this instance. Segment caches for locked instances are preserved across prunes
   *  so the gameshow can run from cache without the source files reachable.
   *  See specs/video-guess-lock.md. */
  locked?: boolean;
}

export interface ImageGuessConfig extends BaseGameConfig {
  type: 'image-guess';
  questions: ImageGuessQuestion[];
}

export interface ColorGuessConfig extends BaseGameConfig {
  type: 'colorguess';
  questions: ColorGuessQuestion[];
}

export interface Q1Config extends BaseGameConfig {
  type: 'q1';
  questions: Q1Question[];
}

export interface FourStatementsConfig extends BaseGameConfig {
  type: 'four-statements';
  questions: FourStatementsQuestion[];
}

export interface FactOrFakeConfig extends BaseGameConfig {
  type: 'fact-or-fake';
  questions: FactOrFakeQuestion[];
}

export interface RankingConfig extends BaseGameConfig {
  type: 'ranking';
  questions: RankingQuestion[];
}

export interface WerKenntMehrConfig extends BaseGameConfig {
  type: 'wer-kennt-mehr';
  questions: WerKenntMehrQuestion[];
  /** 'standard' (default): scores like every other game — tally round wins, then at
   *  game end the host awards the positional game points (currentIndex + 1) to the
   *  leading team. 'count' (final-game behaviour): winning team gets points = the
   *  entered item count, inline. 'count-penalty': like 'count', but the losing team
   *  also LOSES the entered count (clamped at 0); a tie awards/deducts nothing. */
  scoringMode?: 'count' | 'standard' | 'count-penalty';
}

export interface QuizjagdConfig extends BaseGameConfig {
  type: 'quizjagd';
  questions: QuizjagdQuestionSet;
  questionsPerTeam?: number;
  exampleQuestion?: QuizjagdQuestion;
}

export interface RandomFrameConfig extends BaseGameConfig {
  type: 'random-frame';
  questions: RandomFrameQuestion[];
}

export interface CityCompassConfig extends BaseGameConfig {
  type: 'city-compass';
  questions: CityCompassQuestion[];
  /** Append the distance to each neighbor's label. Off by default (and when the
   *  field is absent): the bearing alone is the intended puzzle, and the distance is
   *  an opt-in that makes it easier. */
  showDistances?: boolean;
  /** 'all' (the DEFAULT, also when the field is absent): the whole constellation is
   *  visible at once. 'progressive': two neighbors to start with, one more per host
   *  advance, then the answer. */
  reveal?: 'all' | 'progressive';
}

export type GameConfig =
  | SimpleQuizConfig
  | BetQuizConfig
  | GuessingGameConfig
  | FinalQuizConfig
  | AudioGuessConfig
  | VideoGuessConfig
  | Q1Config
  | FourStatementsConfig
  | FactOrFakeConfig
  | QuizjagdConfig
  | BandleConfig
  | ImageGuessConfig
  | ColorGuessConfig
  | RankingConfig
  | WerKenntMehrConfig
  | RandomFrameConfig
  | CityCompassConfig;

// ── Game file types (files in games/ directory) ──

/**
 * A game file with a single instance (no variants).
 * The file IS the game config directly.
 */
export type SingleInstanceGameFile = GameConfig;

/**
 * A game file with multiple instances (variants).
 * Base config (type, title, rules, etc.) is at top level.
 * Each instance overrides/extends with its own data (e.g. questions).
 */
export interface MultiInstanceGameFile {
  type: GameType;
  title: string;
  rules?: string[];
  randomizeQuestions?: boolean;
  /** File-level disable: hides the whole multi-instance game (all instances) from the
   *  admin add-to-gameshow pickers. See specs/game-disable.md. */
  disabled?: boolean;
  instances: Record<string, Partial<GameConfig>>;
}

export type GameFile = SingleInstanceGameFile | MultiInstanceGameFile;

// ── Full app config ──

export interface GameshowConfig {
  name: string;
  /**
   * Overrides the global `AppConfig.showTitle` for this gameshow — the landing
   * page heading, the gamemaster's start/summary label, and the browser tab
   * title. Blank/absent falls through to the global value and then to
   * `DEFAULT_SHOW_TITLE`. Resolved by `resolveShowTitle()`.
   * See specs/show-title.md.
   */
  showTitle?: string;
  gameOrder: string[];
  players?: string[];
  enabledJokers?: string[];
  /**
   * How many teams this gameshow is played with (0-4). Omitted means 2 — the
   * historic behaviour, so every pre-existing gameshow is unchanged. `0` means
   * no teams at all (a pure play-through), the same thing the global
   * `pointSystemEnabled: false` does for every gameshow at once.
   *
   * A game type whose mechanic cannot be scored at this count still PLAYS, just
   * without scoring: `GET /api/game/:index` serves it `pointSystemEnabled:
   * false`. See specs/team-count.md.
   */
  teamCount?: 0 | 1 | 2 | 3 | 4;
  /**
   * How this gameshow turns a game result into points. Omitted means
   * `positional` — the historic behaviour, so every pre-existing gameshow is
   * unchanged. See specs/point-system.md.
   */
  pointMode?: PointMode;
}

/**
 * How a gameshow converts a game result into points.
 *
 * - `positional` (default) — game N is worth N points (`currentIndex + 1`).
 * - `flat` — every game is worth exactly 1 point.
 * - `per-correct-answer` — each team receives one point per correct answer it
 *   gave in that game, read off the gamemaster's tally.
 *
 * Resolved in a single place (`BaseGameWrapper`, via `gamePointValue()` in
 * [src/utils/pointMode.ts](../utils/pointMode.ts)), so no game component can opt
 * out of it. See specs/point-system.md.
 */
export type PointMode = 'positional' | 'flat' | 'per-correct-answer';

/**
 * Which wording of a preset a show gets. Presets are app-wide but their archetype
 * lines are team-count-sensitive: at 3-4 teams "beide Teams" is wrong, and at 0-1
 * teams the lines about the other team have no referent at all and are dropped
 * rather than reworded. See specs/rules-presets.md.
 */
export type RulesTeamBand = 'solo' | 'pair' | 'multi';

export interface RulesPreset {
  id: string;
  name: string;
  /** Band `pair` (2 teams), and the fallback for any band left unauthored. */
  rules: string[];
  /** Band `solo` — 0-1 teams. */
  rulesSolo?: string[];
  /** Band `multi` — 3-4 teams. */
  rulesMulti?: string[];
}

/**
 * How long a used joker stays used. `per-gameshow` (default) — each joker is
 * single-use for the whole show (only cleared on a full session reset).
 * `per-game` — most jokers become available again at the start of each game.
 * The Aufholjoker (`comeback`) is always per-gameshow regardless of this
 * setting (its double-points effect is a once-per-show comeback mechanic).
 * See specs/jokers.md.
 */
export type JokerUsageScope = 'per-gameshow' | 'per-game';

export interface AppConfig {
  /**
   * What the show calls itself, globally: the landing-page heading, the
   * gamemaster's start/summary label, and the browser tab title. A gameshow can
   * override it via `GameshowConfig.showTitle`; blank/absent at both levels
   * means `DEFAULT_SHOW_TITLE` ("Game Show"). See specs/show-title.md.
   */
  showTitle?: string;
  pointSystemEnabled?: boolean;
  teamRandomizationEnabled?: boolean;
  /**
   * Master switch for the team-order/gamemaster-mirror feature — opt-in, default
   * false/unset. When true, the "Teams tauschen" control appears and every
   * surface shows the gamemaster mirror; when false/unset, the natural
   * team1-left / team2-right order is used everywhere with no gamemaster mirror.
   * See specs/team-order-mirror.md.
   */
  teamMirrorEnabled?: boolean;
  /**
   * When true, jokers stay available in the last game just like any other
   * game. When false/undefined (default), the joker UI is hidden entirely
   * in the last game (frontend header + gamemaster controls).
   */
  jokersInLastGame?: boolean;
  /**
   * Whether a used joker stays used for the whole show (`per-gameshow`,
   * default) or refreshes at the start of each game (`per-game`). The
   * Aufholjoker (`comeback`) is exempt and always per-gameshow. See specs/jokers.md.
   */
  jokerUsageScope?: JokerUsageScope;
  globalRules?: string[];
  /**
   * Generic joker explanation shown on the global rules screen when the active
   * gameshow has jokers enabled. Operator-editable in the admin (ConfigTab).
   * When unset/empty the frontend falls back to `GENERIC_JOKER_RULES`
   * ([src/data/jokers.ts](./data/jokers.ts)). See specs/jokers.md.
   */
  jokerRules?: string[];
  /**
   * Operator-editable override for the `globalRules` scoring sentence, keyed by
   * `PointMode`. A missing or blank entry falls back to the built-in default text
   * (`POINT_MODE_RULE_DEFAULTS`, [src/utils/pointMode.ts](../utils/pointMode.ts)).
   * Edited in the admin ConfigTab next to `globalRules`/`jokerRules`; resolved into
   * `globalRules` by `GET /api/settings` from the active gameshow's `pointMode`.
   * See specs/point-system.md.
   */
  pointModeRules?: Partial<Record<PointMode, string>>;
  rulesPresets?: RulesPreset[];
  activeGameshow: string;
  gameshows: Record<string, GameshowConfig>;
}

// ── Admin backend types ──

export interface GameFileSummary {
  fileName: string;       // e.g. "allgemeinwissen" (no .json)
  type: GameType;
  title: string;
  instances: string[];    // instance keys; empty if single-instance
  isSingleInstance: boolean;
  questionCount?: number; // total questions; set for single-instance games
  questionCounts?: Record<string, number>; // questions per instance key; set for multi-instance games
  disabled?: boolean; // file-level disable: whole game hidden from add-to-gameshow pickers
  disabledInstances?: string[]; // instance keys (non-template) marked disabled; multi-instance only
  /**
   * Effective `scoringMode` per instance key (single-instance files use the key
   * `''`), for the types that have one (`bet-quiz`, `guessing-game`,
   * `wer-kennt-mehr`). Present only where the resolved config sets it. The admin
   * needs it to tell a 2-only `transfer` / `count-penalty` row from a fully
   * team-count-agnostic one without fetching every game file.
   * See specs/team-count.md.
   */
  scoringModes?: Record<string, string>;
  parseError?: string; // set when the JSON file could not be parsed
}

// Flat format used in actual quizjagd JSON files
export interface QuizjagdFlatQuestion {
  question: string;
  answer: string;
  difficulty: 3 | 5 | 7;
  disabled?: boolean;
}

export type AssetCategory = 'audio' | 'images' | 'background-music' | 'videos';

export interface AssetFileMeta {
  size: number;
  mtime: number;
  /** Duration in seconds (audio/video files only) */
  duration?: number;
  /** Present only for video files that are reference-only (symlink to external source).
   *  `online` reflects whether the source file is currently reachable. See
   *  specs/video-references.md. */
  reference?: { sourcePath: string; online: boolean };
  /** Natural pixel dimensions of a raster image (`images` category only). Absent for
   *  SVGs (vector — treated as "high resolution") and non-image categories. Backs the
   *  DAM's "Niedrige Auflösung" filter and "Auflösung" sort. */
  dimensions?: { width: number; height: number };
}

export interface AssetFolder {
  name: string;
  files: string[];
  fileMeta?: Record<string, AssetFileMeta>;
  subfolders: AssetFolder[];
}

// Kept for backward compatibility
export type AudioGuessSubfolder = AssetFolder;

export interface AssetListResponse {
  files?: string[];
  fileMeta?: Record<string, AssetFileMeta>;
  subfolders?: AssetFolder[];
}

// ── API response types ──

/**
 * A game in the active gameshow that cannot be scored at the configured team
 * count. It still plays — just without scoring. See specs/team-count.md.
 */
export interface IncompatibleGameInfo {
  /** Position in the active gameshow's `gameOrder` (0-based). */
  index: number;
  title: string;
  type: GameType;
}

export interface SettingsResponse {
  /**
   * The resolved title of the running show (active gameshow's `showTitle` →
   * global `showTitle` → "Game Show"). Optional so existing test fixtures don't
   * need it — a client that gets no value falls back to the default.
   * See specs/show-title.md.
   */
  showTitle?: string;
  pointSystemEnabled: boolean;
  /**
   * Teams the active gameshow runs with (0-4). `pointSystemEnabled` is exactly
   * `teamCount > 0`; the global `pointSystemEnabled: false` forces 0. Optional
   * so existing test fixtures don't need it — a client that gets no value falls
   * back to 2 when scoring is on. See specs/team-count.md.
   */
  teamCount?: number;
  /**
   * How the active gameshow turns a game result into points
   * (`GameshowConfig.pointMode`). Optional so existing test fixtures don't need
   * it — a client that gets no value falls back to `positional`.
   * See specs/point-system.md.
   */
  pointMode?: PointMode;
  /**
   * Games in the active gameshow that cannot be scored at `teamCount`. Empty or
   * omitted when everything fits (and always empty at `teamCount: 0`).
   */
  incompatibleGames?: IncompatibleGameInfo[];
  teamRandomizationEnabled: boolean;
  /**
   * Master switch for the team-order/gamemaster-mirror feature — opt-in, false
   * when omitted. When true there is a swap control and a gamemaster mirror; when
   * false there is neither. See specs/team-order-mirror.md.
   */
  teamMirrorEnabled?: boolean;
  globalRules: string[];
  /**
   * True when the server is running with the built-in template fallback
   * (typically a fresh clone without the git-crypt key, so config.json is
   * an encrypted blob and cannot be parsed). Optional so existing test
   * fixtures don't need to provide it. See specs/clean-install.md.
   */
  isCleanInstall?: boolean;
  /** Joker IDs enabled for the active gameshow (empty when none). */
  enabledJokers?: string[];
  /**
   * Operator-editable generic joker explanation for the global rules screen.
   * Empty/omitted → frontend uses the built-in `GENERIC_JOKER_RULES` default.
   * See specs/jokers.md.
   */
  jokerRules?: string[];
  /**
   * When true, jokers stay available in the last game. When omitted/false,
   * the joker UI is hidden in the last game. Optional so existing test
   * fixtures don't need to provide it. See specs/jokers.md.
   */
  jokersInLastGame?: boolean;
  /**
   * Whether used jokers persist for the whole show (`per-gameshow`, default)
   * or refresh at the start of each game (`per-game`). The Aufholjoker
   * (`comeback`) is always per-gameshow. Optional so existing test fixtures
   * don't need to provide it. See specs/jokers.md.
   */
  jokerUsageScope?: JokerUsageScope;
  /**
   * Roster of the active gameshow (`GameshowConfig.players`), configured in the
   * admin Gameshows tab. Prefills the HomeScreen randomization textarea. Empty
   * or omitted when the gameshow has no configured roster. Optional so existing
   * test fixtures don't need it. See specs/team-management.md.
   */
  players?: string[];
}

export interface GameDataResponse {
  gameId: string;
  config: GameConfig;
  currentIndex: number;
  totalGames: number;
  pointSystemEnabled: boolean;
}

/**
 * One slot of the active gameshow's `gameOrder`, as served by
 * `GET /api/run-of-show`. The gamemaster zone has no other way to learn the
 * running order — it only ever mirrors the CURRENT game over WebSocket.
 * See specs/gamemaster-run-of-show.md.
 */
export interface RunOfShowEntry {
  /** Position in `gameOrder` (0-based) — what `goto:game-<index>` addresses. */
  index: number;
  /** The raw gameOrder ref, e.g. `"allgemeinwissen/v1"`. */
  gameId: string;
  title: string;
  /** `null` when the ref could not be resolved (see `missing`). */
  type: GameType | null;
  /**
   * The ref points at a game file/instance that no longer resolves. The entry is
   * kept (not dropped) so every index still matches its `gameOrder` position.
   */
  missing?: boolean;
}

export interface RunOfShowResponse {
  games: RunOfShowEntry[];
}

/**
 * Payload for the `content-changed` WebSocket channel — the server's file
 * watcher fires this when on-disk content changes so the live frontend can
 * re-fetch without a page reload. See specs/live-config-reload.md.
 */
export interface ContentChangedPayload {
  /** config.json changed → re-fetch settings + the current game. */
  config?: boolean;
  /** theme-settings.json changed → re-fetch the theme. */
  theme?: boolean;
  /** a games/*.json changed → re-fetch the current game. */
  games?: boolean;
}
