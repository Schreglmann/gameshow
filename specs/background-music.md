# Spec: Background Music

## Goal
Ambient background music plays continuously throughout the gameshow with smooth crossfades between tracks and manual fade controls for game audio moments.

## Acceptance criteria
- [x] Playlist is loaded from `GET /api/background-music` (scans `local-assets/background-music/`)
- [x] Supported formats: `.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`
- [x] Per-theme playlists: `GET /api/background-music?theme=<id>` returns audio files from `local-assets/background-music/<theme>/` if that subfolder contains any supported audio file; otherwise falls back to the flat root folder. Returned paths are relative to `local-assets/background-music/` (e.g. `harry-potter/intro.mp3` or `song.mp3`). Without the `theme` query param, only root-folder files are returned (legacy behaviour).
- [x] On server startup, a subfolder is created under `local-assets/background-music/` for every valid theme id (`galaxia`, `harry-potter`, `dnd`, `arctic`, `enterprise`) so the admin DAM exposes each theme as a drop target out of the box.
- [x] Client fetches the playlist using the current persisted frontend theme and re-fetches when the theme changes. On re-fetch, the player seamlessly starts a new track from the new playlist (crossfades out the current track, crossfades in the first track of the new playlist).
- [x] Playback starts automatically or on first user interaction (browser autoplay policy)
- [x] Tracks cycle randomly through the playlist; after the last track, loops back to the first
- [x] Crossfade between tracks is smooth (dual-audio element approach)
- [x] Manual fade-out takes ~2 seconds; manual fade-in restores previous volume over ~3 seconds
- [x] `MusicControls` UI provides: play/pause toggle, skip track, volume slider
- [x] Music state is independent of `GameContext` — lives in its own `MusicContext`
- [x] For game types that involve audio (e.g. `audio-guess`, `simple-quiz` with `questionAudio` or `answerAudio`), the background music fades out when the **rules phase** starts (landing → rules transition), via the `onRulesShow` callback in `BaseGameWrapper`
- [x] Background music fades back in when the **award-points phase** is shown — this is triggered via the `onNextShow` callback, which fires when transitioning from the game phase to award-points; if the point system is disabled, it fires at game completion instead
- [x] If the next game also involves audio, the background music fades in at the award-points screen and then fades out again when that next game's rules phase starts — there is no mechanism to pre-emptively suppress the fade-in
- [x] Games without any audio do not interact with background music at all — it plays uninterrupted throughout
- [x] If background music was not playing when a game's `fadeOut` fires (e.g. the host paused it before the quiz, or autoplay never started), the paired `fadeIn` after the game is suppressed — music stays silent instead of being auto-resumed

## State / data changes
- Separate `MusicContext` (the only React context outside `GameContext` that is permitted)
- State: `isPlaying`, `currentTrack`, `volume`, `playlist`
- Hook: `useBackgroundMusic()` exposes controls to components
- No localStorage persistence for music state

## UI behaviour
- `MusicControls` component in `Header`: always visible during the gameshow
- Play/pause button, next-track button, volume slider
- Current track name displayed (filename without extension)

## Out of scope
- Per-game music tracks (all games share the same background playlist)
- Audio visualisation
