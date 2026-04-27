# End-to-end tests

One spec file per feature spec in [`specs/`](../../specs/). Organized by zone so a replacement PWA can reuse the same test file name to cover its equivalent surface.

## Layout

```
tests/e2e/
├─ _helpers/                   # shared Playwright helpers (team setup, WS mocks, ...)
├─ _skipped/                   # specs without UI-observable behavior (stubs point to unit test)
├─ frontend/                   # show PWA (`/`, `/rules`, `/game`, `/summary`)
│  └─ games/                   # one file per game type
├─ admin/                      # admin CMS PWA (`/admin`)
├─ gamemaster/                 # gamemaster PWA (`/gamemaster`)
├─ cross-zone/                 # multi-zone flows (show ↔ gamemaster, admin → show)
└─ contracts/                  # live-server contract sanity checks
```

## Conventions

- **One `describe` per feature spec.** The describe title matches the spec's title from [`specs/README.md`](../../specs/README.md). One `test` per acceptance criterion.
- **Responsive checks** use `test.use({ viewport })` — at least default desktop plus one mobile breakpoint (375×812) for any spec flagged responsive in the project CLAUDE rules.
- **Server fixtures**: Playwright's `webServer` block in [`playwright.config.ts`](../../playwright.config.ts) boots `npm run dev` automatically. Tests assume a clean-ish state — use the shared helpers in `_helpers/` to set baseline team state, localStorage keys, and WS state before assertions.
- **External integrations** (YouTube, Whisper, NAS) are mocked at the fetch/subprocess boundary. Where that's not tractable (ffmpeg segment encode), use a tiny pre-encoded fixture video.
- **`test.fixme(...)`** marks acceptance criteria that are known gaps — the test file exists (so a future grep for the feature's e2e coverage always finds something) but the body is a fixme'd placeholder.

## Running

```bash
# Full suite
npm run test:e2e

# Just one zone
npx playwright test tests/e2e/frontend

# One feature
npx playwright test tests/e2e/frontend/app-navigation-flow.spec.ts

# UI mode for writing new tests
npx playwright test --ui
```

## When you add a feature spec

Every spec in `specs/` MUST have a sibling e2e file here with the same slug. If the spec is not observable via the UI, add a stub under `_skipped/` pointing at the unit test that covers it — never leave silent gaps.
