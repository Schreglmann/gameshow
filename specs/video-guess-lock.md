# Spec: Video-Guess Instance Lock

## Goal
Allow each video-guess instance to be locked, freezing its markers and question set so that the segment caches (under `~/.gameshow/cache/compressed/` and `.../sdr/`) are guaranteed not to be invalidated or pruned. Unlocks are gated by a warning when any of the instance's source files are currently unreachable. This enables running a gameshow entirely from pre-built caches on a machine that no longer has the NAS or external source drive attached.

## Acceptance criteria

### Data model
- [ ] `VideoGuessConfig.locked?: boolean` is added to `src/types/config.ts`
- [ ] `locked` lives per-instance for multi-instance video-guess game files (via existing `MultiInstanceGameFile.instances: Record<string, Partial<GameConfig>>`)
- [ ] Single-instance video-guess files may also set `locked` at the top level
- [ ] Missing or `false` means unlocked (default)
- [ ] `validate-config.ts` accepts `locked` on video-guess instances; rejects it on non-video-guess types

### Admin UI
- [ ] The admin video-guess editor shows a lock button at the instance header next to the title/language controls
- [ ] The button is a toggle: shows 🔒 when locked, 🔓 when unlocked
- [ ] While `locked === true`:
  - [ ] All marker drags on `VideoMarkerEditor` are disabled (handles have `pointer-events: none`)
  - [ ] Answer, video, answer-image, and audioTrack fields are read-only (inputs/selects disabled)
  - [ ] "Frage hinzufügen", "Frage löschen", reorder handles, and enable/disable toggles are hidden or disabled
  - [ ] Expand/collapse of question blocks still works
  - [ ] Cache-regenerate ("Cache erstellen") button stays enabled — caches can always be rebuilt while source files are reachable
  - [ ] A banner at the top of the instance reads: "Diese Instanz ist gesperrt. Entsperren, um zu bearbeiten."
- [ ] Clicking the lock button when unlocked immediately sets `locked = true` and saves the game file (no confirmation)
- [ ] Clicking the lock button when locked calls the unlock-precheck endpoint first (see below)

### Server enforcement
- [ ] Game save endpoint (existing `PUT /api/backend/games/:name`) rejects with `409 Locked` if the save would mutate questions or markers inside a locked instance. The only allowed change is flipping `locked` itself
- [ ] The 409 response body is `{ error: string, instance: string }` so the client can surface a clear message
- [ ] Toggling `locked` is always allowed (locking and unlocking are never blocked by server-side checks)

### Cache preservation
- [ ] `expectedCacheFilenames()` in `server/index.ts` includes every question from instances where `locked === true`, in addition to the already-preserved `archive` instances
- [ ] After a game save that removes a question from a non-locked instance, `pruneUnusedCaches()` may delete its orphaned cache segments only if no archive or locked instance still references the same `(video, start, end, track)` tuple
- [ ] Deleting a reference video while a locked instance still lists it does not trigger cache pruning for that tuple

### Unlock precheck
- [ ] New endpoint `POST /api/backend/games/:name/instances/:instance/unlock-precheck`
- [ ] Server iterates the instance's questions, collects each referenced video path, and checks presence via the existing `resolveVideoPath()` (which covers both copies and reference symlinks)
- [ ] Response: `{ missing: string[], offlineReferences: string[] }`
  - `missing`: videos whose file is entirely absent (neither copy nor reference registry entry)
  - `offlineReferences`: videos present in the reference registry but whose symlink is dangling
- [ ] Before flipping `locked: false`, the client calls this endpoint:
  - If `missing ∪ offlineReferences` is empty: save directly
  - Otherwise: show a confirmation modal listing the affected files (German), with a "Trotzdem entsperren" button and a "Abbrechen" button
- [ ] Confirming the warning proceeds with a normal save; cancelling leaves the instance locked

### Runtime (gameshow playback)
- [ ] No changes needed for gameshow playback: the existing `strict=1` cache path already serves segment files without spawning ffmpeg, so locked instances play fine without the source reachable
- [ ] `cache-status` endpoint continues to report locked-instance caches as ready/missing the same way as archive/unlocked instances

## State / data changes

**Types (`src/types/config.ts`)**
- `VideoGuessConfig.locked?: boolean`

**Server (`server/index.ts`)**
- `expectedCacheFilenames()` extended: iterate instances including those with `locked === true` (same pattern currently used for `archive`)
- `PUT /api/backend/games/:name` save handler: compare new vs old instance content; if old had `locked === true`, any diff inside `questions[]` beyond the `locked` flag itself → `409 Locked`
- New route: `POST /api/backend/games/:name/instances/:instance/unlock-precheck`

**Frontend**
- `VideoGuessForm.tsx`:
  - New `isLocked` prop drilled through `QuestionBlock` and `VideoMarkerEditor`
  - Lock toggle at the instance header
  - Banner component (new subcomponent) when locked
  - Unlock-precheck modal (new subcomponent) shown before save
- `src/services/backendApi.ts`: `unlockPrecheck(gameName, instance)`

**Validation (`validate-config.ts`)**
- `VALID_GAME_TYPES` unchanged
- `locked` accepted as optional boolean on video-guess instances

## UI behaviour

**Lock toggle**
- Position: instance-header row, right of the language selector
- Locked: 🔒 in a filled orange pill; button label "Gesperrt" (German)
- Unlocked: 🔓 in a bordered grey pill; button label "Sperren" (German)
- Hover tooltip: "Sperrt Marker und Fragen. Cache bleibt erhalten." / "Entsperren und Bearbeiten freigeben."

**Locked banner**
- Full-width banner at the top of the instance questions list
- Background: orange tint (`rgba(251, 146, 60, 0.12)`), border-left 4px solid orange
- Text: "Diese Instanz ist gesperrt. Entsperren, um zu bearbeiten."

**Unlock-precheck modal**
- Title: "Nicht erreichbare Quelldateien"
- Body:
  > Folgende Dateien sind aktuell nicht erreichbar:
  > - [path 1]
  > - [path 2]
  > 
  > Nach dem Entsperren können Marker geändert werden. Wenn Caches dadurch invalidiert und keine Quelldateien erreichbar sind, fehlen sie im Spiel. Trotzdem entsperren?
- Buttons: `[Abbrechen]` · `[Trotzdem entsperren]`

## Out of scope
- Partial / per-question lock (whole instance only)
- Auto-locking based on time or cache completion
- Preventing question edits via direct game-file editing (server enforcement is the backstop; direct JSON edits bypass it intentionally — they're a power-user escape hatch)
- Locking non-video-guess game types (audio-guess, image-guess, etc.)

## Edge cases
- Moving a question from a locked instance to another instance: blocked by the `409 Locked` rule
- Moving a question *into* a locked instance: blocked by the same rule (the new content hash differs from the locked instance's old content)
- Archive and locked protections combine: a cache referenced by both archive and a locked instance is preserved once — no double-counting issues
- If `GAMESHOW_REFERENCE_ROOTS` is reconfigured while references exist, their presence check still works (uses absolute paths recorded at add-time, not via the roots list)
