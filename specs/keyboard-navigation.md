# Spec: Keyboard Navigation

## Goal
A shared hook provides consistent keyboard and click navigation across all game phases, so the host can advance through the gameshow using only ArrowRight / Space / click without touching interactive controls.

## Acceptance criteria
- [x] ArrowRight key → calls `onNext()`
- [x] Space key → calls `onNext()`
- [x] ArrowLeft key → calls `onBack()` (only if `onBack` is provided; no-op otherwise)
- [x] A bare click anywhere on the page → calls `onNext()`
- [x] Clicks on buttons, inputs, textareas, anchor elements, `[role="button"]`, `.music-controls`, `#imageLightbox`, or `img` elements do NOT trigger navigation
- [x] When `enabled` is `false`, all key and click events are ignored
- [x] When the lightbox is open (`#imageLightbox` exists in the DOM), key events are suppressed so lightbox keyboard handling takes priority
- [x] Listeners are registered on `document` and cleaned up when the component unmounts

## State / data changes
- No `AppState` changes — hook is stateless
- Hook signature: `useKeyboardNavigation({ onNext, onBack?, enabled? })`
- `enabled` defaults to `true`

## UI behaviour
- Invisible to the user — no rendered output
- Used by `BaseGameWrapper` for phase transitions (landing → rules → game)
- Used by individual game components for question progression

## Long-press (skip-to-answer) variant

A companion hook `useArrowRightLongPress({ enabled, onShortPress, onLongPress, holdMs? })` ([`src/hooks/useArrowRightLongPress.ts`](../src/hooks/useArrowRightLongPress.ts)) lets the host **hold the forward key to reveal everything at once**, while a short tap advances one step. Used by `ranking`, `four-statements`, and `bandle`.

- The **forward key is `ArrowRight` OR `Space`** — presenter clickers map their forward button to either one, and both perform the normal advance, so both must support the hold gesture.
- The hold is detected by whichever comes first: (1) the `holdMs` wall-clock timer (default 500 ms), or (2) the **first OS key-repeat keydown** while the key is held. Key-repeat is the more reliable "key is down" signal — some presenter clickers emit an early `keyup` no matter how long the button is physically held, which would cancel the timer on its own and defeat the long press.
- While `enabled`, the key is intercepted in the capture phase (`preventDefault` + `stopPropagation`), blocking the bubble-phase `useKeyboardNavigation` listener; a release before the hold fires runs `onShortPress`, otherwise `onLongPress` fires exactly once. While not `enabled` (e.g. everything already revealed) the key is left alone so normal navigation handles it.
- Key events are ignored while a text field is focused (`input`, `textarea`, `[contenteditable="true"]`).
- The same "held forward key → reveal" behaviour is available from the gamemaster remote, where a hold is sent as the `nav-forward-long` WebSocket command and routed to each game's reveal-all action (see the per-game specs and [`specs/gamemaster-controls.md`](gamemaster-controls.md)).
- **Known limitation:** some presenter clickers (e.g. Logitech) send one discrete keypress per physical click and emit **nothing at all** while the button is held — no keydown, no repeat, no keyup during the hold. Neither the timer nor key-repeat can fire for such a device, so the skip gesture is unavailable on it. A double-tap trigger was tried as a workaround and rejected — it fired too easily during ordinary fast advancing.

## Out of scope
- Multi-key chords or custom key bindings
- Touch / swipe gestures
- Gamepad input
- Double-press / multi-tap gestures (tried and rejected — too easy to trigger by accident during normal rapid advancing, especially in `four-statements`/`bandle` which reveal clues one at a time)
