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

## Out of scope
- Multi-key chords or custom key bindings
- Touch / swipe gestures
- Gamepad input
