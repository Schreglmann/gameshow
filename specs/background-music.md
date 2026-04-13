# Spec: Background Music

## Goal
Ambient background music plays continuously throughout the gameshow with smooth crossfades between tracks and manual fade controls for game audio moments.

## Acceptance criteria
- [x] Playlist is loaded from `GET /api/background-music` (scans `local-assets/background-music/`)
- [x] Supported formats: `.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`
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
