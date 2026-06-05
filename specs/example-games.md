# Spec: Example Games ("Beispiele")

## Goal
Replace the static `games/_template-*.json` files and `config.template.json` with **code fixtures** that generate a set of real, playable **example games** — one per game type — on demand, so a fresh or key-less clone can showcase every game type with real questions and self-synthesized, copyright-free media. Triggered from the admin "Spiele" tab (button) or the CLI (`npm run fixtures`).

## Acceptance criteria
- [ ] `games/_template-*.json` and `config.template.json` are deleted; no code path depends on them.
- [ ] `server/example-games.ts` exports `EXAMPLE_GAMES` — one entry per game type **except `video-guess`** (13 entries), each a single-instance `GameConfig` with a few real German questions and canonical `rules`/`rulesPreset`.
- [ ] Every `EXAMPLE_GAMES` entry passes `validate-config.ts`'s per-type rules.
- [ ] `materializeExamples({ gamesDir, localAssetsBase, configPath })` generates each game's media into a dedicated `Beispiele/` subfolder per category (`local-assets/audio/Beispiele/`, `local-assets/images/Beispiele/`) so the DAM groups them in one tidy folder, writes `games/beispiel-<type>.json` (atomic, trailing `\n`), adds/replaces the `beispiele` gameshow `{ name: "Beispiele", gameOrder: [...13] }` in config, sets it active, and returns `{ createdGames, gameshow }`.
- [ ] The `beispiele` `gameOrder` places **final-style game types last** — `bet-quiz`, `quizjagd`, `final-quiz` (the set `FINAL_GAME_TYPES`) appear at the end, after all other types, so the demo gameshow reads like a real show (a finale never sits in the middle). Relative order within each group follows the `EXAMPLE_GAMES` definition order.
- [ ] `POST /api/backend/games/examples` runs `materializeExamples` against the live paths and returns `{ success: true, createdGames, gameshow }`.
- [ ] `npm run fixtures` runs the same `materializeExamples` from the CLI.
- [ ] The admin "Spiele" tab shows a **"Beispiele erstellen"** button when the games list is empty (covers fresh install and encrypted clone — encrypted games are skipped from the listing). Pressing it calls the endpoint, shows a brief loading state, then reloads the games list + settings so the new active gameshow appears.
- [ ] All media is **synthesized locally** (no downloads) and **nothing binary is committed**: images via `sharp`, audio via an in-code synth → `ffmpeg`. Generated media lives only in the gitignored `local-assets/`; generated games are gitignored `games/beispiel-*.json`.
- [ ] Audio examples are public-domain classical compositions (e.g. *Für Elise*, *Ode an die Freude*) rendered by us — composition is PD, performance is original → fully copyright-free.

## State / data changes
- **New files**: `server/example-games.ts` (`EXAMPLE_GAMES` + `materializeExamples`), `server/example-media.ts` (sharp/ffmpeg generators), `scripts/create-examples.ts` (CLI).
- **New endpoint**: `POST /api/backend/games/examples` → `{ success: true, createdGames: string[], gameshow: string }`.
- **New npm script**: `"fixtures": "tsx scripts/create-examples.ts"`.
- **New client fn**: `createExampleGames()` in `src/services/backendApi.ts`.
- **Config**: `buildDefaultConfig()` (server/clean-install.ts) returns a config with a single empty `beispiele` gameshow (active) — no template scanning. `buildDefaultGameOrder` and `configReferencesOnlyTemplates` are removed.
- **`.gitignore`**: add `games/beispiel-*.json`.
- **`.gitattributes`**: remove the `games/_template-*.json -filter -diff` exception.
- Persisted to disk: yes (game files, media, config) — all in gitignored locations.

## Server behaviour
- `materializeExamples` is the single shared entry point for the endpoint and the CLI. It is idempotent: re-running regenerates media and overwrites `beispiel-*.json` + the `beispiele` gameshow.
- Media generation: ~7 audio clips + ~8 images, ≲1.5 s total (benchmarked: ffmpeg ~60–100 ms/clip, sharp tens of ms/image). Uses `ffmpeg-static` + `sharp` (already deps).
- `colorguess` images: colors are auto-extracted server-side from the generated image on first read (existing `color-profile.ts` flow) — the fixtures author no `colors` field.

## Media inventory (self-generated, public-domain content)
- **Images** (`sharp`, drawn from SVG): recognizable single-subject scene illustrations (Apfel / Haus / Segelboot) for `image-guess` (+ `obfuscation` showcase) — flat flag designs don't suit blur/pixelate/zoom, scenes with real spatial structure do; national flags (flag designs are not copyrightable) for `simple-quiz` `questionImage`; distinctive-palette images (flag colors / gradients) for `colorguess`.
- **Audio** (in-code synth → MP3): PD classical melodies for `audio-guess` (one with `audioStart`/`audioEnd` clip) and `simple-quiz` `questionAudio`; layered voicings of one PD piece for `bandle` `tracks[]` (sparse → full).

## UI behaviour
- **Component**: `src/components/backend/GamesTab.tsx` empty state.
- **What the user sees**: "Keine Spiele gefunden" + a primary **"Beispiele erstellen"** button (loading state while generating). On success: a toast, the games list populated with 13 `beispiel-*` games, and the "Beispiele" gameshow active.
- **Theme showcase**: the empty-state-with-button is added to `AdminShowcase` in `ThemeShowcase.tsx`.
- **Edge cases**: button only renders when the list is empty; the endpoint is safe to re-run (idempotent); on a clone with the git-crypt key + real games the list is non-empty so the button never appears.

## Out of scope
- A `video-guess` example (no guessable video can be synthesized cleanly; documented gap).
- Committing any media or generated game files to git.
- Replacing the admin "+ Neues Spiel" blank-scaffold flow (`GAME_TYPE_TEMPLATES` stays as-is).
- A first-run wizard beyond the single button.
