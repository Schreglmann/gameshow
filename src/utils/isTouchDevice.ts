/**
 * True when the device's primary pointer is touch — i.e. a phone or tablet
 * (iPad) where focusing an input pops up the on-screen keyboard.
 *
 * Used to suppress `autoFocus` on admin search inputs: on a desktop the
 * autofocus is convenient (type immediately), but on a touch device it forces
 * the soft keyboard open unprompted and covers half the screen.
 *
 * Detection: the `(pointer: coarse)` media query reports the *primary* pointer
 * as coarse on phones and iPads, and `fine` on a mouse/trackpad desktop (a
 * touchscreen laptop still reports `fine` because its primary pointer is the
 * trackpad, so it keeps autofocus — which is correct, it has a hardware
 * keyboard). Falls back to `navigator.maxTouchPoints` where pointer media
 * queries are unavailable (e.g. jsdom in tests → returns false).
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}
