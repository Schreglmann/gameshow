export interface TeamState {
  team1: string[];
  team2: string[];
  team1Points: number;
  team2Points: number;
}

export interface GlobalSettings {
  pointSystemEnabled: boolean;
  teamRandomizationEnabled: boolean;
  globalRules: string[];
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
}
