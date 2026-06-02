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
  /**
   * When true, jokers stay available in the last game like any other game.
   * When false (default), the joker UI is hidden in the last game.
   */
  jokersInLastGame: boolean;
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
  nextAnswer?: { question?: string; answer: string };
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
  /** True while the game is in its answer-reveal phase. The GM toolbar
   * hides the entire deadline-timer row while this is true — a countdown
   * makes no sense once players see the answer. */
  answerRevealed?: boolean;
}

export interface GamemasterCommand {
  controlId: string;
  value?: string | Record<string, string>;
  timestamp: number;
}
