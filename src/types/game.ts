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
