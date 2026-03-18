# Spec: Lightbox

## Goal
Game components can show a full-screen image overlay so the host can zoom in on question or answer images without navigating away from the current game phase.

## Acceptance criteria
- [x] `Lightbox` renders nothing when `src` is `null`
- [x] When `src` is non-null, a full-screen overlay is rendered via `createPortal` into `document.body`
- [x] Clicking anywhere on the overlay calls `onClose()`
- [x] Pressing ArrowRight, ArrowLeft, or Escape while the lightbox is open calls `onClose()` — these key events are captured with `useCapture: true` so they fire before `useKeyboardNavigation` listeners on the same document
- [x] The overlay has `id="imageLightbox"` — this is the DOM contract used by `useKeyboardNavigation` to detect that the lightbox is open and suppress game-level navigation
- [x] `useLightbox()` hook provides `{ lightboxSrc, openLightbox, closeLightbox }` for managing open/close state in game components
- [x] Currently used by `SimpleQuiz` (question/answer images) and `ImageGame` (all game images)

## State / data changes
- No `AppState` changes — lightbox state is local to the consuming component via `useLightbox()`
- `useLightbox()` hook signature: `() => { lightboxSrc: string | null; openLightbox: (src: string) => void; closeLightbox: () => void }`

## UI behaviour
- Component: `src/components/layout/Lightbox.tsx`
- Overlay fills the viewport; clicking or pressing a navigation key dismisses it
- The image is rendered inside a `.lightbox-frame` div for centering/sizing

## Out of scope
- Multi-image galleries (only one image at a time)
- Zoom / pan within the lightbox
- Video support
