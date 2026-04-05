# Spec: YouTube Video Download

## Goal
Allow downloading videos from YouTube URLs directly in the AssetsTab video DAM, so the host doesn't need external tools to acquire video files for the gameshow.

## Acceptance criteria
- [x] "YouTube" button appears in AssetsTab toolbar for the `videos` category (same button style as audio)
- [x] Clicking the button opens the same modal with URL input and optional subfolder selector
- [x] Submitting a valid YouTube URL downloads the video via yt-dlp on the server as MP4
- [x] Downloaded video is stored in the correct category/subfolder (no audio normalization)
- [x] Progress is shown to the user during download (downloading phase with percentage)
- [x] The file list refreshes automatically after a successful download
- [x] Errors (invalid URL, download failure) are displayed clearly
- [x] The downloaded filename is derived from the video title (sanitized)

## State / data changes
- No AppState changes — reuses existing upload progress UI from UploadContext
- Existing API endpoint extended: `POST /api/backend/assets/:category/youtube-download`
  - Now also accepts `category = 'videos'`
  - For videos: downloads as MP4 (best quality, merged via ffmpeg)
  - For videos: skips audio normalization
  - SSE stream format unchanged

## UI behaviour
- Screen / component affected: `AssetsTab`
- Button placement: same drop zone YouTube button, now also shown for `videos` category
- Modal: identical to audio — URL input, optional subfolder, submit
- During download: same progress tracking as audio downloads
- On success: file list refreshes
- On error: error shown in progress tracker
- Edge cases: same as audio (invalid URL, network failure, etc.)

## Out of scope
- Playlist downloads for videos (single video URLs only) — audio playlist downloads are supported, see `youtube-playlist-download.md`
- Automatic transcoding after download (existing transcode UI can be used manually)
- Choosing video quality or format (always best quality → MP4)
