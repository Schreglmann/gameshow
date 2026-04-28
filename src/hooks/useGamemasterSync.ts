import { useCallback, useEffect, useRef, useState } from 'react';
import type { GamemasterAnswerData, GamemasterControl, GamemasterControlsData, GamemasterCommand } from '@/types/game';
import { onWsOpen, sendWs, useWsChannel } from '@/services/useBackendSocket';
import { isInactiveShowTab, onBecameActive, onReemitRequest } from '@/services/showPresenceState';

function emitIfActive(channel: 'gamemaster-answer' | 'gamemaster-controls', data: unknown): void {
  if (isInactiveShowTab()) return;
  sendWs(channel, data);
}

const LS_ANSWER_KEY = 'gm:last-answer';
const LS_CONTROLS_KEY = 'gm:last-controls';

function readLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* quota / disabled storage — ignore */ }
}

/**
 * Emit a best-guess state for the current URL **immediately** on a
 * reloading show tab — before lazy-loaded route / game-type components
 * mount, which on a slow device (iPad on WiFi) can take several
 * seconds. The GM sees the correct landing state within one WS
 * round-trip of the frontend connecting, not whenever the game bundle
 * finishes loading.
 *
 * On `/show/game` we transform the last-known answer from localStorage
 * into its landing equivalent (same gameTitle / totalQuestions, but
 * questionNumber=0, empty answer, screenLabel='Titel') — so after a
 * reload the GM shows the title screen state, matching what the
 * reloading frontend is actually about to display.
 *
 * When the real `useGamemasterSync` emit from the mounted component
 * eventually arrives it overwrites these values.
 */
export function emitCachedGamemasterState(): void {
  if (isInactiveShowTab()) return;
  if (typeof window === 'undefined') return;

  const pathname = window.location.pathname; // BrowserRouter basename is /show
  const last = readLocalStorage<GamemasterAnswerData>(LS_ANSWER_KEY);

  let payload: GamemasterAnswerData | null = null;
  if (pathname === '/show/' || pathname === '/show') {
    payload = {
      gameTitle: 'Game Show',
      questionNumber: 0,
      totalQuestions: 0,
      answer: '',
      screenLabel: 'Startseite',
    };
  } else if (pathname === '/show/rules') {
    payload = {
      gameTitle: 'Regelwerk',
      questionNumber: 0,
      totalQuestions: 0,
      answer: '',
      screenLabel: 'Globale Regeln',
    };
  } else if (pathname === '/show/game') {
    // Preserve gameTitle / totalQuestions from the last emit; the
    // reload lands on the title screen of that game.
    payload = {
      gameTitle: last?.gameTitle ?? 'Game Show',
      questionNumber: 0,
      totalQuestions: last?.totalQuestions ?? 0,
      answer: '',
      screenLabel: 'Titel',
    };
  } else if (pathname === '/show/summary') {
    payload = {
      gameTitle: 'Gesamtergebnis',
      questionNumber: 0,
      totalQuestions: 0,
      answer: '',
      screenLabel: 'Zusammenfassung',
    };
  } else {
    // Unknown path — fall back to whatever localStorage has.
    payload = last;
  }

  if (payload !== null) sendWs('gamemaster-answer', payload);

  // Controls: clear them on reload. The mounted component will re-emit
  // the correct controls for its phase within a few hundred ms.
  sendWs('gamemaster-controls', null);
}

/**
 * Writer hook: broadcasts current answer data to the gamemaster screen via WebSocket.
 * Call with `null` when no question is active.
 */
export function useGamemasterSync(data: GamemasterAnswerData | null): void {
  const latestRef = useRef<GamemasterAnswerData | null>(data);
  latestRef.current = data;

  useEffect(() => {
    if (!isInactiveShowTab()) writeLocalStorage(LS_ANSWER_KEY, data);
    emitIfActive('gamemaster-answer', data);
  }, [data]);

  // Re-emit current value on every reconnect so the server cache gets
  // repopulated after a server restart.
  useEffect(() => {
    return onWsOpen(() => {
      emitIfActive('gamemaster-answer', latestRef.current);
    });
  }, []);

  // Re-emit when this tab transitions from inactive to active (claim /
  // auto-promote) so the gamemaster view snaps from the previous
  // active tab's stale cached state to this tab's state.
  useEffect(() => {
    return onBecameActive(() => {
      sendWs('gamemaster-answer', latestRef.current);
    });
  }, []);

  // Also re-emit when the server explicitly asks (e.g. a GM reloaded
  // and the server cache is empty after a fresh restart).
  useEffect(() => {
    return onReemitRequest(() => {
      emitIfActive('gamemaster-answer', latestRef.current);
    });
  }, []);

  // NB: no `beforeunload` null-emit. Clearing the server cache on unload
  // caused the GM to briefly flash its waiting state during every frontend
  // reload — the frontend's next emit doesn't arrive until the new page
  // has mounted its lazy bundles, which can take several seconds. Instead
  // we leave the cache alone; the server clears it when the active show
  // disconnects and no replacement shows up within a short grace window.
}

