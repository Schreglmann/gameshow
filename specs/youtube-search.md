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
- Server dependency: `yt-dlp` (nightly build, auto-downloaded on first use and re-downloaded once the cached binary is older than 7 days, same binary as the download flow — see `server/yt-dlp.ts`).

## Code structure
- [`server/yt-dlp.ts`](../server/yt-dlp.ts) owns the auto-downloaded binary (`YT_DLP_BIN`, `ensureYtDlp()`, JS-runtime args) and is shared by the download flow in `server/index.ts` and the search flow.
- [`server/youtube-search.ts`](../server/youtube-search.ts) runs the metadata-only flat search (`ytsearchN:<q> --flat-playlist --dump-json`) and normalises results. The pure `parseYtSearchOutput()` is unit-tested; the spawn sits behind an injectable runner so tests never launch a real process.
- The search is locale-pinned to German/Austria (`--extractor-args youtube:lang=de --geo-bypass-country AT`) — without it yt-dlp queries YouTube's search API with its default English/US locale, so a German-language query still surfaces mostly English results.

## UI behaviour
- Screen / component affected: `AssetsTab` (the `ytModal` block), new `YouTubeSearchPanel` component.
- Opening the modal lands on the **Suchen** tab (leftmost) by default; **URL** is the second tab.
- The Suchen tab: search form → result grid of 16:9 video cards (lazy thumbnails, title, channel, view-count badge bottom-left, duration badge bottom-right) → select → confirm download.
- Edge cases:
  - yt-dlp not yet installed → auto-downloaded on first search (brief delay), same as the download flow.
  - No results → empty state; query in flight → loading state; yt-dlp error → error banner.
  - Switching tabs preserves the chosen subfolder; selecting a search result is cleared when a new search is submitted.

## YouTube im Asset-Picker

The same search is reachable directly from the game editor: every `<AssetField category="audio">` and `<AssetField category="videos">` opens a `<PickerModal>` with a **DAM / ▶ YouTube** toggle, the audio/video counterpart of the image picker's **DAM / 🌐 Online** toggle ([dam-image-replace.md](dam-image-replace.md) "Online-Suche in Frage-Bildern"). The operator searches or pastes a link, previews the video, downloads it into the DAM, and the file is set on the question in one step.

- [x] The toggle appears only when `category` is `audio` or `videos`, `!multiSelect`, and an `UploadProvider` is mounted (always true in `/admin`). `background-music`, `images` (which keeps **🌐 Online**) and the multi-select cover flow never show it. Default mode is `dam`.
- [x] YouTube mode hides the DAM-only header controls (DAM filter field, upload, create-folder, sort) and the DAM breadcrumb. The image picker's Online mode hides the DAM filter field the same way.
- [x] Below 576px the picker header wraps: title, mode toggle and buttons on the first line(s), the DAM filter field on a full-width line of its own, so the ✕ never leaves the screen.
- [x] YouTube mode shows, top to bottom: the **Speichern in:** subfolder dropdown, a **URL einfügen** row, the shared `<YouTubeSearchPanel>`, the preview pane of the selected video, an error banner, and the **✓ Herunterladen** footer button.
- [x] The subfolder dropdown follows the same rule as the image picker: it tracks the folder browsed in DAM mode (`currentPath`) until the operator picks a folder in YouTube mode. It is omitted when the category has no subfolders.
- [x] Clicking a search result selects it; clicking it again deselects it; submitting a new search clears the selection.
- [x] Pasting a link into **URL einfügen** and pressing **Vorschau** (or Enter) selects that video. `parseYouTubeVideoId()` ([src/utils/youtube.ts](../src/utils/youtube.ts)) accepts `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtube.com/live/` and `music.youtube.com/watch?v=`. Anything else (including a playlist link without `v=`) shows **Keine gültige YouTube-URL** inline and selects nothing.
- [x] The selected video renders a preview pane (`.replace-compare.replace-compare--single`): a 16:9 player embedding `https://www.youtube-nocookie.com/embed/<id>?rel=0` (no autoplay), a meta line (title, channel, duration when known) and an **Auf YouTube öffnen ↗** link, so a video that blocks embedding can still be checked. The iframe keeps the browser's default referrer policy: YouTube refuses embeds that send no referrer (error 153). The player is unmounted when the selection changes, the download starts or the picker closes, so playback stops.
- [x] A **✕** (`Vorschau schließen`) in the preview pane's top-right corner closes the preview by deselecting the video — the same as Esc or clicking the selected card again — so the **✓ Herunterladen** button disappears with it.
- [x] The download starts only from **✓ Herunterladen**, for search results and pasted links alike. It runs through `UploadContext.startYtDownload` → the existing `POST /api/backend/assets/:category/youtube-download` (single video: the `playlist` flag is never sent, so a link with `&list=` downloads only that video). Progress shows in the shared progress overlay; normalization, the thumbnail cover and the existing-title dedupe behave as in the DAM.
- [x] While the download runs the picker stays open: the selected card carries the `is-busy` **Lade…** badge, the footer button reads **Lädt…**, and the mode toggle, dropdown, URL row and the other results are disabled. Esc does not deselect while downloading.
- [x] On success the picker resolves through the existing `onSelect` contract with `/<category>/<subfolder>/<fileName>`, so the question field is set exactly as if the file had been picked from the DAM.
- [x] On error the picker stays open with a `.replace-error` banner and the selection is kept.
- [x] If the operator closes the picker while the download runs, the download continues into the DAM, but the question field is not changed (the picker ignores the late result once unmounted).
- [x] Responsive at 375 / 768 / 1024 / 1920 px; the preview player is capped in height so the result grid stays reachable on small screens.

## Out of scope
- Multi-select / batch download from search results (single pick, like image search).
- YouTube mode in the `background-music` picker and in the Bandle track picker.
- Non-YouTube video sources, and choosing video/audio format or quality (yt-dlp defaults, as today).
- Playlist download from the search tab (playlists stay URL-tab-only).
