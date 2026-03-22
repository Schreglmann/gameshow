// ── Game configuration types ──

export type GameType =
  | 'simple-quiz'
  | 'guessing-game'
  | 'final-quiz'
  | 'audio-guess'
  | 'image-game'
  | 'four-statements'
  | 'fact-or-fake'
  | 'quizjagd';

// ── Question types per game ──

export interface SimpleQuizQuestion {
  question: string;
  answer: string;
  answerImage?: string;
  answerAudio?: string;
  answerList?: string[];
  questionImage?: string;
  questionAudio?: string;
  questionColors?: string[];
  replaceImage?: boolean;
  timer?: number;
}

export interface GuessingGameQuestion {
  question: string;
  answer: number;
  answerImage?: string;
}

export interface FinalQuizQuestion {
  question: string;
  answer: string;
  answerImage?: string;
}

export interface AudioGuessQuestion {
  folder: string;
  audioFile: string;
  answer: string;
  isExample: boolean;
}

export interface ImageGameQuestion {
  image: string;
  answer: string;
  isExample: boolean;
}

export interface FourStatementsQuestion {
  Frage: string;
  trueStatements: string[];
  wrongStatement: string;
  answer?: string;
}

export interface FactOrFakeQuestion {
  statement: string;
  answer?: 'FAKT' | 'FAKE';
  isFact?: boolean;
  description: string;
}

export interface QuizjagdQuestionSet {
  easy: QuizjagdQuestion[];
  medium: QuizjagdQuestion[];
  hard: QuizjagdQuestion[];
}

export interface QuizjagdQuestion {
  question: string;
  answer: string;
}

// ── Game config types ──

export interface BaseGameConfig {
  type: GameType;
  title: string;
  rules?: string[];
  randomizeQuestions?: boolean;
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
  questions?: AudioGuessQuestion[];
}

export interface ImageGameConfig extends BaseGameConfig {
  type: 'image-game';
  questions?: ImageGameQuestion[];
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
  | ImageGameConfig
  | FourStatementsConfig
  | FactOrFakeConfig
  | QuizjagdConfig;

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
}

// Flat format used in actual quizjagd JSON files
export interface QuizjagdFlatQuestion {
  question: string;
  answer: string;
  difficulty: 3 | 5 | 7;
  isExample?: boolean;
}

export type AssetCategory = 'audio' | 'images' | 'audio-guess' | 'image-guess' | 'background-music';

export interface AssetFolder {
  name: string;
  files: string[];
  subfolders: AssetFolder[];
}

// Kept for backward compatibility
export type AudioGuessSubfolder = AssetFolder;

export interface AssetListResponse {
  files?: string[];
  subfolders?: AssetFolder[];
}

// ── API response types ──

export interface SettingsResponse {
  pointSystemEnabled: boolean;
  teamRandomizationEnabled: boolean;
  globalRules: string[];
}

export interface GameDataResponse {
  gameId: string;
  config: GameConfig;
  currentIndex: number;
  totalGames: number;
  pointSystemEnabled: boolean;
}
