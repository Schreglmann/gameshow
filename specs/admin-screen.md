# Spec: Admin Screen

## Goal
The host has an out-of-band screen to inspect and manually correct team names, points, and raw localStorage data at any point during the gameshow without disrupting the game flow.

## Acceptance criteria
- [x] Accessible at `/admin` at any time; does not affect the linear game flow
- [x] Displays current team 1 and team 2 member lists as editable comma-separated text fields
- [x] Displays current point totals for both teams as editable numeric fields
- [x] Changes saved on this screen dispatch `SET_TEAM_STATE` (which persists to localStorage via the reducer)
- [x] State is synced from `GameContext` **continuously, not just on mount** — never read directly from localStorage. Each field shows the live value from context unless the operator is currently editing that field (uncommitted keystrokes live in an `edits` map; a field with no pending edit always renders context). Points awarded elsewhere therefore appear here while the tab stays open.
- [x] A save merges the pending edits onto the **current** `state.teams`, overriding only the fields actually edited; a blur that changed nothing dispatches nothing and shows no "Gespeichert" toast
- [x] "Reset points" button resets both teams to 0 — requires a single confirmation click
- [x] "Clear all data" button removes all localStorage keys and reloads the page — requires two separate confirmation clicks (double confirmation). `teamStateRev` is the one key deliberately preserved — see [cross-device-gamemaster.md](cross-device-gamemaster.md)
- [x] Raw localStorage key/value pairs are displayed for debugging
- [x] No authentication required (the app is run on a local network for live events)

## State / data changes
- Dispatches `SET_TEAM_STATE` action to update teams + points in one operation. The
  payload is built by spreading the latest `state.teams`, so fields the operator did
  not touch keep their live values. Rebuilding all six fields from component state
  instead is what made a blur publish a mount-time snapshot and revert live awards on
  every device — the failure this screen caused in a live show.
- `SET_TEAM_STATE` from here is a LOCAL edit: it authors a new `TeamState.rev`
  (`remote` flag unset), so it outranks the value it replaces. See
  [cross-device-gamemaster.md](cross-device-gamemaster.md).
- `RESET_POINTS` action for points-only reset
- Direct `localStorage.clear()` for full data wipe (only place outside reducer where localStorage is touched — acceptable for a destructive admin operation)

## UI behaviour
- Route: `/admin`
- Layout: two team columns side by side; reset/clear buttons at bottom
- Confirmation state is local component state (not in GameContext)
- "Are you sure?" → second click executes for clear-all
- Raw localStorage section is collapsed/expandable

## Out of scope
- Password protection or access control
- Undo for point changes
- Viewing game history or round results
