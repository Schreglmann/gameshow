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
- [x] After a video download, the file is **faststart-remuxed in the background** (moov atom moved to the front) so the raw DAM preview is immediately seekable instead of stalling until the whole file downloads. Skipped if the file is already faststart; reuses the same `runFaststartRemux` machinery as the manual "Faststart-Fix" button (decoupled from the request, survives reloads).
- [ ] Before downloading, the server probes the YouTube title (`yt-dlp --skip-download --print '%(title)s'`) and fuzzy-matches it against files already in the target folder. On match, the job ends immediately with `done` and the existing filename — no yt-dlp download is run. Applies to audio singles too, not just videos

## State / data changes
- No AppState changes — reuses existing upload progress UI from UploadContext
- Existing API endpoint extended: `POST /api/backend/assets/:category/youtube-download`
  - Now also accepts `category = 'videos'`
  - For videos: codec preference is **H.264 (avc1, mp4) → VP9 (webm) → any non-AV1 → AV1 (last resort)**. The DAM preview plays the **raw** file in a browser `<video>`, which cannot decode AV1 (YouTube serves AV1 only to clients that advertise support and silently sends others VP9/H.264 — so an AV1 download shows "broken" even though YouTube itself plays). H.264 and VP9 both decode in every browser; VP9 must be listed explicitly because it lives in webm, so a bare `best[ext=mp4]` would skip it and pick AV1. No forced `--merge-output-format`: H.264 pairs with m4a → mp4, VP9 pairs with webm audio → webm (each native container). Selector: `bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4]/bv*[vcodec^=vp9]+ba[ext=webm]/…/b`.
  - For videos: **mp4 downloads** are faststart-remuxed in the background only if the file isn't already faststart (in practice yt-dlp's merge usually already produces a faststart mp4, so this is a no-op safety net). webm (VP9) downloads skip this — webm is seekable via cues and the mp4 moov-remux would corrupt it. See acceptance criteria.
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

*Note: Keyword search (find a video without knowing the URL) is provided by the "Suchen" tab — see `youtube-search.md`*

## Out of scope
- Playlist downloads for videos (single video URLs only) — audio playlist downloads are supported, see `youtube-playlist-download.md`
- Automatic transcoding/re-encoding after download (the background step is a stream-copy faststart remux only — no codec change; the existing transcode UI can be used manually)
- Choosing video quality or format (codec preference is fixed — H.264 → VP9 → non-AV1 → AV1-last — for raw-preview browser compatibility; not user-configurable)
