# Spec: Background Music

## Goal
Ambient background music plays continuously throughout the gameshow with smooth crossfades between tracks and manual fade controls for game audio moments.

## Acceptance criteria
- [x] Playlist is loaded from `GET /api/background-music` (scans `background-music/` directory)
- [x] Supported formats: `.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`
- [x] Playback starts automatically or on first user interaction (browser autoplay policy)
- [x] Tracks cycle through the playlist; after the last track, loops back to the first
- [x] Crossfade between tracks is smooth (dual-audio element approach)
- [x] Manual fade-out (e.g. when game audio starts) takes ~2–4 seconds
- [x] Manual fade-in (e.g. after game audio ends) restores previous volume over ~2–4 seconds
- [x] `MusicControls` UI provides: play/pause toggle, skip track, volume slider
- [x] Music state is independent of `GameContext` — lives in its own `MusicContext`
- [x] `GameScreen` triggers fade-out when entering a game and fade-in when leaving

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
- Shuffle/random order
- Per-game music tracks (all games share the same background playlist)
- Audio visualisation
