import { useRef, useCallback, useEffect, useState } from 'react';
import { fetchBackgroundMusic } from '@/services/api';
import { useCurrentFrontendTheme } from '@/context/ThemeContext';

function encodeMusicPath(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}

function trackDisplayName(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.(mp3|m4a|wav|ogg|opus)$/i, '');
}

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
  const theme = useCurrentFrontendTheme();
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
  const isPlayingRef = useRef(false);
  const suppressNextFadeIn = useRef(false);
  const crossfadeRef = useRef<() => void>(() => {});

  const getActive = useCallback(() => {
    return activeAudio.current === 'A' ? audioA.current : audioB.current;
  }, []);

  const getInactive = useCallback(() => {
    return activeAudio.current === 'A' ? audioB.current : audioA.current;
  }, []);

  // Init audio elements + timer once
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.volume = volume;
    audioB.current.volume = 0;

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
      const src = `/background-music/${encodeMusicPath(file)}`;

      const active = getActive();
      if (!active) return;

      active.src = src;
      active.volume = volume;
      active.play().catch(console.error);
      setCurrentSong(trackDisplayName(file));
      isPlayingRef.current = true;
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
    next.src = `/background-music/${encodeMusicPath(file)}`;
    next.volume = 0;
    next.play().catch(console.error);
    setCurrentSong(trackDisplayName(file));

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

  // Keep a stable ref to crossfade so the theme-change effect can invoke it.
  useEffect(() => {
    crossfadeRef.current = crossfade;
  }, [crossfade]);

  // Reload the playlist whenever the active frontend theme changes.
  // Theme changes do a *sequential* swap (fade out current → switch source →
  // fade in new) rather than a crossfade, because two different theme
  // soundtracks playing on top of each other for two seconds sounds chaotic.
  // The swap reuses the active audio element so any in-flight crossfade on
  // the inactive element is also cleaned up.
  useEffect(() => {
    let cancelled = false;
    fetchBackgroundMusic(theme)
      .then(files => {
        if (cancelled) return;
        const newPlaylist = files.sort(() => Math.random() - 0.5);

        if (!isPlayingRef.current || newPlaylist.length === 0) {
          playlist.current = newPlaylist;
          currentIndex.current = -1;
          return;
        }

        const active = getActive();
        const inactive = getInactive();
        if (!active) {
          playlist.current = newPlaylist;
          currentIndex.current = -1;
          return;
        }

        // Cancel any in-flight fade and silence the inactive element so a
        // half-completed crossfade can't leak its track into the new theme.
        if (fadeInterval.current) {
          clearInterval(fadeInterval.current);
          fadeInterval.current = null;
        }
        if (inactive && !inactive.paused) {
          inactive.pause();
          inactive.currentTime = 0;
          inactive.volume = 0;
          inactive.ontimeupdate = null;
          inactive.onended = null;
        }

        const startVol = active.volume;
        const fadeOutMs = 600;
        const fadeOutSteps = 12;
        let step = 0;

        const swapSrcAndFadeIn = () => {
          if (cancelled) return;
          active.pause();
          active.currentTime = 0;
          active.volume = 0;

          playlist.current = newPlaylist;
          currentIndex.current = 0;
          const file = newPlaylist[0];
          active.src = `/background-music/${encodeMusicPath(file)}`;
          active.play().catch(console.error);
          setCurrentSong(trackDisplayName(file));

          active.onended = () => crossfadeRef.current();
          active.ontimeupdate = () => {
            if (active.duration && active.currentTime > active.duration - 3) {
              active.ontimeupdate = null;
              crossfadeRef.current();
            }
          };

          const target = volume;
          const fadeInMs = 800;
          const fadeInSteps = 16;
          let inStep = 0;
          fadeInterval.current = window.setInterval(() => {
            if (cancelled) {
              if (fadeInterval.current) clearInterval(fadeInterval.current);
              fadeInterval.current = null;
              return;
            }
            inStep++;
            active.volume = Math.min(target, target * (inStep / fadeInSteps));
            if (inStep >= fadeInSteps) {
              if (fadeInterval.current) clearInterval(fadeInterval.current);
              fadeInterval.current = null;
              active.volume = target;
            }
          }, fadeInMs / fadeInSteps);
        };

        if (startVol === 0) {
          swapSrcAndFadeIn();
          return;
        }

        fadeInterval.current = window.setInterval(() => {
          if (cancelled) {
            if (fadeInterval.current) clearInterval(fadeInterval.current);
            fadeInterval.current = null;
            return;
          }
          step++;
          active.volume = Math.max(0, startVol * (1 - step / fadeOutSteps));
          if (step >= fadeOutSteps) {
            if (fadeInterval.current) clearInterval(fadeInterval.current);
            fadeInterval.current = null;
            swapSrcAndFadeIn();
          }
        }, fadeOutMs / fadeOutSteps);
      })
      .catch(console.error);
    return () => { cancelled = true; };
    // `volume` intentionally not in deps — we read it through the ref-like
    // closure above; including it would re-trigger the swap on every volume
    // tweak. The eslint disable below mirrors the comment in playTrack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const start = useCallback(() => {
    if (playlist.current.length > 0) {
      playTrack(0);
    }
  }, [playTrack]);

  const pause = useCallback(() => {
    getActive()?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, [getActive]);

  const resume = useCallback(() => {
    getActive()?.play().catch(console.error);
    isPlayingRef.current = true;
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
      // Remember whether music was active so the paired fadeIn can skip if not.
      suppressNextFadeIn.current = !isPlayingRef.current;
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
        isPlayingRef.current = false;
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
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      }, stepMs);
    },
    [getActive]
  );

  const fadeIn = useCallback(
    (ms = 4000) => {
      // If the preceding fadeOut happened while music was not playing,
      // skip the paired fadeIn so we don't auto-resume a user-paused player.
      if (suppressNextFadeIn.current) {
        suppressNextFadeIn.current = false;
        return;
      }
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
      isPlayingRef.current = true;
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
