// ── Game configuration types ──

export type GameType =
  | 'simple-quiz'
  | 'guessing-game'
  | 'final-quiz'
  | 'audio-guess'
  | 'video-guess'
  | 'four-statements'
  | 'fact-or-fake'
  | 'quizjagd'
  | 'bandle'
  | 'image-guess';

// ── Question types per game ──

export interface SimpleQuizQuestion {
  question: string;
  answer: string;
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

export interface FourStatementsQuestion {
  Frage: string;
  trueStatements: string[];
  wrongStatement: string;
  answer?: string;
  disabled?: boolean;
}

export interface FactOrFakeQuestion {
  statement: string;
  answer?: 'FAKT' | 'FAKE';
  isFact?: boolean;
  description: string;
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
  randomizeQuestions?: boolean;
  questionLimit?: number;
  /** Override the frontend theme while this game is active */
  theme?: string;
}

export interface SimpleQuizConfig extends BaseGameConfig {
  type: 'simple-quiz';
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
}

export interface ImageGuessConfig extends BaseGameConfig {
  type: 'image-guess';
  questions: ImageGuessQuestion[];
}

export interface FourStatementsConfig extends BaseGameConfig {
  type: 'four-statements';
  questions: FourStatementsQuestion[];
}

export interface FactOrFakeConfig extends BaseGameConfig {
  type: 'fact-or-fake';
  questions: FactOrFakeQuestion[];
}

export interface QuizjagdConfig extends BaseGameConfig {
  type: 'quizjagd';
  questions: QuizjagdQuestionSet;
  questionsPerTeam?: number;
  exampleQuestion?: QuizjagdQuestion;
}

export type GameConfig =
  | SimpleQuizConfig
  | GuessingGameConfig
  | FinalQuizConfig
  | AudioGuessConfig
  | VideoGuessConfig
  | FourStatementsConfig
  | FactOrFakeConfig
  | QuizjagdConfig
  | BandleConfig
  | ImageGuessConfig;

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
  instances: Record<string, Partial<GameConfig>>;
}

export type GameFile = SingleInstanceGameFile | MultiInstanceGameFile;

// ── Full app config ──

export interface GameshowConfig {
  name: string;
  gameOrder: string[];
  players?: string[];
}

export interface AppConfig {
  pointSystemEnabled?: boolean;
  teamRandomizationEnabled?: boolean;
  globalRules?: string[];
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
  instancePlayers?: Record<string, string[]>; // _players per instance
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
}

export interface GameDataResponse {
  gameId: string;
  config: GameConfig;
  currentIndex: number;
  totalGames: number;
  pointSystemEnabled: boolean;
}
