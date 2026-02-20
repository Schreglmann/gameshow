import type { GameConfig } from '@/types/config';

export interface GameComponentProps {
  config: GameConfig;
  gameId: string;
  currentIndex: number;
  totalGames: number;
  pointSystemEnabled: boolean;
  onNextGame: () => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
}
