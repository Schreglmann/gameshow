/**
 * Every clickable player name in the admin opens the player lightbox (names +
 * statistics, `PlayerLightbox`) over whatever tab is open. Callers just call
 * `openPlayer(id)`; the one `PlayerLightboxHost`, mounted by AdminScreen,
 * listens and shows it. A window event keeps the editors free of prop drilling.
 * See specs/players.md.
 */
const OPEN_PLAYER_EVENT = 'admin:open-player';

export function openPlayer(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_PLAYER_EVENT, { detail: id }));
}

/** Subscribe to `openPlayer` calls. Returns the unsubscribe function. */
export function onOpenPlayer(listener: (id: string) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(OPEN_PLAYER_EVENT, handler);
  return () => window.removeEventListener(OPEN_PLAYER_EVENT, handler);
}
