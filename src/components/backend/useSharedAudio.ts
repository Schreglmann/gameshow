import { useCallback, useEffect, useRef, useState } from 'react';

type PreloadMode = 'none' | 'metadata' | 'auto';

interface PoolEntry {
  audio: HTMLAudioElement;
  refCount: number;
  preload: PreloadMode;
}

const pool = new Map<string, PoolEntry>();
const preloadPriority: Record<PreloadMode, number> = { none: 0, metadata: 1, auto: 2 };

function ensureEntry(src: string): PoolEntry {
  let entry = pool.get(src);
  if (!entry) {
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = src;
    entry = { audio, refCount: 0, preload: 'none' };
    pool.set(src, entry);
  }
  return entry;
}

function pauseOthers(audio: HTMLAudioElement) {
  for (const entry of pool.values()) {
    if (entry.audio !== audio && !entry.audio.paused) {
      entry.audio.pause();
      entry.audio.currentTime = 0;
    }
  }
}

/**
 * Share a single HTMLAudioElement between all components subscribing to the same src.
 * Used by MiniAudioPlayer and AudioTrimTimeline so expanding the trim panel keeps
 * playback continuous — both views drive and observe the same audio element.
 */
export function useSharedAudio(src: string | undefined) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const entryRef = useRef<PoolEntry | null>(null);

  useEffect(() => {
    if (!src) {
      entryRef.current = null;
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const entry = ensureEntry(src);
    entry.refCount++;
    entryRef.current = entry;

    const { audio } = entry;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => { if (isFinite(audio.duration)) setDuration(audio.duration); };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);

    // Seed state from the live element (it may already be playing when a 2nd subscriber mounts)
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    if (isFinite(audio.duration)) setDuration(audio.duration);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);

      entry.refCount--;
      if (entry.refCount <= 0) {
        audio.pause();
        audio.src = '';
        pool.delete(src);
      }
      entryRef.current = null;
    };
  }, [src]);

  const ensureLoaded = useCallback((mode: 'metadata' | 'auto' = 'metadata') => {
    const entry = entryRef.current;
    if (!entry) return;
    if (preloadPriority[mode] > preloadPriority[entry.preload]) {
      entry.preload = mode;
      entry.audio.preload = mode;
      entry.audio.load();
    }
  }, []);

  const play = useCallback(() => {
    const entry = entryRef.current;
    if (!entry) return;
    pauseOthers(entry.audio);
    entry.audio.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    entryRef.current?.audio.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const entry = entryRef.current;
    if (!entry) return;
    entry.audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  return {
    audio: entryRef.current?.audio ?? null,
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    seek,
    ensureLoaded,
  };
}
