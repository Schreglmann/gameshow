# Spec: YouTube Playlist Audio Download

## Goal
Allow downloading an entire YouTube playlist as audio files, saving all tracks into a new subfolder named after the playlist title.

## Acceptance criteria
- [ ] When a playlist URL is detected in the YouTube modal, the user is prompted to choose "Ganze Playlist" or "Einzelnes Video"
- [ ] Choosing "Ganze Playlist" downloads all tracks; choosing "Einzelnes Video" downloads only the single video (same as non-playlist URL)
- [ ] Playlist detection only applies to audio categories (audio/background-music), not videos
- [ ] Downloaded tracks are saved in a new subfolder named after the playlist title (sanitized)
- [ ] If the user selected a subfolder, the playlist folder is nested inside it
- [ ] Each downloaded audio file is normalized (same pipeline as single-track downloads)
- [ ] Files are named with playlist index prefix for correct sorting: `{index} - {title}.mp3`
- [ ] Progress UI shows: playlist title, current track index/total, per-track download percentage
- [ ] Processing phase shows per-track normalization progress
- [ ] Done phase shows total track count and playlist folder name
- [ ] Single-video URLs continue to work exactly as before (no regression)
- [ ] Playlist downloads are only supported for audio categories — videos category ignores playlist and downloads single video
- [ ] Empty playlists show an error message
- [ ] Partial failures (some tracks unavailable) still process successfully downloaded tracks
- [ ] File list refreshes after successful download
- [ ] Tracks whose title fuzzy-matches a file already in the target playlist folder are reported as `done` up-front and no yt-dlp process is spawned for them. If every track is already on disk the job still completes successfully (no "Keine Dateien konnten heruntergeladen werden" error)

## State / data changes
- No AppState changes
- Extended SSE event type with optional playlist fields:
  - `playlistTitle?: string` — name of the playlist
  - `trackIndex?: number` — current track (1-based)
  - `trackCount?: number` — total tracks in playlist
- `YouTubeDownloadEvent` (backendApi.ts) extended with same 3 fields
- `YtDownloadProgress` (UploadContext.tsx) extended with same 3 fields
- Request body extended with `playlist?: boolean` — client sends `true` for playlist, `false` for single video
- No new API endpoints — existing endpoint accepts new `playlist` field

## UI behaviour
- Screen / component affected: `AdminScreen` (UploadOverlay), `AssetsTab` (modal)
- YouTube modal: when a playlist URL is detected (audio categories only), the download button is replaced with two buttons: "Ganze Playlist" and "Einzelnes Video", with a hint text "Playlist erkannt — was soll heruntergeladen werden?"
- For non-playlist URLs or videos category: modal unchanged (single "Herunterladen" button)
- Progress overlay when playlist detected:
  - Header: "YouTube Playlist: {playlistTitle}"
  - Sub-label: "Track {trackIndex} von {trackCount}: {title}"
  - Progress bar: per-track download percentage
  - Phase labels:
    - downloading: "Playlist wird heruntergeladen…"
    - processing: "Lautstärke wird normalisiert ({trackIndex}/{trackCount})…"
    - done: "Fertig — {trackCount} Tracks in '{playlistTitle}' gespeichert"
- Single-video progress: unchanged

## Out of scope
- Playlist download for videos category
- Choosing which tracks to download (always downloads all)
- Custom folder naming (always uses playlist title)
- Resuming interrupted playlist downloads
