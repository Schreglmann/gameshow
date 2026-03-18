# GitHub Copilot Instructions

This is an AI-generated gameshow web app built with React 19, React Router 7, Express, TypeScript, and Vite.

## Before writing any code

1. Read [`agents.md`](../agents.md) — project orientation, architecture, and development conventions
2. Find and read the relevant spec in [`specs/`](../specs/) — it defines what the feature must do and its acceptance criteria
3. Follow the **spec-driven development** workflow described in `agents.md §3`:
   - Write or locate the spec first
   - Tick off acceptance criteria as you implement them
   - Verify all criteria are met before closing the feature

## Key files to keep open

| File | Why |
|------|-----|
| `src/types/config.ts` | All TypeScript types — the authoritative source |
| `src/context/GameContext.tsx` | All app state (`AppState`, `Action` union, `reducer`) |
| `agents.md` | Architecture, conventions, anti-patterns |
| `specs/<relevant-feature>.md` | Acceptance criteria for the current task |

## Most important rules

- All game config types live in `src/types/config.ts` — never create a parallel type file
- All state mutations go through `dispatch()` — never write directly to `localStorage` from a component
- Every game component must be wrapped in `<BaseGameWrapper>`
- UI text is in **German** — no English strings in player-facing UI
- Run `npm run validate` after any change to a game file or `config.json`
- Point values are always `currentIndex + 1` — never hardcoded

## Specs index

See [`specs/README.md`](../specs/README.md) for the full list of feature specs.
