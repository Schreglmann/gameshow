# Spec: YouTube Audio Download

## Goal
Allow downloading audio from YouTube URLs directly in the AssetsTab, so the host doesn't need external tools to acquire audio files for the gameshow.

## Acceptance criteria
- [x] "YouTube" button appears in AssetsTab toolbar for `audio` and `background-music` categories
- [x] Clicking the button opens a modal with a URL input field and optional subfolder selector
- [x] Submitting a valid YouTube URL downloads the audio via yt-dlp on the server
- [x] Downloaded audio is normalized (same pipeline as regular uploads) and stored in the correct category/subfolder
- [x] Progress is shown to the user during download (downloading → processing phases)
- [x] The file list refreshes automatically after a successful download
- [x] Errors (invalid URL, yt-dlp not installed, download failure) are displayed clearly
- [x] The downloaded filename is derived from the video title (sanitized)

## State / data changes
- No AppState changes — uses existing upload progress UI from UploadContext
- New API endpoint: `POST /api/backend/assets/:category/youtube-download`
  - Body: `{ url: string, subfolder?: string }`
  - Response (SSE stream):
    - `{ phase: 'downloading', percent: number, title?: string }`
    - `{ phase: 'processing' }`
    - `{ phase: 'done', fileName: string }`
    - `{ phase: 'error', message: string }`
- Server dependency: `yt-dlp` must be installed on the host machine

## UI behaviour
- Screen / component affected: `AssetsTab`
- Button placement: next to the existing upload area, only for audio categories
- Modal: simple dialog with URL input, optional subfolder dropdown, and a submit button
- During download: modal shows progress bar with phase label (Downloading… / Processing…)
- On success: modal closes, file list refreshes, brief success toast
- On error: error message shown in the modal
- Edge cases:
  - yt-dlp not installed → server returns error, modal shows "yt-dlp is not installed" message
  - Invalid/private video → yt-dlp fails, error forwarded to client
  - Network timeout → standard error handling

## Out of scope
- Video download (audio extraction only) — see `youtube-video-download.md`
- Choosing audio format (always best quality → normalized)
- Installing yt-dlp automatically

*Note: Playlist downloads are now supported — see `youtube-playlist-download.md`*
