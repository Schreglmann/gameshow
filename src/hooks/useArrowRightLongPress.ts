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
  /** Fired once the key has been held for `holdMs`, or on OS key-repeat. */
  onLongPress: () => void;
  /** Hold threshold in milliseconds. */
  holdMs?: number;
}

/**
 * Capture-phase forward-key handler that distinguishes a short tap from a long
 * press (hold). Mirrors Bandle's jump-to-answer interaction so games can reveal
 * everything at once when the host holds the key.
 *
 * The "forward" key is either `ArrowRight` or `Space` — presenter clickers map
 * their forward button to one or the other, and both perform the normal
 * "advance one" navigation, so both must also support the hold-to-skip gesture.
 *
 * While `enabled`, a keydown intercepts the forward key (preventDefault +
 * stopPropagation), blocking BaseGameWrapper's bubble-phase navigation listener;
 * a key release within `holdMs` runs `onShortPress`, otherwise `onLongPress`
 * fires. While not `enabled`, the key is left alone so normal navigation handles
 * it.
 *
 * The hold is detected two ways, whichever comes first: (1) the wall-clock
 * `holdMs` timer (a genuinely sustained keydown), and (2) the first OS
 * key-repeat keydown while held (robust against clickers that send an early
 * `keyup` which would otherwise cancel the timer). Note some presenter
 * clickers (e.g. Logitech) send one discrete keypress per physical click and
 * emit NOTHING while the button is held — for those, neither signal fires and
 * this gesture is unavailable; a double-tap trigger was considered but
 * rejected as too easy to fire by accident during normal rapid advancing.
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

    const isForwardKey = (e: KeyboardEvent) => e.key === 'ArrowRight' || e.key === ' ';

    // Ignore the gesture while typing so Space/ArrowRight still work in fields.
    const inTextField = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest?.('input, textarea, [contenteditable="true"]');
    };

    const fireLongPress = () => {
      if (longPressTriggered) return;
      longPressTriggered = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      longPressRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isForwardKey(e) || inTextField(e)) return;
      if (keyHeld) {
        // Already holding. Swallow so it neither advances nor restarts the
        // timer. An OS key-repeat (`e.repeat`) is a positive "still held"
        // signal — fire the long press now, robust against clickers that send
        // an early keyup which would otherwise cancel the wall-clock timer.
        // (A second keydown WITHOUT `e.repeat` is a distinct new tap that lost
        // its keyup; do not treat it as a hold.)
        e.stopPropagation();
        e.preventDefault();
        if (e.repeat) fireLongPress();
        return;
      }
      if (!enabledRef.current) return; // let it bubble to normal navigation
      e.stopPropagation();
      e.preventDefault();
      keyHeld = true;
      longPressTriggered = false;
      timer = setTimeout(() => {
        timer = null;
        fireLongPress();
      }, holdMs);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isForwardKey(e)) return;
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
