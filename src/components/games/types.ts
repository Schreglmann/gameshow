import type { GameConfig } from '@/types/config';

export interface GameComponentProps {
  config: GameConfig;
  gameId: string;
  currentIndex: number;
  totalGames: number;
  pointSystemEnabled: boolean;
  onNextGame: () => void;
  /** Navigate back to the previous game (its title screen); omitted contexts have no prev-nav. */
  onPrevGame?: () => void;
  /** True when this game was entered via back-navigation — open it at its end
   * (last question, answer revealed) for review. See specs/game-back-review.md. */
  resumeAtEnd?: boolean;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
}
