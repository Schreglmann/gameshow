import { useCallback, useEffect, useRef, useState } from 'react';
import { isTeamNameLong, type TeamNameFitContext } from '@/utils/teamNames';

/**
 * `isTeamNameLong` for a React component: returns a checker bound to the show
 * context, and re-renders the component once the web fonts have loaded.
 *
 * The check refuses to measure while `document.fonts.status` is not `loaded`
 * (fallback-font metrics misjudge widths) and answers `false` instead. That is
 * fine on the show, where the header font is already on screen. In the ADMIN
 * the show's font is used nowhere else, so the very first measurement is what
 * triggers its download: the status flips to `loading` and every later check
 * in that render cycle says `false` — the hint never appeared for any name.
 * This hook arms `document.fonts.ready` after every render that found the fonts
 * loading and re-renders when they are in, so the next call measures for real.
 */
export function useTeamNameCheck(ctx: TeamNameFitContext): (name: string | undefined) => boolean {
  const [tick, setTick] = useState(0);
  const armed = useRef(false);
  const { jokerCount, teamCount, totalGames, theme } = ctx;

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    if (document.fonts.status === 'loaded' || armed.current) return;
    armed.current = true;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      armed.current = false;
      if (!cancelled) setTick(n => n + 1);
    });
    return () => { cancelled = true; armed.current = false; };
  });

  return useCallback(
    (name: string | undefined) => isTeamNameLong(name, { jokerCount, teamCount, totalGames, theme }),
    // `tick` is what makes the checker a new function once the fonts are in, so
    // memoised consumers re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jokerCount, teamCount, totalGames, theme, tick],
  );
}
