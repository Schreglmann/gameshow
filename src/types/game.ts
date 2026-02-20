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

export type Screen = 'home' | 'rules' | 'game' | 'summary';

export interface GameState {
  currentGameIndex: number;
  totalGames: number;
  gameId: string | null;
}
