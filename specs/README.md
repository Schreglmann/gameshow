# Specs

This directory contains spec-driven development specifications for every feature in this gameshow app.

**Rule:** write or read the relevant spec before writing any code. See `AGENTS.md §3` for the full workflow.

---

## API contracts

Formal, machine-readable contracts for the backend's HTTP + WebSocket surface live under [`api/`](api/). These describe the contract every PWA (show / admin / gamemaster) consumes, and must be updated in the same commit as any route/channel change (see `AGENTS.md §2a`).

| File | What it covers |
|------|----------------|
| [`api/inventory.md`](api/inventory.md) | Human-readable catalog of every route + channel, grouped by zone |
| [`api/openapi.yaml`](api/openapi.yaml) | OpenAPI 3.1 for all HTTP routes (57 operations) |
| [`api/asyncapi.yaml`](api/asyncapi.yaml) | AsyncAPI 3.1 for all 16 WebSocket channels at `/api/ws` |
| [`api/README.md`](api/README.md) | How to validate, how to use, contract-first discipline |

Per-zone replacement guides live at [`../docs/replace-frontend.md`](../docs/replace-frontend.md), [`../docs/replace-admin.md`](../docs/replace-admin.md), [`../docs/replace-gamemaster.md`](../docs/replace-gamemaster.md).

---

## Index

### Core features

| Spec | File | Status |
|------|------|--------|
| App navigation flow | [app-navigation-flow.md](app-navigation-flow.md) | ✅ Implemented |
| Team management | [team-management.md](team-management.md) | ✅ Implemented |
| Point system | [point-system.md](point-system.md) | ✅ Implemented |
| Config system | [config-system.md](config-system.md) | ✅ Implemented |
| Config validation | [config-validation.md](config-validation.md) | ✅ Implemented |
| Config generation | [config-generation.md](config-generation.md) | ✅ Implemented |
| Base game wrapper | [base-game-wrapper.md](base-game-wrapper.md) | ✅ Implemented |
| Background music | [background-music.md](background-music.md) | ✅ Implemented |
| Admin screen | [admin-screen.md](admin-screen.md) | ✅ Implemented |
| Game planning | [game-planning.md](game-planning.md) | ✅ Implemented |
| Media encryption | [media-encryption.md](media-encryption.md) | ✅ Implemented |
| Keyboard navigation | [keyboard-navigation.md](keyboard-navigation.md) | ✅ Implemented |
| Header | [header.md](header.md) | ✅ Implemented |
| Lightbox | [lightbox.md](lightbox.md) | ✅ Implemented |
| Timer | [timer.md](timer.md) | ✅ Implemented |
| Audio normalization | [audio-normalization.md](audio-normalization.md) | ✅ Implemented |
| Audio trim (start/end time) | [audio-trim.md](audio-trim.md) | ✅ Implemented |
| Video DAM | [video-dam.md](video-dam.md) | 🗂 Planned |
| Video caching & preview mechanics | [video-caching.md](video-caching.md) | 🗂 Planned |
| Reference-only videos (external source files) | [video-references.md](video-references.md) | 🗂 Planned |
| Video-guess instance lock (offline gameshow support) | [video-guess-lock.md](video-guess-lock.md) | 🗂 Planned |
| Local-first assets + NAS sync | [nas-asset-mount.md](nas-asset-mount.md) | ✅ Implemented |
| Local-first asset storage (async NAS sync) | [local-transcode.md](local-transcode.md) | ✅ Implemented |
| Bidirectional asset sync | [sync-bidirectional.md](sync-bidirectional.md) | ✅ Implemented |
| Movie posters for video thumbnails | [movie-posters.md](movie-posters.md) | ✅ Implemented |
| YouTube audio download | [youtube-download.md](youtube-download.md) | ✅ Implemented |
| YouTube video download | [youtube-video-download.md](youtube-video-download.md) | ✅ Implemented |
| YouTube playlist audio download | [youtube-playlist-download.md](youtube-playlist-download.md) | 🗂 Planned |
| Game naming improvements | [game-naming.md](game-naming.md) | 🗂 Planned |
| Admin backend (games/assets/config CMS) | [admin-backend.md](admin-backend.md) | ✅ Implemented |
| DAM asset merge (deduplication) | [asset-merge.md](asset-merge.md) | 🗂 Planned |
| Admin system status dashboard | [admin-system-status.md](admin-system-status.md) | ✅ Implemented |
| Gamemaster remote controls | [gamemaster-controls.md](gamemaster-controls.md) | ✅ Implemented |
| Gamemaster correct-answers counters | [gamemaster-correct-answers.md](gamemaster-correct-answers.md) | ✅ Implemented |
| Cross-device gamemaster sync (WebSocket) | [cross-device-gamemaster.md](cross-device-gamemaster.md) | 🗂 Planned |
| Clean install (fresh clone without git-crypt key) | [clean-install.md](clean-install.md) | ✅ Implemented |
| Whisper transcription (per-video admin jobs, persistent across Node restarts) | [whisper-transcription.md](whisper-transcription.md) | ✅ Implemented |
| Harry Potter spells archive generator | [hp-spells-generation.md](hp-spells-generation.md) | ✅ Implemented |
| Theme system (colors, styles, fonts, accessibility) | [themes.md](themes.md) | ✅ Implemented |
| Jokers (per-team single-use, admin-configurable) | [jokers.md](jokers.md) | 🗂 Planned |
| Progressive Web Apps (3 installable surfaces) | [pwa.md](pwa.md) | 🗂 Planned |

