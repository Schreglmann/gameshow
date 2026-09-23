# Spec: Show title (custom landing-page text)

## Goal

Let the operator replace the hardcoded `Game Show` heading on the landing page
with the show's own name — a global default in the admin **Konfiguration** tab,
optionally overridden per gameshow in the **Gameshows** tab — so the same
installation can run "Sommerfest Quiz 2026" one night and "Weihnachtsshow" the
next without a code change.

## Resolution order

The title is resolved in exactly ONE place — `resolveShowTitle()` in
[src/utils/showTitle.ts](../src/utils/showTitle.ts), called server-side by
`GET /api/settings`:

1. the active gameshow's `GameshowConfig.showTitle`, if non-blank
2. the global `AppConfig.showTitle`, if non-blank
3. `DEFAULT_SHOW_TITLE` — `"Game Show"`

Blank/whitespace-only counts as unset at both levels, so clearing a field falls
through to the next one instead of rendering an empty heading. Values are stored
raw and trimmed only on resolution.

The frontend never re-derives the order: it reads the single resolved
`GlobalSettings.showTitle` string. As the title is served by `/api/settings`, a
change reaches the running show through the existing `content-changed` re-fetch
(see [live-config-reload.md](live-config-reload.md)) — no reload.

## State / data changes

- `AppConfig.showTitle?: string` — global default (admin ConfigTab).
- `GameshowConfig.showTitle?: string` — per-gameshow override (admin GameshowEditor).
- `SettingsResponse.showTitle?: string` — resolved value on the wire (optional so
  existing fixtures need not provide it).
- `GlobalSettings.showTitle: string` — always a non-empty string after
  `normalizeShowTitle()`; `getInitialState` seeds `DEFAULT_SHOW_TITLE`.
- Persisted to localStorage: no, with one exception — `show:title` caches the last
  resolved title so `emitCachedGamemasterState()` (which runs before React mounts
  and before settings load) can send the right `gameTitle` on a show reload
  instead of flashing `Game Show` on the gamemaster. Derived, device-local, and
  written from the settings-load path in `GameContext`, not from a component.
  Written on **show tabs only** (`isShowTab()`): no other zone emits that state,
  and the admin's localStorage viewer would otherwise list a key it never uses.
- No `AppState` action changes: the value rides along in the existing
  `SET_SETTINGS` payload.

## UI behaviour

- **HomeScreen** — the `<h1>` renders `state.settings.showTitle`.
- **Gamemaster** — the `gameTitle` broadcast from `HomeScreen` and
  `SummaryScreen` uses the resolved title (each screen keeps its own
  `screenLabel`). `emitCachedGamemasterState()` uses it for its `/show/` and
  `/show/game` fallbacks, read from the `show:title` cache; `/show/rules` and
  `/show/summary` keep their fixed labels ("Regelwerk" / "Gesamtergebnis").
- **Browser tab** — `document.title` is set from the resolved title once settings
  load (the static `<title>Game Show</title>` in `show/index.html` stays as the
  pre-hydration value). The admin and gamemaster PWAs keep their own titles.
- **Admin Konfiguration** — a "Titel der Show" text input in the "Globale
  Einstellungen" card, with a hint that a blank field means `Game Show` and that a
  gameshow can override it.
- **Admin Gameshows** — a "Titel" input on its own row in each gameshow card,
  above the Teams/Punkte/Spieler row so a long title never squeezes it. Its
  placeholder shows the inherited value (global title, else the default); an
  empty field is stored as absent so untouched gameshows keep a clean
  `config.json`.
- Edge cases: a blank or whitespace-only value at either level falls through; no
  length limit is enforced (the `<h1>` is already fluid via `clamp()`).

## Validation

`validate-config.ts` rejects a non-string `showTitle` at both levels (error), and
warns on a whitespace-only value (it silently falls back).

## Acceptance criteria

- [x] `resolveShowTitle()` picks gameshow → global → `Game Show`, treating blank as unset
- [x] `GET /api/settings` serves the resolved `showTitle`
- [x] The HomeScreen `<h1>` shows the resolved title
- [x] The gamemaster card shows the resolved title on Startseite and Zusammenfassung
- [x] `document.title` follows the resolved title on the show PWA
- [x] Editing the global field in the admin Konfiguration tab changes the landing page
- [x] Editing a gameshow's field overrides the global one for that gameshow only
- [x] Clearing the gameshow field falls back to the global one; clearing both shows `Game Show`
- [x] A live edit reaches a running show without a reload (`content-changed` re-fetch)
- [x] `validate-config.ts` errors on a non-string `showTitle`, warns on a blank one
- [x] `specs/api/openapi.yaml` documents the new `AppConfig`, `GameshowConfig`, and
      `SettingsResponse` fields

## Out of scope

- Per-game title overrides (a game's own `title` is unrelated).
- Subtitles, logos, or images on the landing page.
- Rewriting the static `<title>` in `show/index.html` at build time.
- Changing the admin/gamemaster PWA names or manifests.
