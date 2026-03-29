# Spec: Audio Normalization

## Goal
A developer utility normalizes all audio files in the repo to a consistent loudness level (-16 LUFS) so background music and game audio play at a uniform volume without manual adjustment. Audio files uploaded through the DAM are automatically normalized during upload.

## Acceptance criteria

### CLI (`normalize-audio.ts`)
- [x] `normalize` command scans the entire repo recursively for audio files (skips `node_modules/`, `.git/`, `dist/`, and `backup/` directories)
- [x] Supported formats: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.opus`
- [x] Files already within ±0.5 LUFS of -16 LUFS are skipped (no unnecessary re-encoding)
- [x] Before modifying a file, the original is copied to a `backup/` subdirectory next to the file
- [x] `.opus` files are converted to `.m4a` (AAC 192 kbps) for broader browser compatibility; the original `.opus` file is deleted after successful conversion
- [x] `restore` command copies files from all `backup/` directories back to their original locations and removes the backup files
- [x] `clean` command deletes all `backup/` subdirectories
- [x] `--dry-run` flag prints what would be done without modifying any files
- [x] `--force` flag re-analyzes all files even if a backup already exists (bypasses the fast-skip heuristic)
- [x] Uses `ffmpeg-static` npm package — no separate system FFmpeg installation required

### Server-side upload normalization (`server/normalize.ts`)
- [x] Audio files uploaded via `POST /api/backend/assets/:category/upload` for `audio` and `background-music` categories are automatically normalized to -16 LUFS before being stored
- [x] Files already within ±0.5 LUFS tolerance are left untouched (no unnecessary re-encoding)
- [x] `.opus` uploads are converted to `.m4a` (AAC 192 kbps); the returned `fileName` reflects the new extension
- [x] If normalization fails, the upload still succeeds with the original (unnormalized) file
- [x] The normalized file is mirrored to local-assets (same as any other upload)

## State / data changes
- No application state changes — operates only on files in the repo / asset directories
- CLI: `npx tsx normalize-audio.ts [normalize|restore|clean] [--dry-run] [--force]`
- Server: normalization runs inline during upload — no separate API or state

## UI behaviour
- CLI only (`normalize-audio.ts`)
- Prints per-file status: analyzing, skipped (already normalized), normalized, failed
- Prints summary counts at the end

## Out of scope
- Normalizing audio served from external URLs
- Changing the -16 LUFS target at runtime (requires editing the source constant)
- Blocking non-audio uploads for `images` category
