import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicPlayerState, MusicCommand } from '@/types/game';
import type { MusicPlayerControls } from '@/hooks/useBackgroundMusic';
import { onWsOpen, sendWs, useWsChannel } from '@/services/useBackendSocket';
import { isInactiveShowTab, onBecameActive, onReemitRequest } from '@/services/showPresenceState';

/**
 * Background-music remote control sync (show ↔ gamemaster).
 *
 * Mirrors `useGamemasterSync`: the **active** show tab broadcasts its music
 * player state on the cached `music-state` channel; the gamemaster reads it and
 * sends control commands back on the ephemeral `music-command` channel, which
 * the active show applies to its `useBackgroundMusic` instance.
 *
 * See specs/gamemaster-music-control.md.
 */

const LS_MUSIC_KEY = 'gm:last-music';

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

function snapshot(p: MusicPlayerControls): MusicPlayerState {
  return {
    isPlaying: p.isPlaying,
    currentSong: p.currentSong,
    currentTime: p.currentTime,
    duration: p.duration,
    volume: p.volume,
  };
}

// ── State channel (active show → gamemaster) ──

/**
 * Writer hook (show side): broadcasts the current background-music player state
 * to the gamemaster over the cached `music-state` channel.
 *
 * Emits immediately whenever a *control* field changes (play/pause, track,
 * duration, volume) and, while something is advancing, once per second from an
 * interval — but the interval send is deduped against the last serialized
 * payload so a paused track stops re-broadcasting. Force re-emits on reconnect,
 * on becoming the active tab, and on a GM reemit request, so a freshly-connected
 * or recovering GM always gets the truth within one round-trip.
 *
 * Only the active show tab emits (`isInactiveShowTab` gate), matching every
 * other show→GM writer.
 */
export function useMusicStateSync(player: MusicPlayerControls): void {
  const playerRef = useRef(player);
  playerRef.current = player;
  const lastSentRef = useRef<string>('');

  const emit = useCallback((opts?: { skipActiveCheck?: boolean; force?: boolean }) => {
    if (!opts?.skipActiveCheck && isInactiveShowTab()) return;
    const state = snapshot(playerRef.current);
    const serialized = JSON.stringify(state);
    if (!opts?.force && serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    sendWs('music-state', state);
  }, []);

  // Control-state changes → emit immediately (responsive). Keyed on the
  // control fields only (NOT currentTime), so an ordinary 100ms currentTime
  // re-render doesn't re-run this effect.
  const controlDep = `${player.isPlaying}|${player.currentSong}|${player.duration}|${player.volume}`;
  useEffect(() => {
    emit();
  }, [controlDep, emit]);

  // Progress tick → at most once per second while the serialized state actually
  // changed (i.e. while playing). A paused track produces an identical payload
  // and is dropped, so no idle churn.
  useEffect(() => {
    const id = setInterval(() => emit(), 1000);
    return () => clearInterval(id);
  }, [emit]);

  // Recovery re-emits (force, ignoring the dedup so an identical value still
  // repopulates a just-restarted server cache).
  useEffect(() => onWsOpen(() => emit({ force: true })), [emit]);
  useEffect(() => onReemitRequest(() => emit({ force: true })), [emit]);
  useEffect(() => onBecameActive(() => emit({ force: true, skipActiveCheck: true })), [emit]);
}

/**
 * Reader hook (gamemaster side): returns the latest music state from the active
 * show, or `null` before any has arrived. Seeds from localStorage for instant
 * paint on reload — see `useGamemasterAnswer`.
 */
export function useMusicState(): MusicPlayerState | null {
  const [data, setData] = useState<MusicPlayerState | null>(() =>
    readLocalStorage<MusicPlayerState>(LS_MUSIC_KEY),
  );
  useWsChannel<MusicPlayerState | null>('music-state', (next) => {
    writeLocalStorage(LS_MUSIC_KEY, next);
    setData(next);
  });
  return data;
}

// ── Command channel (gamemaster → active show) ──

/**
 * Returns a function to send a music control command from the gamemaster to the
 * active show.
 */
export function useSendMusicCommand(): (action: MusicCommand['action'], value?: number) => void {
  return useCallback((action, value) => {
    const cmd: MusicCommand = { action, value, timestamp: Date.now() };
    sendWs('music-command', cmd);
  }, []);
}

/**
 * Listener hook (show side): applies music commands from the gamemaster to the
 * player. Timestamp-deduped (defensive against replays); inactive show tabs drop
 * commands so only the active show acts. `useWsChannel` keeps the latest handler
 * in a ref, so the ~100ms-re-rendered `player` closure is always current.
 */
export function useMusicCommandListener(player: MusicPlayerControls): void {
  const lastTimestampRef = useRef(0);

  useWsChannel<MusicCommand>('music-command', (cmd) => {
    if (isInactiveShowTab()) return;
    if (!cmd || typeof cmd.timestamp !== 'number') return;
    if (cmd.timestamp <= lastTimestampRef.current) return;
    lastTimestampRef.current = cmd.timestamp;

    switch (cmd.action) {
      case 'toggle':
        if (player.isPlaying) player.pause();
        else if (player.currentSong) player.resume();
        else player.start();
        break;
      case 'skip':
        player.skipToNext();
        break;
      case 'volume':
        if (typeof cmd.value === 'number') player.setVolume(cmd.value);
        break;
      case 'seek':
        if (typeof cmd.value === 'number') player.seekTo(cmd.value);
        break;
    }
  });
}
