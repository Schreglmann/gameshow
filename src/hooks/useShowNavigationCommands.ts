import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';

/**
 * Handles the gamemaster's `goto:*` jump commands — the show side of the
 * run-of-show panel. See specs/gamemaster-run-of-show.md.
 *
 * Deliberately mounted at APP level (`AppContent`), not inside a screen:
 * a mounted `GameScreen` has no command listener at all (only its
 * `GameLoadError` fallback does), and `BaseGameWrapper` — which owns commands
 * during play — has only `onNextGame`/`onPrevGame` and cannot reach an
 * arbitrary index. One listener here covers every screen.
 *
 * `useGamemasterCommandListener` already drops commands on inactive show tabs,
 * so only the active show reacts. Unknown ids are ignored by every other
 * listener, so this adds no conflicts.
 */
export function useShowNavigationCommands(): void {
  const navigate = useNavigate();

  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (!cmd.controlId.startsWith('goto:')) return;
    const target = cmd.controlId.slice('goto:'.length);

    if (target === 'home') {
      navigate('/');
    } else if (target === 'rules') {
      navigate('/rules');
    } else if (target === 'summary') {
      navigate('/summary');
    } else if (target.startsWith('game-')) {
      const index = Number.parseInt(target.slice('game-'.length), 10);
      // A malformed/negative index would send GameScreen fetching `/api/game/NaN`,
      // so drop it rather than navigating somewhere undefined.
      if (Number.isInteger(index) && index >= 0) navigate(`/game?index=${index}`);
    }
  }, [navigate]));
}