/**
 * Reader hook: returns the current answer data from the game tab.
 * Returns `null` when no question is active.
 *
 * Seeds the initial state from localStorage so a reloading GM tab
 * paints the correct UI on the very first frame — before the WS has
 * even connected. The WS subsequently delivers authoritative state
 * which overrides (setData is a no-op when the value is identical by
 * reference, but React's commit cost is negligible either way).
 */
export function useGamemasterAnswer(): GamemasterAnswerData | null {
  const [data, setData] = useState<GamemasterAnswerData | null>(() =>
    readLocalStorage<GamemasterAnswerData>(LS_ANSWER_KEY),
  );
  useWsChannel<GamemasterAnswerData | null>('gamemaster-answer', (next) => {
    writeLocalStorage(LS_ANSWER_KEY, next);
    setData(next);
  });
  return data;
}

// ── Controls channel (game → gamemaster) ──

/**
 * Writer hook: broadcasts available controls to the gamemaster screen via WebSocket.
 * Call with `null` when no controls are active.
 */
export function useGamemasterControlsSync(
  controls: GamemasterControl[] | null,
  phase?: 'landing' | 'rules' | 'game' | 'points',
  gameIndex?: number,
  hideCorrectTracker?: boolean,
  totalGames?: number,
): void {
  const payload = controls ? { controls, phase, gameIndex, totalGames, hideCorrectTracker } : null;
  const serialized = JSON.stringify(payload);
  const latestRef = useRef<GamemasterControlsData | null>(payload);
  latestRef.current = payload;

  useEffect(() => {
    if (!isInactiveShowTab()) writeLocalStorage(LS_CONTROLS_KEY, payload);
    emitIfActive('gamemaster-controls', payload);
    // `payload` is derived from `serialized` — serialized is the stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  useEffect(() => {
    return onWsOpen(() => {
      emitIfActive('gamemaster-controls', latestRef.current);
    });
  }, []);

  useEffect(() => {
    return onBecameActive(() => {
      sendWs('gamemaster-controls', latestRef.current);
    });
  }, []);

  useEffect(() => {
    return onReemitRequest(() => {
      emitIfActive('gamemaster-controls', latestRef.current);
    });
  }, []);

  // NB: see note in useGamemasterSync — no beforeunload/unmount clear.
}

/**
 * Reader hook: returns the current controls data from the game tab.
 * Returns `null` when no controls are active. Seeds from localStorage
 * for instant paint on reload — see `useGamemasterAnswer`.
 */
export function useGamemasterControls(): GamemasterControlsData | null {
  const [data, setData] = useState<GamemasterControlsData | null>(() =>
    readLocalStorage<GamemasterControlsData>(LS_CONTROLS_KEY),
  );
  useWsChannel<GamemasterControlsData | null>('gamemaster-controls', (next) => {
    writeLocalStorage(LS_CONTROLS_KEY, next);
    setData(next);
  });
  return data;
}

// ── Command channel (gamemaster → game) ──

/**
 * Returns a function to send commands from the gamemaster to the game tab.
 */
export function useSendGamemasterCommand(): (controlId: string, value?: string | Record<string, string>) => void {
  return useCallback((controlId: string, value?: string | Record<string, string>) => {
    const cmd: GamemasterCommand = { controlId, value, timestamp: Date.now() };
    sendWs('gamemaster-command', cmd);
  }, []);
}

/**
 * Listener hook: watches for commands from the gamemaster tab.
 * Uses timestamp-based deduplication as a defensive guard against
 * replays or malformed messages. The server already skips echoing
 * back to the origin, so same-tab echoes can't happen.
 *
 * Inactive show tabs (i.e. a secondary `/show` tab that the server
 * marked non-authoritative) drop commands — only the active show
 * responds, so two frontends can never both process the same command.
 */
export function useGamemasterCommandListener(handler: (cmd: GamemasterCommand) => void): void {
  const lastTimestampRef = useRef(0);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useWsChannel<GamemasterCommand>('gamemaster-command', (cmd) => {
    if (isInactiveShowTab()) return;
    if (!cmd || typeof cmd.timestamp !== 'number') return;
    if (cmd.timestamp <= lastTimestampRef.current) return;
    lastTimestampRef.current = cmd.timestamp;
    handlerRef.current(cmd);
  });
}
