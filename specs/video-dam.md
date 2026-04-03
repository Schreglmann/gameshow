# Spec: Video DAM

## Goal
Add a "Videos" category to the admin Assets tab with the same drag-and-drop, folder management, and NAS/local-fallback behaviour as the existing image and audio categories.

## Acceptance criteria
- [ ] `AssetCategory` includes `'videos'`
- [ ] Server ALLOWED_CATEGORIES includes 'videos'; all asset CRUD endpoints work for it
- [ ] Server serves /videos/* static files from NAS and local-assets fallback
- [ ] Admin Assets tab has a "Videos" category button
- [ ] File list shows each video as a list item (icon, filename, inline thumbnail, move, delete)
- [ ] Clicking a video item opens a detail modal with `<video controls>`, duration, path, usages
- [ ] Detail modal shows video metadata: resolution, codec, fps, bitrate, file size (from ffprobe)
- [ ] Upload progress does NOT show audio normalization message for video uploads
- [ ] Drag-and-drop upload and drag-to-move work for video files
- [ ] local-assets/videos/ directory is created automatically on first upload
- [ ] sync:pull and sync:push include 'videos' folder (missing NAS dir skips gracefully)
- [ ] All UI text is in German

## State / data changes
- `AssetCategory` gains `'videos'` literal
- New state in AssetsTab: `videoPreview`, `videoPreviewUsages`, `videoPreviewDuration`, `videoInfo`
- `ProbeResult` extended with `videoInfo: VideoStreamInfo | null` (resolution, codec, fps, bitrate, duration, fileSize)
- No new API endpoints — reuses existing `/api/backend/assets/:category` routes and `/api/backend/assets/videos/probe`

## UI behaviour
- New "Videos" tab button in asset-category-tabs row
- List layout (same as audio) using `.asset-file-list` / `.asset-file-item`
- Each item: 🎬 icon, filename, inline muted `<video preload="metadata">` thumbnail (~80×45px), move button, delete button
- Click → video detail modal:
  - Header: filename, formatted duration, move button, delete button, close button
  - Body: `<video controls>` player (max-height ~60vh)
  - Meta: monospace path line
  - Usage list (same pattern as audio detail modal)
- Empty state: "Keine Videos vorhanden"
- Upload zone icon: 🎬

## Out of scope
- Video transcoding / normalization
- Thumbnail generation via ffmpeg
- Making videos selectable in AssetPicker (no game type uses video yet)
