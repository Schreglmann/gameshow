import { useRef, useCallback, useEffect, useState } from 'react';
import { fetchBackgroundMusic } from '@/services/api';

export interface MusicPlayerControls {
  isPlaying: boolean;
  currentSong: string;
  currentTime: number;
  duration: number;
  volume: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  setVolume: (v: number) => void;
  fadeOut: (ms?: number) => void;
  fadeIn: (ms?: number) => void;
  seekTo: (fraction: number) => void;
}

export function useBackgroundMusic(): MusicPlayerControls {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSong, setCurrentSong] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.2);

  const playlist = useRef<string[]>([]);
  const currentIndex = useRef(0);
  const audioA = useRef<HTMLAudioElement | null>(null);
  const audioB = useRef<HTMLAudioElement | null>(null);
  const activeAudio = useRef<'A' | 'B'>('A');
  const fadeInterval = useRef<number | null>(null);
  const timerInterval = useRef<number | null>(null);
  const loaded = useRef(false);

  const getActive = useCallback(() => {
    return activeAudio.current === 'A' ? audioA.current : audioB.current;
  }, []);

  const getInactive = useCallback(() => {
    return activeAudio.current === 'A' ? audioB.current : audioA.current;
  }, []);

  // Load playlist once
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.volume = volume;
    audioB.current.volume = 0;

    fetchBackgroundMusic()
      .then(files => {
        playlist.current = files.sort(() => Math.random() - 0.5);
      })
      .catch(console.error);

    // Timer for current time updates
    timerInterval.current = window.setInterval(() => {
      const active = activeAudio.current === 'A' ? audioA.current : audioB.current;
      if (active && !active.paused && active.duration) {
        setCurrentTime(active.currentTime);
        setDuration(active.duration);
      }
    }, 100);

    return () => {
      if (timerInterval.current) clearInterval(timerInterval.current);
      audioA.current?.pause();
      audioB.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playTrack = useCallback(
    (idx: number) => {
      if (playlist.current.length === 0) return;
      currentIndex.current = idx % playlist.current.length;
      const file = playlist.current[currentIndex.current];
      const src = `/background-music/${encodeURIComponent(file)}`;

      const active = getActive();
      if (!active) return;

      active.src = src;
      active.volume = volume;
      active.play().catch(console.error);
      setCurrentSong(file.replace(/\.(mp3|m4a|wav|ogg|opus)$/i, ''));
      setIsPlaying(true);

      active.onended = () => {
        crossfade();
      };

      // Pre-crossfade 3 seconds before track end
      active.ontimeupdate = () => {
        if (active.duration && active.currentTime > active.duration - 3) {
          active.ontimeupdate = null;
          crossfade();
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volume]
  );

  const crossfade = useCallback(() => {
    const old = getActive();
    const next = getInactive();
    if (!old || !next) return;

    const nextIdx = (currentIndex.current + 1) % playlist.current.length;
    currentIndex.current = nextIdx;
    const file = playlist.current[nextIdx];
    next.src = `/background-music/${encodeURIComponent(file)}`;
    next.volume = 0;
    next.play().catch(console.error);
    setCurrentSong(file.replace(/\.(mp3|m4a|wav|ogg|opus)$/i, ''));

    const steps = 20;
    const stepMs = 2000 / steps;
    let step = 0;
    if (fadeInterval.current) clearInterval(fadeInterval.current);

    fadeInterval.current = window.setInterval(() => {
      step++;
      const progress = step / steps;
      old.volume = Math.max(0, volume * (1 - progress));
      next.volume = volume * progress;
      if (step >= steps) {
        if (fadeInterval.current) clearInterval(fadeInterval.current);
        old.pause();
        old.currentTime = 0;
        activeAudio.current = activeAudio.current === 'A' ? 'B' : 'A';
        const active = getActive();
        if (active) {
          active.onended = () => crossfade();
          active.ontimeupdate = () => {
            if (active.duration && active.currentTime > active.duration - 3) {
              active.ontimeupdate = null;
              crossfade();
            }
          };
        }
      }
    }, stepMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  const start = useCallback(() => {
    if (playlist.current.length > 0) {
      playTrack(0);
    }
  }, [playTrack]);

  const pause = useCallback(() => {
    getActive()?.pause();
    setIsPlaying(false);
  }, [getActive]);

  const resume = useCallback(() => {
    getActive()?.play().catch(console.error);
    setIsPlaying(true);
  }, [getActive]);

  const skipToNext = useCallback(() => {
    crossfade();
  }, [crossfade]);

  const setVolume = useCallback(
    (v: number) => {
      setVolumeState(v);
      const active = getActive();
      if (active) active.volume = v;
    },
    [getActive]
  );

  const fadeOut = useCallback(
    (ms = 2000) => {
      const active = getActive();
      if (!active) return;
      // Cancel any in-progress fade
      if (fadeInterval.current) {
        clearInterval(fadeInterval.current);
        fadeInterval.current = null;
      }
      const startVol = active.volume;
      if (startVol === 0) {
        active.pause();
        setIsPlaying(false);
        return;
      }
      const steps = 20;
      const stepMs = ms / steps;
      let step = 0;
      fadeInterval.current = window.setInterval(() => {
        step++;
        active.volume = Math.max(0, startVol * (1 - step / steps));
        if (step >= steps) {
          if (fadeInterval.current) clearInterval(fadeInterval.current);
          fadeInterval.current = null;
          active.pause();
          setIsPlaying(false);
        }
      }, stepMs);
    },
    [getActive]
  );

  const fadeIn = useCallback(
    (ms = 4000) => {
      const active = getActive();
      if (!active) return;
      // Cancel any in-progress fade
      if (fadeInterval.current) {
        clearInterval(fadeInterval.current);
        fadeInterval.current = null;
      }
      if (!active.src || active.src === '' || active.src === window.location.href) {
        start();
        return;
      }
      active.volume = 0;
      active.play().catch(console.error);
      setIsPlaying(true);
      const target = volume;
      const steps = 20;
      const stepMs = ms / steps;
      let step = 0;
      fadeInterval.current = window.setInterval(() => {
        step++;
        active.volume = Math.min(target, target * (step / steps));
        if (step >= steps) {
          if (fadeInterval.current) clearInterval(fadeInterval.current);
          fadeInterval.current = null;
          active.volume = target;
        }
      }, stepMs);
    },
    [getActive, start, volume]
  );

  const seekTo = useCallback(
    (fraction: number) => {
      const active = getActive();
      if (active && active.duration) {
        active.currentTime = fraction * active.duration;
      }
    },
    [getActive]
  );

  return {
    isPlaying,
    currentSong,
    currentTime,
    duration,
    volume,
    start,
    pause,
    resume,
    skipToNext,
    setVolume,
    fadeOut,
    fadeIn,
    seekTo,
  };
}
