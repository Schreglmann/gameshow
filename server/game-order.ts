import type { AppConfig } from '../src/types/config.js';

/**
 * Parse a gameOrder entry like "allgemeinwissen/v1" or "trump-oder-hitler"
 * into { gameName, instanceName }. Mirrors the resolver in server/index.ts —
 * kept here so the cascade helpers are pure and unit-testable in isolation.
 */
export function parseGameRef(ref: string): { gameName: string; instanceName: string | null } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) return { gameName: ref, instanceName: null };
  return { gameName: ref.slice(0, slashIdx), instanceName: ref.slice(slashIdx + 1) };
}

/** A gameOrder reference that was removed, tagged with its owning gameshow. */
export interface RemovedGameRef {
  gameshow: string;
  ref: string;
}

/**
 * Remove every `gameOrder` entry for which `shouldDrop(ref)` returns true, across
 * all gameshows in `config`. Mutates `config.gameshows[*].gameOrder` in place and
 * returns the removed refs (tagged with their gameshow key) for reporting.
 *
 * Pure: no I/O. The caller is responsible for persisting `config` if the returned
 * array is non-empty. See specs/config-gameorder-cascade.md.
 */
export function pruneGameOrder(
  config: AppConfig,
  shouldDrop: (ref: string) => boolean,
): RemovedGameRef[] {
  const removed: RemovedGameRef[] = [];
  const gameshows = config?.gameshows;
  if (!gameshows) return removed;
  for (const [key, gs] of Object.entries(gameshows)) {
    if (!gs || !Array.isArray(gs.gameOrder)) continue;
    const kept: string[] = [];
    for (const ref of gs.gameOrder) {
      if (shouldDrop(ref)) removed.push({ gameshow: key, ref });
      else kept.push(ref);
    }
    gs.gameOrder = kept;
  }
  return removed;
}

/** Predicate: drop every ref pointing at game file `gameName` (bare or instance-qualified). */
export function isRefToGame(gameName: string): (ref: string) => boolean {
  return ref => parseGameRef(ref).gameName === gameName;
}

/** Predicate: drop the ref pointing at exactly `gameName/instance`. */
export function isRefToInstance(gameName: string, instance: string): (ref: string) => boolean {
  return ref => ref === `${gameName}/${instance}`;
}
