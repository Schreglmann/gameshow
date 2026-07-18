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
  | 'random-frame';

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
}

export interface GuessingGameConfig extends BaseGameConfig {
  type: 'guessing-game';
  questions: GuessingGameQuestion[];
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
  | RandomFrameConfig;

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
  gameOrder: string[];
  players?: string[];
  enabledJokers?: string[];
}

export interface RulesPreset {
  id: string;
  name: string;
  rules: string[];
}

export interface AppConfig {
  pointSystemEnabled?: boolean;
  teamRandomizationEnabled?: boolean;
  /**
   * When true, jokers stay available in the last game just like any other
   * game. When false/undefined (default), the joker UI is hidden entirely
   * in the last game (frontend header + gamemaster controls).
   */
  jokersInLastGame?: boolean;
  globalRules?: string[];
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

export interface SettingsResponse {
  pointSystemEnabled: boolean;
  teamRandomizationEnabled: boolean;
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
   * When true, jokers stay available in the last game. When omitted/false,
   * the joker UI is hidden in the last game. Optional so existing test
   * fixtures don't need to provide it. See specs/jokers.md.
   */
  jokersInLastGame?: boolean;
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
