import { useEffect, useRef } from 'react';

interface ArrowRightLongPressOptions {
  /**
   * When false the handler ignores ArrowRight entirely, letting the event
   * bubble to BaseGameWrapper's `useKeyboardNavigation` so a press performs the
   * normal "advance one" navigation. Set this to false once the game has
   * reached its fully-revealed state.
   */
  enabled: boolean;
  /** Fired on a short tap (key released before `holdMs`). */
  onShortPress: () => void;
  /** Fired once the key has been held for `holdMs`. */
  onLongPress: () => void;
  /** Hold threshold in milliseconds. */
  holdMs?: number;
}

/**
 * Capture-phase ArrowRight handler that distinguishes a short tap from a long
 * press (hold). Mirrors Bandle's jump-to-answer interaction so games can reveal
 * everything at once when the host holds the key.
 *
 * While `enabled`, a keydown intercepts ArrowRight (preventDefault +
 * stopPropagation), blocking BaseGameWrapper's bubble-phase navigation listener;
 * a key release within `holdMs` runs `onShortPress`, otherwise `onLongPress`
 * fires when the timer elapses. While not `enabled`, ArrowRight is left alone so
 * normal navigation handles it.
 *
 * Callbacks and `enabled` are read through refs so the document listeners are
 * registered exactly once and never observe stale closures.
 */
export function useArrowRightLongPress({
  enabled,
  onShortPress,
  onLongPress,
  holdMs = 500,
}: ArrowRightLongPressOptions) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const shortPressRef = useRef(onShortPress);
  shortPressRef.current = onShortPress;
  const longPressRef = useRef(onLongPress);
  longPressRef.current = onLongPress;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let keyHeld = false;
    let longPressTriggered = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight') return;
      if (keyHeld) {
        // Swallow OS key-repeat so it neither advances nor restarts the timer.
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (!enabledRef.current) return; // let it bubble to normal navigation
      e.stopPropagation();
      e.preventDefault();
      keyHeld = true;
      longPressTriggered = false;
      timer = setTimeout(() => {
        longPressTriggered = true;
        longPressRef.current();
        timer = null;
      }, holdMs);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight') return;
      const wasHeld = keyHeld;
      keyHeld = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (wasHeld && !longPressTriggered) {
        shortPressRef.current();
      }
      longPressTriggered = false;
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (timer) clearTimeout(timer);
    };
  }, [holdMs]);
}
