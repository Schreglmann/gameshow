import { useEffect, useState } from 'react';
import { useWsChannel } from '@/services/useBackendSocket';
import { useGmConnected } from '@/hooks/useGmConnected';
import type { ShowControlsHiddenState } from '@/types/game';
import '@/styles/show-controls-hidden.css';

export const SHOW_CONTROLS_HIDDEN_CLASS = 'show-controls-hidden';

/**
 * Show side of the gamemaster's "Show-Buttons ausblenden" toggle. Follows the
 * cached `show-controls-hidden` channel and sets a class on `<html>`; the
 * hiding itself is CSS (`show-controls-hidden.css`), so no game component
 * branches on it. The class is set only while a gamemaster is connected
 * (`gm-presence`): the cached value outlives the GM, and without a GM the
 * show's own buttons are the only way to advance — e.g. past the points
 * screen. `enabled: false` (the theme showcase) never sets the class.
 * See specs/gamemaster-hide-show-controls.md.
 */
export function useShowControlsHidden(enabled = true): void {
  const [hidden, setHidden] = useState(false);
  useWsChannel<ShowControlsHiddenState | null>('show-controls-hidden', (next) => {
    setHidden(next?.hidden ?? false);
  });

  const gmConnected = useGmConnected();

  const apply = enabled && hidden && gmConnected;
  useEffect(() => {
    if (!apply) return;
    const root = document.documentElement;
    root.classList.add(SHOW_CONTROLS_HIDDEN_CLASS);
    return () => root.classList.remove(SHOW_CONTROLS_HIDDEN_CLASS);
  }, [apply]);
}
