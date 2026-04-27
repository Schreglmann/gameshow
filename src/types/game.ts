export interface TeamState {
  team1: string[];
  team2: string[];
  team1Points: number;
  team2Points: number;
  team1JokersUsed: string[];
  team2JokersUsed: string[];
}

export interface GlobalSettings {
  pointSystemEnabled: boolean;
  teamRandomizationEnabled: boolean;
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
}

export interface CurrentGame {
  currentIndex: number;
  totalGames: number;
}

export interface GamemasterAnswerData {
  gameTitle: string;
  questionNumber: number;
  totalQuestions: number;
  answer: string;
  answerImage?: string;
  extraInfo?: string;
  /** Optional question text, shown above the answer in the gamemaster card */
  question?: string;
  /** Label shown in gamemaster when no question is active (e.g. "Titelbildschirm") */
  screenLabel?: string;
}

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
  | { type: 'nav'; id: string; hideBack?: boolean };

export interface GamemasterControlsData {
  controls: GamemasterControl[];
  phase?: 'landing' | 'rules' | 'game' | 'points';
  gameIndex?: number;
  /** Game types that track progress via team points (bet-quiz, quizjagd, final-quiz)
   * don't need a separate correct-answers tally on the gamemaster screen. */
  hideCorrectTracker?: boolean;
}

export interface GamemasterCommand {
  controlId: string;
  value?: string | Record<string, string>;
  timestamp: number;
}
