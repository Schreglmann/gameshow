/**
 * Fade a playing audio element down to silence over `duration` ms, then pause
 * it. No-op when the element is already paused. Shared by the quiz games that
 * keep question/answer audio running across the advance to the next question.
 */
export function fadeAudio(audio: HTMLAudioElement, duration = 2000): void {
  if (audio.paused) return;
  const startVolume = audio.volume;
  const steps = 40;
  const interval = duration / steps;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    audio.volume = Math.max(0, startVolume * (1 - step / steps));
    if (step >= steps) {
      clearInterval(timer);
      audio.pause();
    }
  }, interval);
}
