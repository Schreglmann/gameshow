import { useEffect, useMemo, useState } from 'react';
import MusicControls from '@/components/layout/MusicControls';
import type { MusicPlayerControls } from '@/hooks/useBackgroundMusic';
import { useMusicState, useSendMusicCommand } from '@/hooks/useMusicSync';

/**
 * Docked background-music player for the gamemaster toolbar. Mirrors the active
 * show's music (name / time / play state / volume) and drives it over WebSocket
 * — it is a remote control, not a second audio stream. Reuses the show's
 * `MusicControls` UI (docked variant) by feeding it a proxy `MusicPlayerControls`
 * whose methods dispatch `music-command`s. See specs/gamemaster-music-control.md.
 */
export default function GamemasterMusicControls() {
  const state = useMusicState();
  const sendCommand = useSendMusicCommand();

  // Optimistic volume: reflect a slider drag immediately instead of waiting for
  // the show to echo the new value back over WS (which would make the knob
  // stutter). Cleared once the show's reported volume catches up.
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  useEffect(() => {
    if (pendingVolume !== null && state && Math.abs(state.volume - pendingVolume) < 0.005) {
      setPendingVolume(null);
    }
  }, [state, pendingVolume]);

  const player: MusicPlayerControls = useMemo(
    () => ({
      isPlaying: state?.isPlaying ?? false,
      currentSong: state?.currentSong ?? '',
      currentTime: state?.currentTime ?? 0,
      duration: state?.duration ?? 0,
      volume: pendingVolume ?? state?.volume ?? 0,
      // play/pause/start all map to a single toggle — the show resolves the
      // correct action from its own state (see useMusicCommandListener).
      start: () => sendCommand('toggle'),
      pause: () => sendCommand('toggle'),
      resume: () => sendCommand('toggle'),
      skipToNext: () => sendCommand('skip'),
      setVolume: (v: number) => {
        setPendingVolume(v);
        sendCommand('volume', v);
      },
      seekTo: (fraction: number) => sendCommand('seek', fraction),
      // Game-audio fades are driven on the show; the GM proxy never fades.
      fadeOut: () => {},
      fadeIn: () => {},
    }),
    [state, pendingVolume, sendCommand],
  );

  return (
    <div className="gm-music-group">
      <span className="gm-music-label">Musik</span>
      <MusicControls player={player} docked />
    </div>
  );
}
