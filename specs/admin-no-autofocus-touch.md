# Spec: No autofocus of admin search inputs on touch devices

## Goal
Stop admin search inputs from auto-focusing on touch devices (phones, iPads), so the on-screen keyboard does not pop up unprompted and cover the screen. On desktop (mouse/trackpad) the existing autofocus is kept.

## Acceptance criteria
- [ ] A shared helper `isTouchDevice()` (in `src/utils/isTouchDevice.ts`) reports whether the primary pointer is touch (`(pointer: coarse)`), with a `navigator.maxTouchPoints` fallback.
- [ ] On a touch device, none of the admin **search** inputs grab focus on mount.
- [ ] On a non-touch device, all those search inputs still autofocus exactly as before.
- [ ] Inputs that are focused only after an explicit user action (rename dialogs, "new game" name, URL-download fields, move-target combobox) are left unchanged — the keyboard there is wanted.
- [ ] `isTouchDevice()` returns `false` in the jsdom test environment (no `matchMedia`, `maxTouchPoints === 0`), so existing tests that rely on autofocus keep passing.

## State / data changes
- No AppState, API, or localStorage changes. Pure client-side, render-time check.

## UI behaviour
- Components affected (search inputs only):
  - `src/components/backend/AssetsTab.tsx` — file/asset search row
  - `src/components/backend/GamesTab.tsx` — game search
  - `src/components/backend/ImageSearchPanel.tsx` — image search
  - `src/components/backend/AssetPicker.tsx` — asset picker search
  - `src/components/backend/ReferenceBrowser.tsx` — video-source filter (both the `autoFocus` prop and the re-focus-on-folder-load `useEffect`)
  - `src/components/backend/GameshowEditor.tsx` — game-list filter in the planning overview
- What the user sees: on desktop, the search input is focused and ready to type (unchanged). On phone/iPad, the input is not focused and the keyboard stays closed until the user taps it.

## Out of scope
- Non-search inputs (rename, create-game, URL download, move/bulk-move combobox) — they autofocus after an explicit tap, where the keyboard is expected, and are intentionally left as-is.
- Frontend (show) and gamemaster PWAs — only the admin is in scope.