### Game types

| Spec | File | Status |
|------|------|--------|
| Simple quiz | [games/simple-quiz.md](games/simple-quiz.md) | ✅ Implemented |
| Bet quiz (Einsatzquiz) | [games/bet-quiz.md](games/bet-quiz.md) | ✅ Implemented |
| Audio guess | [games/audio-guess.md](games/audio-guess.md) | ✅ Implemented |
| Guessing game | [games/guessing-game.md](games/guessing-game.md) | ✅ Implemented |
| Final quiz | [games/final-quiz.md](games/final-quiz.md) | ✅ Implemented |
| Q1 (find the false statement) | [games/q1.md](games/q1.md) | ✅ Implemented |
| Four statements (clue-based guess) | [games/four-statements.md](games/four-statements.md) | 🗂 Planned |
| Fact or fake | [games/fact-or-fake.md](games/fact-or-fake.md) | ✅ Implemented |
| Quizjagd | [games/quizjagd.md](games/quizjagd.md) | ✅ Implemented |
| Video guess | [games/video-guess.md](games/video-guess.md) | ✅ Implemented |
| Bandle | [games/bandle.md](games/bandle.md) | ✅ Implemented |
| Image guess | [games/image-guess.md](games/image-guess.md) | ✅ Implemented |
| Color guess | [games/colorguess.md](games/colorguess.md) | ✅ Implemented |

---

## How to write a new spec

1. Create `specs/<feature-slug>.md` (or `specs/games/<type>.md` for a new game type)
2. Use the template below
3. Add a row to the index above with status `Planned`
4. Get the spec reviewed before starting implementation
5. Tick off criteria as they are met
6. Update status to `✅ Implemented` when all criteria are met

### Spec template

```markdown
# Spec: <Feature Name>

## Goal
One sentence describing what this feature does and why.

## Acceptance criteria
- [ ] Criterion 1 (observable, testable behaviour)
- [ ] Criterion 2
- [ ] ...

## State / data changes
- New field in AppState: `myField: string`
- New API endpoint: `POST /api/something` → `{ result: string }`
- Persisted to localStorage: yes / no

## UI behaviour
- Screen / component affected: `SummaryScreen`
- What the user sees: ...
- Edge cases: ...

## Out of scope
- Things explicitly NOT included in this feature
```
