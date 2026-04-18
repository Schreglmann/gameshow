# Spec: Movie Posters for Video Thumbnails

## Goal
Use movie poster images (fetched from TMDB or iTunes) as video thumbnails in the admin Assets tab. Fall back to a non-black video frame when no poster is available. A script fetches posters for all existing videos; the server also auto-fetches on upload.

## Acceptance criteria
- [x] Video list thumbnails show the movie poster from `images/movie-posters/{slug}.jpg` if it exists
- [x] If no poster exists (image 404s), fall back to a video frame — NOT the first frame; seek to `min(10% of duration, 5s)`
- [x] Poster slug is derived from the video filename: strip extension, year `(YYYY)`, brackets, dots/underscores → spaces, lowercase, join with hyphens
- [x] `npm run fetch-movie-posters` fetches posters for all video files in `local-assets/videos/` and NAS `videos/` (if mounted), saves to `images/movie-posters/{slug}.jpg`
- [x] Uses TMDB as primary source when `TMDB_API_KEY` env var is set; falls back to IMDb suggestion API (free, no API key)
- [x] IMDb fallback uses the public suggestion API (`v3.sg.media-imdb.com`), returns actual movie posters, prefers results with `qid=movie`
- [x] IMDb requests are client-side rate-limited to 20 req/min (sliding window) — requests queue rather than fail
- [x] Skips videos that already have a poster file
- [x] When `fetchAndSavePoster` is called for a video whose derived poster filename has been aliased via `local-assets/images/.asset-aliases.json` (e.g. after a DAM merge — see [asset-merge.md](asset-merge.md)), the existing aliased poster is returned and no re-download happens
- [x] On video upload via the backend, the server auto-fetches the poster in the background (fire-and-forget, does not delay upload response)
- [x] Auto-fetched poster is mirrored to `local-assets/images/movie-posters/` when NAS is active
- [x] When a video is downloaded from YouTube, the YouTube thumbnail is saved as the poster (via yt-dlp `--write-thumbnail --convert-thumbnails jpg`). IMDb/TMDB auto-fetch runs only as a fallback when no thumbnail was saved. Existing posters and alias targets are not overwritten.
- [x] Opening a video in the DAM preview modal shows the poster as a floating thumbnail in the top-right corner of the player; clicking it opens the existing poster lightbox
- [x] Script prints per-file progress and a summary line
- [x] Slug function is identical in server module and frontend component

## State / data changes
- New files: `images/movie-posters/{slug}.jpg` (gitignored like all of `images/`)
- New module: `server/movie-posters.ts` — exports `videoFilenameToSlug`, `fetchPosterUrl`, `fetchAndSavePoster`
- No changes to AppState, localStorage, or game JSON files

## UI behaviour
- `VideoThumb` React component replaces the inline `<video>` in `renderVideoItem`
- Tries `<img src="/images/movie-posters/{slug}.jpg">` first
- On `onError` (file not found): switches to `<video>` element, seeks to `min(duration * 0.1, 5s)` on `onLoadedMetadata`
- Same CSS class `asset-file-video-thumb` — no layout changes

## Slug examples
| Filename | Slug |
|---|---|
| `Die Hard.mp4` | `die-hard` |
| `The Shawshank Redemption (1994).mkv` | `the-shawshank-redemption` |
| `Terminator.2.Judgment.Day.mp4` | `terminator-2-judgment-day` |
| `Avengers [2012].mp4` | `avengers` |

## Out of scope
- Generating thumbnails server-side with ffmpeg
- Storing poster path in any game JSON
- UI to manually assign or change a poster
