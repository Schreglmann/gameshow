# Spec: Movie Posters for Video Thumbnails

## Goal
Use movie poster images (fetched from TMDB or iTunes) as video thumbnails in the admin Assets tab. Fall back to a non-black video frame when no poster is available. A script fetches posters for all existing videos; the server also auto-fetches on upload.

## Acceptance criteria
- [x] Video list thumbnails show the movie poster from `images/movie-posters/{slug}.jpg` if it exists
- [x] If no poster exists (image 404s), fall back to a video frame — NOT the first frame; seek to `min(10% of duration, 5s)`
- [x] Poster slug is derived from the video filename: strip extension, year `(YYYY)`, brackets, dots/underscores → spaces, lowercase, join with hyphens
- [x] `npm run fetch-movie-posters` fetches posters for all video files in `local-assets/videos/` and NAS `videos/` (if mounted), saves to `images/movie-posters/{slug}.jpg`
- [x] Uses TMDB as primary source when `TMDB_API_KEY` env var is set; falls back to iTunes movie search
- [x] Skips videos that already have a poster file
- [x] On video upload via the backend, the server auto-fetches the poster in the background (fire-and-forget, does not delay upload response)
- [x] Auto-fetched poster is mirrored to `local-assets/images/movie-posters/` when NAS is active
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
- TMDB search language preference
