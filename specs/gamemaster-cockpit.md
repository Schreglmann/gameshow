# Spec: Gamemaster Cockpit

## Goal
Turn the gamemaster view from a passive answer card into a live operator cockpit: recover from
mis-scores, hold the projector during interruptions, recall joker effects, and see platform health
at a glance. This spec is an umbrella; it is delivered in pieces, each independently shippable.

- **Piece 1 — Scoring Undo / Audit Log** ✅
- **Piece 2 — Panic / Pause Hold Overlay** ✅
- **Piece 3 — Joker Confirmation & History** ✅
- **Piece 4 — Readiness Traffic-Light** 🗂 planned
- **Piece 5 — Run-of-Show / Cue / Presenter Notes** 🗂 planned (optional)

---

## Piece 1 — Scoring Undo / Audit Log

### Goal
Every team-points mutation is recorded so the gamemaster can undo a mis-award with one tap instead
of mentally recomputing totals and re-awarding.

### Acceptance criteria
- [x] Every team-points delta is captured in a bounded audit log `TeamState.scoreHistory[]` — this
      includes positional awards (host picks a winner) AND inline-scored games (bet-quiz, quizjagd,
      final-quiz, wer-kennt-mehr count modes), because all of them funnel through the single
      `onAwardPoints` → `AWARD_POINTS` path.
- [x] All point writes funnel through one helper, `applyPointDelta`, in `GameContext.tsx`. No game
      writes team points by any other path. (Guarded by an inline-path regression test.)
- [x] Each entry records `{ id, team, delta, pointsAfter, ts, gameIndex? }`. `delta` is the
      clamp-adjusted value actually applied (so an undo restores exactly). Zero-delta awards are not
      logged.
- [x] The log is capped at 30 entries (oldest dropped) to bound localStorage growth.
- [x] `UNDO_SCORE_ENTRY { id }` removes that entry and applies its inverse delta (clamped at ≥0,
      like `AWARD_POINTS`). Removing a middle entry reverses only that delta.
- [x] `UNDO_LAST_SCORE` undoes the most recent entry.
- [x] The undo itself is NOT logged (no infinite stack).
- [x] The log rides the cached `gamemaster-team-state` channel as part of `TeamState`, so a GM on a
      different device sees it and can undo; the GM's undo mutates local team state, which
      re-broadcasts so the show converges.
- [x] `ScoreHistoryPanel` renders on the gamemaster view (collapsible, newest-first, last 5 shown),
      German labels ("Letzte Wertungen", "Rückgängig"); hidden when the log is empty.
- [x] **Visibility is context-gated** (it's clutter mid-play for normal games): the panel shows only on
      a game's **title (landing) screen**, OR **during** a game whose scoring changes points live
      (bet-quiz / quizjagd / final-quiz / wer-kennt-mehr — detected via the broadcast
      `hideCorrectTracker` flag, the existing "points already reflected inline" signal). It is hidden
      during the rules/answer screens, the award-points screen, normal-game play, and when no game is
      active. Gated in `GamemasterView` off `controlsData.phase` + `controlsData.hideCorrectTracker`.
- [x] `scoreHistory` is cleared by `RESET_POINTS` and `CLEAR_ALL`, persisted/restored by
      `SET_TEAM_STATE`, and included in the cold-start `hasData` gate + inbound WS normalizer.

### State / data changes
- New type `ScoreLogEntry` in `src/types/game.ts`; optional `scoreHistory?: ScoreLogEntry[]` on
  `TeamState` (optional so minimal literals don't break; reducer/normalizer always populate it).
- `GameContext.tsx`: `applyPointDelta` helper (sole point-write funnel + logger); `AWARD_POINTS`
  refactored to call it (passing `gameIndex` from `state.currentGame`); new actions
  `UNDO_LAST_SCORE` / `UNDO_SCORE_ENTRY`; localStorage key `scoreHistory` (read in `getInitialState`,
  persisted inside the reducer only).
- Persisted to localStorage: yes (`scoreHistory`, capped).
- WS contract: `gamemaster-team-state` payload (the `TeamState` schema) gains `scoreHistory`.

### UI behaviour
- Component: `src/components/common/ScoreHistoryPanel.tsx`, rendered by `GamemasterView` only when
  `phase === 'landing'` or (`phase === 'game'` and `hideCorrectTracker`).
- The host sees the most recent awards with team + signed delta + game label and a "Rückgängig"
  button per entry. Undo updates the score live on the projector (via the team-state broadcast).
- Edge cases: empty log → panel hidden; undoing a clamped award restores the pre-award total via the
  recorded clamp-adjusted delta; undo respects the ≥0 floor. wer-kennt-mehr in `standard` mode also
  sets `hideCorrectTracker`, so the panel is visible during its play even though that mode awards at
  the end — an accepted, harmless over-show (the alternative is threading the scoring mode through).

### Out of scope
- Redo. A reverted entry is removed, not re-appliable (re-award manually).
- Per-game grouping / full session ledger UI (the cap-30 tail is the live tool; the archive is a
  separate future feature).

---

## Piece 2 — Panic / Pause Hold Overlay ✅

### Acceptance criteria
- [x] A GM toolbar toggle ("Pause-Bildschirm" / "Pause beenden") drops a full-screen branded German
      hold ("Gleich geht's weiter") over the projector and lifts it on a second tap.
- [x] Driven by a new **cached, client-writable** WS channel `show-hold` (`{ active, message? }`) — the
      GM writes it, the show renders it. Cached so a projector reload mid-hold immediately re-receives it.
- [x] The overlay (`ShowHoldOverlay`, mounted in `frontend.tsx` `AppContent`) sits above ALL show
      content: z-index `100001`, above the fullscreen lightbox (`10000`), music controls (`99999`) and
      the inactive-show overlay (`9999`).
- [x] The GM toggle reflects the cached channel so its label stays correct across GM reloads.
- [x] **A running countdown freezes while the hold is active** and resumes when it lifts —
      `BaseGameWrapper` subscribes to `show-hold` and auto-pauses/resumes the deadline timer. See
      [gamemaster-deadline-timer.md](gamemaster-deadline-timer.md) for the pause/resume mechanics.

### State / data: `ShowHoldState` in `src/types/game.ts`; `show-hold` added to `WsChannel` (client +
server), `CLIENT_WRITABLE`, and `CACHED_CHANNELS` in `server/ws.ts`. No AppState. Contract: new
`show-hold` channel in `asyncapi.yaml` + inventory + `replace-frontend.md`/`replace-gamemaster.md`.

## Piece 3 — Joker Confirmation & History ✅

### Acceptance criteria
- [x] When a joker is turned ON (frontend or GM), the GM joker panel shows a transient confirmation
      card with the team name + joker name + its manual-resolution `description` (from `JOKER_CATALOG`),
      auto-clearing after ~7s.
- [x] Each team card shows a per-team used/remaining count (`used / enabled`).
- [x] Pure client render off already-synced `jokersUsed` + `settings.enabledJokers` — no new state or
      WS channel.

## Piece 4 — Readiness Traffic-Light (planned)
GM status strip: active-show connected (`show-presence`), GM presence (`gm-presence`), last
asset-failure (`assetFailed` on `gamemaster-controls`), NAS reachable (`nasMounted` read off the
existing `system-status` broadcast — a contract/zone note for `replace-gamemaster.md`).

## Piece 5 — Run-of-Show / Cue / Presenter Notes (planned, optional)
Run-of-show overview + jump-to-game, private next-clip cue, per-question presenter notes (`gmNote`).
