# Spec: YouTube Search (DAM)

## Goal
Let the host search YouTube by keyword inside the DAM and download a chosen result, mirroring the image-search UX — so acquiring audio/video no longer requires finding the watch-URL elsewhere first.

## Acceptance criteria
- [x] The existing "YouTube" download modal (audio / background-music / videos categories) gains a tab switch: **Suchen** | **URL**, with **Suchen the default (left) tab** when the modal opens.
- [x] The **URL** tab (second / right) keeps the current paste-a-URL + subfolder + playlist behaviour unchanged.
- [x] The **Suchen** tab shows a search box; submitting a query returns a grid of YouTube results (thumbnail, title, channel, view count, duration). On each thumbnail the compact view count sits at the bottom-left ("1,6 Mrd" / "412 Mio" / "12 Tsd", no "Aufrufe" suffix) and the duration at the bottom-right.
- [x] Results come from `yt-dlp` flat search on the server — no separate API key, no per-video download during search.
- [x] Results are **videos only** — channels and playlists that `ytsearch` returns mixed in (no duration, not downloadable) are filtered out server-side.
- [x] "Mehr laden" appears whenever the search is not exhausted and loads the next batch (the client appends + dedupes by URL).
- [x] While a search is running the user can edit the query and search again immediately (the submit button stays enabled); the in-flight request is aborted on both client and server (its yt-dlp process is killed) so a stale result can never overwrite the new one. An explicit **✕** cancel button is also shown while loading.
- [x] Clicking a result selects it; a "✓ Herunterladen" button downloads it into the active category / chosen subfolder via the **existing** `POST /api/backend/assets/:category/youtube-download` flow (yt-dlp → normalize → thumbnail-as-cover → SSE progress in the existing UploadContext tracker).
- [x] After confirming a download the modal closes and progress appears in the standard download tracker; the file list refreshes on completion.
- [x] Empty query disables the search button; a query with no hits shows an empty state; a yt-dlp failure shows an error.
- [x] The subfolder selector is shared with the URL tab (same `ytSubfolder` state, persists across modal open/close within a session).
- [x] Search works identically for `audio`, `background-music`, and `videos` (the result set is the same YouTube videos; only the download target category differs).

## State / data changes
- No AppState changes — download reuses the existing UploadContext progress UI.
- **New API endpoint:** `POST /api/backend/assets/youtube/search`
  - Body: `{ query: string; limit?: number (1–50, default 24); page?: number (default 1) }`
  - Response: `{ results: Array<{ id, url, title, channel?, duration?, viewCount?, thumbnailUrl? }>; page: number; hasMore: boolean }`
  - `400` on empty query, `502` when yt-dlp fails. Results cached 1h in memory keyed by `(query, limit, page)`.
- **Reused endpoint (unchanged):** `POST /api/backend/assets/:category/youtube-download` performs the actual download.
- Server dependency: `yt-dlp` (auto-downloaded on first use, same binary as the download flow).

## UI behaviour
- Screen / component affected: `AssetsTab` (the `ytModal` block), new `YouTubeSearchPanel` component.
- Opening the modal lands on the **Suchen** tab (leftmost) by default; **URL** is the second tab.
- The Suchen tab: search form → result grid of 16:9 video cards (lazy thumbnails, title, channel, view-count badge bottom-left, duration badge bottom-right) → select → confirm download.
- Edge cases:
  - yt-dlp not yet installed → auto-downloaded on first search (brief delay), same as the download flow.
  - No results → empty state; query in flight → loading state; yt-dlp error → error banner.
  - Switching tabs preserves the chosen subfolder; selecting a search result is cleared when a new search is submitted.

## Out of scope
- Multi-select / batch download from search results (single pick, like image search).
- Inline YouTube search inside game-editor audio/video pickers (DAM AssetsTab only).
- Non-YouTube video sources, and choosing video/audio format or quality (yt-dlp defaults, as today).
- Playlist download from the search tab (playlists stay URL-tab-only).
