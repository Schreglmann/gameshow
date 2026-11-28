import type { GamemasterControl } from '@/types/game';
import { safePlay } from '@/utils/safePlay';

/**
 * The gamemaster's play/pause + restart buttons for a game's audio clip.
 * Games route the `audio-playpause` / `audio-restart` commands back to
 * whichever audio element is currently active.
 */
export function audioControlGroup(playing: boolean): GamemasterControl {
  return {
    type: 'button-group',
    id: 'audio-controls',
    buttons: [
      { id: 'audio-playpause', label: playing ? 'Pause' : 'Abspielen' },
      { id: 'audio-restart', label: 'Von vorne' },
    ],
  };
}

interface TrimOptions {
  start?: number;
  end?: number;
  onError?: (err: unknown, attempt: number) => void;
}

/**
 * Pause a playing clip, or resume a paused one. A clip that already stopped
 * at its trim end resumes from its trim start instead of stopping right away.
 */
export function toggleTrimmedAudio(audio: HTMLAudioElement, { start, end, onError }: TrimOptions = {}): void {
  if (!audio.paused) {
    audio.pause();
    return;
  }
  if (end !== undefined && audio.currentTime >= end) {
    audio.currentTime = start ?? 0;
  }
  void safePlay(audio, { onError });
}

/** Seek a clip back to its trim start and play it. */
export function restartTrimmedAudio(audio: HTMLAudioElement, { start, onError }: TrimOptions = {}): void {
  audio.currentTime = start ?? 0;
  void safePlay(audio, { onError });
}
