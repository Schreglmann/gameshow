# Spec: Gamemaster Fullscreen Toggle

## Goal
Give the gamemaster a **"Vollbild"** toggle button that appears whenever an image or video is visible on the player-facing show, letting the host open/close a fullscreen overlay on the show remotely — without having to touch the show device.

## Acceptance criteria
- [ ] A **Vollbild** toggle appears in the gamemaster **toolbar**, positioned between the toggle cluster (after "Nächste Frage ausblenden") and the countdown group, **only** while the show is currently rendering an image or video (any game type, question phase or answer phase). It emits a `toggle-fullscreen` command.
- [ ] Pressing it opens a fullscreen overlay of the currently-shown media on the show; pressing it again closes it.
- [ ] The button label/highlight reflects the live state: "Vollbild" when closed, "Vollbild schließen" (active/highlighted) when open. The state tracks the show across devices (a second GM sees the same state).
- [ ] Clicking the media directly on the show still opens the same fullscreen overlay (unified — one overlay, two triggers).
- [ ] Closing the overlay on the show (click / Escape) resets the GM button back to "Vollbild".
- [ ] Fullscreen closes automatically on any navigation/proceed — revealing the answer, advancing to the next question, or going back (via GM `nav-forward`/`nav-forward-long`/`nav-back`, on-screen click, or keyboard) — so the host never advances behind the overlay. It also closes when the registered media leaves the screen.
- [ ] Videos open in the synced `VideoLightbox` (enlarged copy carries audio, source muted); images in the image `Lightbox` (cover-override applied).
- [ ] Running a show without a gamemaster connected is unaffected; the on-show click behaviour is unchanged.

## State / data changes
- New command `toggle-fullscreen` on the existing `gamemaster-command` channel (a new value of the generic `controlId` string — no payload/schema shape change). Handled centrally in `BaseGameWrapper`.
- New **FullscreenContext** (`src/context/FullscreenContext.tsx`) — a local UI-coordination context (like `ThemeContext` / `AudioCoverMetaContext`), **not** app/game state. Exposes:
  - `FullscreenMedia = { type: 'image'; src: string } | { type: 'video'; src: string; videoRef: RefObject<HTMLVideoElement | null> }`
  - Provider value `{ registerMedia(media | null), open(), close(), toggle(), isOpen, currentMedia }`
  - `useRegisterFullscreenMedia(media | null)` — registers the currently-visible media while mounted, clears on unmount/hide.
  - `useFullscreen()` → `{ open, close, toggle, isOpen }`.
- State (`fullscreenMedia`, `fullscreenOpen`) lives in `BaseGameWrapper`, which provides the context, derives the GM control, handles the command, and renders the single overlay.
- No new HTTP endpoints. No `AppState` change.

## UI behaviour
- Screen affected: `/show` (overlay render) and `/gamemaster` (toggle button). The button is a **toolbar-local** control (`.gm-fullscreen-toggle`, like the deadline/scroll buttons — NOT part of `GamemasterControl[]`), rendered between the toggle cluster and the countdown group. The show reports availability + open state via `fullscreenAvailable` / `fullscreenOpen` on the `gamemaster-controls` payload; the button emits `toggle-fullscreen`.
- The overlay reuses the existing `Lightbox` / `VideoLightbox` (`.lightbox-overlay`, 92vw × 92vh, object-fit contain; closes on click / Escape) — already responsive.
- Covered games (every type that renders media): simple-quiz/bet-quiz/wer-kennt-mehr (via `QuizQuestionView`), image-guess, color-guess, random-frame, video-guess, audio-guess (answer art), four-statements (answer image), bandle (answer cover), and any image in fact-or-fake / final-quiz / guessing-game / ranking.
- Registration rule when a screen shows more than one image (question + answer simultaneously): register the answer media once revealed, otherwise the question media.

## Out of scope
- Native browser Fullscreen API (`requestFullscreen`) — this uses the existing in-page lightbox overlay, consistent with the current click-to-enlarge.
- Fullscreen on the gamemaster's own device (the button only controls the show).
- Per-device fullscreen state (state is the show's; mirrored to all GMs via the controls channel).
