import { useEffect } from 'react';
import { useGameContext } from '@/context/GameContext';

/**
 * Keep the browser tab title in sync with the operator's show title.
 *
 * `show/index.html` ships a static `<title>Game Show</title>` for the
 * pre-hydration window; once `/api/settings` has answered, the resolved
 * `showTitle` takes over — including on a live config change, which re-fetches
 * the settings. Show zone only: the admin and gamemaster PWAs keep their own
 * titles. See specs/show-title.md.
 */
export function useShowDocumentTitle(): void {
  const { state } = useGameContext();
  const { showTitle } = state.settings;
  useEffect(() => {
    if (showTitle) document.title = showTitle;
  }, [showTitle]);
}
