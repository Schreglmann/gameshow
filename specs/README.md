# Specs

This directory contains spec-driven development specifications for every feature in this gameshow app.

**Rule:** write or read the relevant spec before writing any code. See `AGENTS.md §3` for the full workflow.

---

## API contracts

Formal, machine-readable contracts for the backend's HTTP + WebSocket surface live under [`api/`](api/). These describe the contract every PWA (show / admin / gamemaster) consumes, and must be updated in the same commit as any route/channel change (see `AGENTS.md §2a`).

| File | What it covers |
|------|----------------|
| [`api/inventory.md`](api/inventory.md) | Human-readable catalog of every route + channel, grouped by zone |
| [`api/openapi.yaml`](api/openapi.yaml) | OpenAPI 3.1 for all HTTP routes (58 operations) |
| [`api/asyncapi.yaml`](api/asyncapi.yaml) | AsyncAPI 3.1 for all 17 WebSocket channels at `/api/ws` |
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
| gameOrder cascade-cleanup on game/instance delete | [config-gameorder-cascade.md](config-gameorder-cascade.md) | ✅ Implemented |
| Live config/games/theme reload (no page refresh) | [live-config-reload.md](live-config-reload.md) | ✅ Implemented |
| Base game wrapper | [base-game-wrapper.md](base-game-wrapper.md) | ✅ Implemented |
| Background music | [background-music.md](background-music.md) | ✅ Implemented |
| Admin screen | [admin-screen.md](admin-screen.md) | ✅ Implemented |
| No autofocus of admin search inputs on touch devices | [admin-no-autofocus-touch.md](admin-no-autofocus-touch.md) | ✅ Implemented |
| Game planning | [game-planning.md](game-planning.md) | ✅ Implemented |
| Player stats (games-played history) | [player-stats.md](player-stats.md) | ✅ Implemented |
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
| NAS backup retention | [nas-backup.md](nas-backup.md) | ✅ Implemented |
| Local-first asset storage (async NAS sync) | [local-transcode.md](local-transcode.md) | ✅ Implemented |
| Bidirectional asset sync | [sync-bidirectional.md](sync-bidirectional.md) | ✅ Implemented |
| Server startup scheduling (responsive first paint, deferred NAS maintenance) | [server-startup.md](server-startup.md) | ✅ Implemented |
| Movie posters for video thumbnails | [movie-posters.md](movie-posters.md) | ✅ Implemented |
| YouTube audio download | [youtube-download.md](youtube-download.md) | ✅ Implemented |
| YouTube video download | [youtube-video-download.md](youtube-video-download.md) | ✅ Implemented |
| YouTube playlist audio download | [youtube-playlist-download.md](youtube-playlist-download.md) | 🗂 Planned |
| YouTube search (DAM keyword search + download) | [youtube-search.md](youtube-search.md) | ✅ Implemented |
| Game naming improvements | [game-naming.md](game-naming.md) | 🗂 Planned |
| Admin backend (games/assets/config CMS) | [admin-backend.md](admin-backend.md) | ✅ Implemented |
| Admin Gameshows tab (split from Config, collapsible cards) | [admin-gameshows-tab.md](admin-gameshows-tab.md) | ✅ Implemented |
| DAM asset merge (deduplication) | [asset-merge.md](asset-merge.md) | 🗂 Planned |
| Audio cover override + source labels + propagation | [audio-cover-override.md](audio-cover-override.md) | 🗂 Planned |
| Admin system status dashboard | [admin-system-status.md](admin-system-status.md) | ✅ Implemented |
| Gamemaster remote controls | [gamemaster-controls.md](gamemaster-controls.md) | ✅ Implemented |
| Gamemaster correct-answers counters | [gamemaster-correct-answers.md](gamemaster-correct-answers.md) | ✅ Implemented |
| Gamemaster next-answer preview | [gamemaster-next-answer.md](gamemaster-next-answer.md) | ✅ Implemented |
| Gamemaster show-scroll controls | [gamemaster-scroll.md](gamemaster-scroll.md) | ✅ Implemented |
| Cross-device gamemaster sync (WebSocket) | [cross-device-gamemaster.md](cross-device-gamemaster.md) | 🗂 Planned |
| Clean install (fresh clone without git-crypt key) | [clean-install.md](clean-install.md) | ✅ Implemented |
| Example games ("Beispiele") — code fixtures + synthesized media | [example-games.md](example-games.md) | ✅ Implemented |
| Whisper transcription (per-video admin jobs, persistent across Node restarts) | [whisper-transcription.md](whisper-transcription.md) | ✅ Implemented |
| Harry Potter spells archive generator | [hp-spells-generation.md](hp-spells-generation.md) | ✅ Implemented |
| Theme system (colors, styles, fonts, accessibility) | [themes.md](themes.md) | ✅ Implemented |
| Jokers (per-team single-use, admin-configurable) | [jokers.md](jokers.md) | 🗂 Planned |
| Progressive Web Apps (3 installable surfaces) | [pwa.md](pwa.md) | 🗂 Planned |
| Rules phrasing standard (canonical library) | [rules-standard.md](rules-standard.md) | ✅ Implemented |
| Rules presets (per-game references to shared rule sets) | [rules-presets.md](rules-presets.md) | 🗂 Planned |
| Asset resilience (retry, preload, decoder cleanup) | [asset-resilience.md](asset-resilience.md) | ✅ Implemented |
| Chunk-load recovery (lazy-import retry + reload after stale-build) | [chunk-load-recovery.md](chunk-load-recovery.md) | ✅ Implemented |
| Server-side asset-serving priority (file serving pre-empts background ffmpeg) | [server-asset-priority.md](server-asset-priority.md) | ✅ Implemented |
| DAM image AI-upscale (local Real-ESRGAN, Mac + Linux) | [dam-image-upscale.md](dam-image-upscale.md) | 🗂 Planned |
| Spelling & grammar check ("Lektorat", LanguageTool, global toggle) | [spellcheck.md](spellcheck.md) | ✅ Implemented |
| Admin-managed local LanguageTool (Docker start/stop from the Korrektur tab) | [languagetool-docker.md](languagetool-docker.md) | ✅ Implemented |

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
| Ranking (ordered-answer guess) | [games/ranking.md](games/ranking.md) | ✅ Implemented |
| Wer kennt mehr? (name-more duel) | [games/wer-kennt-mehr.md](games/wer-kennt-mehr.md) | ✅ Implemented |
| Cover oder Original (uses simple-quiz) | [games/cover-oder-original.md](games/cover-oder-original.md) | ✅ Implemented |
| Random frame (guess the movie from a random video still) | [games/random-frame.md](games/random-frame.md) | ✅ Implemented |

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
