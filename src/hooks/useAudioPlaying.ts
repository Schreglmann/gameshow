import { useEffect, useState } from 'react';

/**
 * Reactive "is this audio element playing" flag for an element a game keeps
 * outside React (a detached `new Audio()` held in a ref). Mirror the element
 * into state wherever the ref is assigned/cleared and pass that state here.
 *
 * Returns `false` while `el` is null.
 */
export function useAudioPlaying(el: HTMLAudioElement | null): boolean {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!el) {
      setPlaying(false);
      return;
    }
    setPlaying(!el.paused);
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
    };
  }, [el]);

  return playing;
}
