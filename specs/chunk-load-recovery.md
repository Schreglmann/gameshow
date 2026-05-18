# Spec: Chunk-load recovery

## Goal

When the show / admin / gamemaster PWA tries to lazy-load a JS chunk that no
longer exists (typical post-deploy state: the bundle was rebuilt with new
hashes while the user's tab kept the old `index.html` loaded), recover
automatically so a live show doesn't get stuck on a blank screen.

## Symptom this addresses

1. User loads `/show/` — browser caches the active `index.html`.
2. Server is rebuilt; new hashed chunks (e.g. `FactOrFake-<hash>.js`) replace
   the old ones in `dist/client/show/assets/`.
3. User triggers a navigation that lazy-loads a game component.
4. The old `<hash>` is gone; the SPA fallback at `server/index.ts` used to
   send `index.html` for any `/show/*` request, so the browser got HTML with
   `Content-Type: text/html` for what it expected to be a script module →
   `TypeError: error loading dynamically imported module` → `<Suspense>`
   fallback renders `null` → blank screen, mid-show.

## Acceptance criteria

- [ ] A lazy import that fails is retried once after 500ms before the user
      sees any error state.
- [ ] If the retry also fails, the page reloads automatically once per tab
      session (guarded by `sessionStorage`) so the browser picks up the
      current `index.html` and the current hashed chunks.
- [ ] Once any lazy import succeeds, the reload guard is cleared so a later
      stale-chunk failure in the same tab can also recover.
- [ ] Game state (current game index, team rosters, team points, jokers,
      correct-answer log) survives the reload — all of it already lives in
      `localStorage` via `GameContext`.
- [ ] Missing asset URLs (anything with a file extension under
      `/show/...`, `/admin/...`, `/gamemaster/...`) return HTTP 404 instead
      of `index.html`. This makes the failure honest (the browser sees a
      genuine network error, not a MIME mismatch) and lets the client retry
      detect it cleanly.
- [ ] SPA route paths (no file extension) keep falling back to `index.html`
      as before — normal client-side routing is unchanged.

## State / data changes

- New per-tab flag: `sessionStorage["chunkLoadReloaded"]` — set immediately
  before `location.reload()`, cleared after the next successful lazy import.
- No `AppState` changes.
- No API changes.

## UI behaviour

- Happy path: invisible to the user; one network retry adds ~500ms only on
  failure.
- Stale-chunk path: the page reloads. The user briefly sees the show PWA
  boot (background colour) and lands back on the same game they were on —
  `currentGame.currentIndex` is restored from `localStorage`.
- Hard failure (chunk genuinely broken, even after reload): the rejected
  promise propagates; same blank screen as today. This is acceptable because
  it only happens when the build itself is broken, which is a developer
  problem, not a live-show problem.

## Out of scope

- Error-boundary UI with a manual reload button. The user chose silent
  auto-reload for the live-show case.
- Service-worker-driven update prompts.
- Versioning the chunk manifest (e.g. precomputed retries via a manifest
  endpoint).
