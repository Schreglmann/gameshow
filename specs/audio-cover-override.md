# Spec: Audio Cover Override, Source Labels, Propagation

## Goal
Make the cover of every audio track in the DAM an explicit, overridable 1:1 artifact — gamemaster can replace it with any image, swap a YouTube thumbnail for an iTunes cover, and see where the current cover came from. Changes propagate to every game that uses the cover without any JSON rewrite.

## Acceptance criteria
- [ ] The canonical cover for `audio/{basename}.{ext}` always lives at `local-assets/images/Audio-Covers/{basename}.jpg`. Every override writes bytes to this exact path.
- [ ] A source sidecar `local-assets/images/.audio-cover-meta.json` records for each cover filename its `source` (`youtube` | `itunes` | `musicbrainz` | `manual` | `auto`), `setAt` (epoch ms), and optional `origin.pickedFrom`.
- [ ] The audio preview modal in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) shows a source pill next to the cover: `Automatisch` / `YouTube` / `iTunes` / `MusicBrainz` / `Manuell`.
- [ ] The audio preview modal has a "Cover überschreiben…" button that opens the existing `PickerModal` in `images` mode; picking an image calls `POST /api/backend/audio-cover/override` → bytes copied to canonical path, stale `YouTube Thumbnails/` sibling removed, meta flipped to `manual`, `assets-changed` broadcast.
- [ ] The audio preview modal has an "iTunes-Cover laden" button. For confident iTunes matches the cover is replaced immediately; for unconfident matches a small confirmation modal previews artist + track + artwork before the user accepts. On `rate_limited` the UI toasts "iTunes-Abruf aktuell limitiert — später erneut versuchen". On `no_match` the UI toasts "Kein iTunes-Treffer gefunden". Success flips the pill to `iTunes`.
- [ ] [AudioGuessForm.tsx](../src/components/backend/questions/AudioGuessForm.tsx) shows a "Cover dieses Audios verwenden" button next to `answerImage` when `audio` is set. Clicking fills `answerImage` with `/images/Audio-Covers/{audioCoverFilename(basename)}`.
- [ ] [SimpleQuizForm.tsx](../src/components/backend/questions/SimpleQuizForm.tsx) shows the same button twice: on `questionImage` when `questionAudio` is set, and on `answerImage` when `answerAudio` is set.
- [ ] Bandle is explicitly NOT touched — [BandleForm.tsx](../src/components/backend/questions/BandleForm.tsx) unchanged.
- [ ] YouTube downloads now write the thumbnail to the canonical path `Audio-Covers/{basename}.jpg` (in addition to the archival subfolder copy) and record meta `source: 'youtube'`.
- [ ] On server startup, a one-shot migration backfills the canonical path + meta for every YT thumbnail in `Audio-Covers/YouTube Thumbnails/` that has no existing canonical sibling.
- [ ] When an audio file is deleted, its canonical cover, any `YouTube Thumbnails/` sibling, and its meta entry are all removed.
- [ ] When an audio file is renamed/moved, its canonical cover and meta entry are renamed to match (existing game-ref rewrite continues to update game JSONs).
- [ ] When an audio is merged (existing merge flow), the discarded audio's meta entry is deleted alongside its cover.
- [ ] `AudioCover` in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) cache-busts via the existing `coverVersions` map; any cover change bumps the version so the `<img>` re-fetches.
- [ ] Rejected requests (unsafe path, missing audio, source==target, invalid category, no iTunes match, rate-limited) return 4xx with `{ error }` — no partial writes.
- [ ] Responsive: source pill + both buttons stay within the audio-detail modal at 375 / 768 / 1024 / 1920 px.

## State / data changes
- **New persistence:** `local-assets/images/.audio-cover-meta.json` — `Record<string /* {basename}.jpg */, { source: 'youtube' | 'itunes' | 'musicbrainz' | 'manual' | 'auto'; setAt: number; origin?: { pickedFrom?: string } }>`. Dotfile, excluded from DAM listings.
- **New API endpoints:**
  - `POST /api/backend/audio-cover/override` — body `{ audioFileName, sourceImagePath }` → `{ success, coverPath, version }` or 4xx.
  - `POST /api/backend/audio-cover/itunes` — body `{ audioFileName, confirmToken? }` → `{ success, coverPath, version, source }` / `{ confirmRequired: true, confirmToken, candidate }` / 429 / 404.
  - `GET /api/backend/audio-cover/meta` → full `AudioCoverMeta` map.
- **Modified endpoints:** YouTube audio download now writes the canonical cover + meta; audio delete/rename/merge cascades handle meta + cover cleanup.
- **No `AppState` change.** No new localStorage keys.
- **Game file mutations:** none for cover changes. (Existing audio rename still rewrites `answerImage` / `questionImage` paths that reference the old cover.)

## UI behaviour
- Screen / component affected: [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) (audio preview), [AudioGuessForm.tsx](../src/components/backend/questions/AudioGuessForm.tsx), [SimpleQuizForm.tsx](../src/components/backend/questions/SimpleQuizForm.tsx).
- What the user sees:
  - Audio preview modal: cover with source pill beneath, two buttons "Cover überschreiben…" and "iTunes-Cover laden".
  - Image picker for override reuses the existing `PickerModal`; no new picker UI.
  - Question editors: small button next to the image field that is visible only when the paired audio field is populated.
- Edge cases:
  - Picking an image that resolves to the canonical cover itself is rejected (same_path).
  - Picking another audio's cover as source is allowed — copy-bytes only.
  - Legacy covers with no meta entry render as `Automatisch`.
  - iTunes rate-limit does not block the pill or the override button.
  - If the audio has no cover on disk yet, the "Cover dieses Audios verwenden" button is still enabled (writing the field path is cheap; the cover may be backfilled later).

## Out of scope
- Undo / audit log for cover overrides.
- Automatic re-fetch of covers on filename edit (only the on-disk rename path is handled).
- Bandle — the `tracks[]`/`answerImage` relationship is catalog-driven and not part of this feature.
- Cross-category (background-music) covers.
- Multi-file batch override in the UI (the existing batch iTunes/MusicBrainz fetcher stays as-is for bulk flows).
