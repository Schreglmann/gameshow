import type { GameFileSummary } from '@/types/config';
import type { Overlap } from '@/utils/playerStats';

/**
 * Overlap badge labels shared by the gameshow editor and the Spiele tab.
 * See specs/game-planning.md and specs/admin-games-list.md.
 */

export interface OverlapBadge { label: string; className: string; title: string }

/** Per-instance badges (game-order rows, Planung panel). */
export const OVERLAP_BADGE: Record<Overlap, OverlapBadge> = {
  fresh:   { label: 'Neu',        className: 'overlap-fresh',   title: 'Noch nie in einer früheren Gameshow gespielt' },
  none:    { label: 'Ungespielt', className: 'overlap-none',    title: 'Früher gespielt, aber mit anderen Spielern' },
  planned: { label: 'Eingeplant', className: 'overlap-planned', title: 'In einer folgenden Gameshow mit gemeinsamen Spielern eingeplant' },
  partial: { label: 'Teilweise',  className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
  full:    { label: 'Gespielt',   className: 'overlap-full',    title: 'Alle aktuellen Spieler kennen das Spiel bereits' },
};

/** Per-game badges, aggregated over all instances (game pickers, Spiele tab). */
export const OVERLAP_BADGE_GAME: Record<Overlap, OverlapBadge> = {
  ...OVERLAP_BADGE,
  partial: { label: 'Gemischt', className: 'overlap-partial', title: 'Manche der aktuellen Spieler kennen das Spiel schon' },
};

/** Planung order: Neu first, Gespielt last. */
export const OVERLAP_ORDER: Record<Overlap, number> = { fresh: 0, none: 1, planned: 2, partial: 3, full: 4 };

/** Fully-qualified refs for every selectable instance of a game (single → [fileName]). */
export function gameRefs(g: GameFileSummary): string[] {
  if (g.isSingleInstance) return [g.fileName];
  return g.instances.filter(i => i !== 'template').map(i => `${g.fileName}/${i}`);
}
