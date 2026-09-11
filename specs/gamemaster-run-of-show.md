# Spec: Gamemaster Run-of-Show (Ablauf sidebar + jump-to-game)

## Goal
Give the gamemaster a permanent list of the whole show — start page, global rules, every
game in order, summary — that marks where the show currently is and what comes next, and
lets the host jump to any entry behind a confirmation dialog.

This is **Piece 5** of [gamemaster-cockpit.md](gamemaster-cockpit.md), delivered without the
cue / presenter-notes half.

## Motivation
The gamemaster mirrors the *current* answer card and nothing else. It learns the running
game's title from `gamemaster-answer.gameTitle` and its position from
`gamemaster-controls.gameIndex` / `totalGames`, but never the ordered list of games —
`gameOrder` lives in `config.json` and, before this spec, was reachable only through admin
endpoints. So the host could not see what was coming, and could only move one step at a
time (`nav-forward` / `nav-back`). Recovering from "we need to skip game 4" or "let's go
back to the rules screen" meant stepping through every game in between.

## Acceptance criteria

### Data
- [ ] `GET /api/run-of-show` returns `{ games: RunOfShowEntry[] }` — one entry per
      `gameOrder` slot of the **active** gameshow, in order, each
      `{ index, gameId, title, type }`.
- [ ] A `gameOrder` ref that cannot be resolved (deleted game file, bad instance) still
      produces an entry, flagged `missing: true` with `type: null` and the raw ref as
      `title`. Indices therefore always match `gameOrder` positions.
- [ ] The route is public (show + gamemaster zone, no admin prefix) and is documented in
      `specs/api/openapi.yaml`, `specs/api/inventory.md` and `docs/replace-gamemaster.md`.

### Panel
- [ ] The gamemaster screen shows an **Ablauf** panel listing, in order: `Startseite`,
      `Regelwerk`, every game (numbered `1…n` with its title), `Zusammenfassung`.
- [ ] The `Regelwerk` row is omitted when the global rules screen has nothing to show
      (`hasGlobalRulesContent(settings)` is false) — that screen auto-forwards to game 0,
      so jumping to it is a dead jump.
- [ ] The row the show is currently on is highlighted and is **not** clickable.
- [ ] Rows before the current one are dimmed (already played).
- [ ] No "Jetzt" / "Danach" position markers: the highlight already says where the show is,
      and the next entry is simply the row below it. Only **"Fehlt"** remains, because a broken
      reference is not something position can convey.
- [ ] A `missing` game row is disabled and marked **"Fehlt"**.
- [ ] The current row is derived from the two channels the gamemaster already mirrors —
      `gamemaster-answer.screenLabel` for `Startseite` / `Globale Regeln` /
      `Zusammenfassung`, otherwise `gamemaster-controls.gameIndex`.
- [ ] The list re-fetches on the `content-changed` WebSocket channel (`config` or `games`),
      so editing `gameOrder` in the admin updates the panel live without a reload.

### Menu chrome, not content
- [ ] The panel is styled as a **toolbar group**, matching COUNTDOWN / SCROLLEN / MUSIK: a
      shared-recipe uppercase group label, then rows, with **no surrounding card box** in the
      gutter. A bordered panel there made the run-of-show read as main content.
- [ ] Rows are styled as siblings of the toolbar toggles (`.gm-lock-toggle` et al.), and
      explicitly reset the show's global `button` chrome — `--btn-text-transform`,
      `--btn-letter-spacing`, `--btn-font-weight`, the accent gradient and `--btn-glow`, plus
      the `:hover` lift/brightness and the `:disabled` grey gradient. Inheriting those is what
      made the list look like main content.
- [ ] The current row uses the toolbar's active-toggle idiom (tinted glass fill + matching
      border), not the show's accent gradient. Badges are quiet uppercase labels, not filled
      pills — a filled chip inside a chip-shaped row reads as a second button.

### Compact by default
- [ ] The always-visible gutter panel does **not** list the whole show. Collapsed, it shows a
      window of three entries — the **previous, current and next** — and **still scrolls**, so
      the rest of the running order is reachable without expanding.
- [ ] The window's height is **measured**, not a fixed pixel cap: rows vary in height (one- vs
      two-line titles), and a fixed cap always ended mid-row, leaving a half-clipped pill at the
      bottom edge. The component measures the three marked rows
      (`gm-runofshow-item--window`) plus one row gap of headroom above and below, publishes it
      as `--gm-runofshow-window-h`, and rests scrolled so the window sits inside that headroom.
      At rest exactly three whole rows are visible, with the inter-pill gap showing above and
      below so the box never stops flush against a pill edge.
- [ ] CSS consumes the measurement only in the collapsed gutter regime, so the layout regime
      stays a pure CSS concern — no `matchMedia` duplicate of the 1280px boundary. The drawer,
      which has no expand control, is uncapped and shows everything.
- [ ] With no known position, the window is the first three entries.
- [ ] The list sits in a bordered, subtly filled box — the same glass panel as the MUSIK
      group's player. Without it the rows floated loose in the strip.
- [ ] That box is a **wrapper** (`.gm-runofshow-listbox`), not the scrolling element. Padding on
      a scroll container is not empty space — content scrolls up through it, so a neighbouring
      pill intruded into the inset. Keeping the frame outside the scroller makes the visible
      region exactly the list.
- [ ] The rows carry no divider lines. `base.css` styles every `li` for the show's rules and
      answer lists (generous padding, `1.2em`, a bottom rule); all three are reset here.
- [ ] A control in the panel's **top right** expands the list to the full running order with no
      scrolling, and collapses it again. Shown only in the gutter regime, where the cap exists —
      the drawer already shows everything, mirroring how the close button is hidden in the gutter.
- [ ] The expanded/collapsed choice is remembered **per device** in `localStorage`
      (`gm-ablauf-expanded`), so a reload keeps it. Deliberately not synced: one gamemaster
      device wanting the long list says nothing about what another device wants. This is the
      documented device-local UI-flag exception (AGENTS.md §3), alongside the GM lock and
      answer-visibility flags.
- [ ] The cap is expressed as "cap unless expanded" (`:not(.gm-runofshow--expanded)`), so
      expanding needs no second rule to undo it.
- [ ] The list keeps the current entry **centred** in its own scroll box, and re-centres
      whenever the show moves. Implemented by setting `scrollTop` from `getBoundingClientRect()`
      deltas — never `scrollIntoView`, which would also scroll the page/drawer, and never
      `offsetTop`, which is measured against the nearest positioned ancestor (the whole
      gamemaster screen) and scrolls the list to its end.
- [ ] The drawer is an explicit browse surface, so there the list fills the panel height. It is
      still centred on the current entry when it opens.

### Touch
- [ ] Every row is at least **44px** tall, and the drawer's close button is a full 44px target.
      The confirm dialog's buttons are at least 44px tall.
- [ ] Interactive elements set `touch-action: manipulation` (no double-tap-zoom delay) and
      `-webkit-tap-highlight-color: transparent` (no grey tap flash).
- [ ] Row hover styling is behind `@media (hover: hover)`, so a tap does not leave a row stuck
      in its hover state — the existing convention for the GM toolbar toggles.
- [ ] The list and the drawer set `-webkit-overflow-scrolling: touch`, so a flick scrolls the
      list with momentum. In the **drawer** both also set `overscroll-behavior: contain`, so a
      flick never drags the page behind the overlay; in the **gutter** the list relaxes to
      `auto` (see Layout) — there the page is the outer scroller the menu belongs to, not a
      backdrop to be pinned.
- [ ] The "Ablauf" toolbar toggle keeps the toolbar cluster's shared
      `min-height: clamp(36px, 4vw, 44px)` rather than its own larger size — matching its four
      neighbours matters more than the extra 8px, and the button is full-width, so the target
      is easy to hit. Changing it means changing all five together.

### Layout
- [ ] At **≥1280px** the panel sits in the existing left gutter, directly below the toolbar,
      inside a shared `.gm-sidebar` container. The gutter is 272px wide, unchanged, and
      `.gamemaster-content` keeps its existing left margin.
- [x] In the gutter the sidebar sits **in flow**, as a grid column of `.gamemaster-screen` —
      it is not absolutely positioned and has **no scroll container of its own**. It therefore
      makes its grid row, and so the page, as tall as it is: with the running order expanded
      the menu is routinely taller than the answer card, and the whole of it stays reachable by
      scrolling the page.
- [x] A fixed-height app shell (`100dvh`, `overflow: hidden`, each column its own scroll pane)
      was built and **rejected** — it removed the iOS background bugs by construction, but the
      pane-scrolling feel was not wanted. The page scrolls as a document; the iOS painting is
      fixed at the theme layer instead, with the sticky backdrop in [themes.md](themes.md).
- [x] The gutter column is `calc(272px + inset - padding)` wide and the sidebar gives that
      difference back as a negative `margin-left`, so the strip keeps its 272px width at its
      original viewport inset while the content column begins exactly at the strip's right
      edge. The card is then centred by the grid alone (`justify-items: center`), reproducing
      the geometry the old `margin-left: inset + 272px` produced under the centering flex
      column — equal gaps either side, unchanged at every width ≥1280px.
- [x] History, so the shape is not undone: an absolute strip with a viewport height cap
      clipped the menu at the fold; giving it a page-tall internal scroller instead swallowed
      the wheel in a nested scroller whose own box reached below the fold, freezing the page;
      making it in-flow fixed both but made the page tall enough to trigger the iOS painting
      bugs. The shell is the resolution — inside it there is no page scroll to trap.
- [x] In the gutter the list sets `overscroll-behavior: auto`, so a wheel that reaches the end
      of the collapsed three-row window hands off to the page. The drawer keeps `contain`,
      where the page behind it must stay put.
- [x] Because an expanded running order can make the page ~1.7x the viewport, this panel is
      what first exposed the themes' iOS `background-attachment: fixed` bug — see the
      `@supports (-webkit-touch-callout: none)` rule in [themes.md](themes.md). Any future
      change that makes a zone markedly taller than the viewport depends on it holding.
- [ ] Below **1280px** the panel is an off-canvas drawer, opened by an **"Ablauf"** button in
      the toolbar's toggle group. The button is hidden at ≥1280px, where the panel is
      always visible.
- [ ] Below 1280px `.gm-sidebar` is `display: contents`, so the toolbar's existing inline
      layout is byte-for-byte unchanged.
- [ ] The drawer closes on its backdrop, on `Escape`, and after a confirmed jump.

### Jumping
- [ ] Clicking a non-current row opens a centered confirmation dialog naming the target
      ("Zu «Finale» springen?") and its consequence ("Das laufende Spiel wird verlassen und
      «Finale» startet von vorne. Bereits vergebene Punkte bleiben erhalten.").
- [ ] `Abbrechen` / `Escape` / a backdrop click closes the dialog and changes nothing.
- [ ] The dialog is rendered through a **React portal into `document.body`**, never in place.
      The panel is a fixed, transformed, overflow-scrolling container, and on iOS Safari such an
      ancestor becomes the containing block for a `position: fixed` descendant — the overlay was
      then sized and clipped to the sidebar, so on an iPad the menu greyed out and the dialog box
      never appeared. Guarded by a unit test asserting the overlay's parent is `document.body`.
- [ ] `Springen` / `Enter` sends one `gamemaster-command` and closes the dialog:
      `goto:home`, `goto:rules`, `goto:game-<index>` or `goto:summary`.
- [ ] The show navigates to the corresponding route. Only the **active** show reacts
      (`useGamemasterCommandListener` already drops commands on inactive tabs).
- [ ] Jumping to a game opens it at its title screen; the panel highlight follows within one
      WebSocket round-trip.
- [ ] **While the drawer or the dialog is open, the gamemaster's global click/keyboard
      navigation is suppressed** — a backdrop click or a `Space` press must not advance the
      show behind the overlay.

### Showcase + tests
- [ ] Represented in `ThemeShowcase` (`FrontendShowcase`) so every theme is verifiable at
      `/theme-showcase`: panel rows in all four states (played / current / next / missing)
      and the confirmation dialog, flattened per the existing convention.
- [ ] Unit-tested in `tests/unit/screens/GamemasterScreen.runOfShow.test.tsx`; e2e file
      `tests/e2e/gamemaster/gamemaster-run-of-show.spec.ts` exists.

## State / data changes
- New API endpoint: `GET /api/run-of-show` → `RunOfShowResponse`.
- New types in `src/types/config.ts`: `RunOfShowEntry`, `RunOfShowResponse`.
- New typed wrapper `fetchRunOfShow()` in `src/services/api.ts`.
- New `gamemaster-command` control ids: `goto:home`, `goto:rules`, `goto:game-<index>`,
  `goto:summary`. **No new WebSocket channel** — `gamemaster-command` already exists, is
  client-writable and ephemeral (never replayed on remount).
- No `AppState` change. No localStorage. The panel is a pure read of the server list plus
  the already-mirrored position channels; the drawer's open flag is component state.

## UI behaviour

**Components**
- `src/components/common/RunOfShowPanel.tsx` — the list, the row states, the jump dialog
  trigger. Rendered by `GamemasterScreen`, not by `GamemasterView`, so the admin's embedded
  `/admin#answers` iframe is unaffected.
- `src/components/common/GmConfirmDialog.tsx` — gamemaster-zone confirmation dialog.
  Deliberately **not** the admin `ConfirmModal`: its `ConfirmProvider` is mounted only in
  `src/entries/admin.tsx`, and its `.modal-overlay` / `.confirm-modal-*` classes live in
  `src/backend.css`, which the gamemaster bundle does not load. Behaviour is mirrored
  (`role="alertdialog"`, `aria-modal`, autofocused confirm button, `Enter` confirms,
  `Escape` cancels, backdrop click cancels) with `.gm-confirm-*` classes.
- `src/hooks/useShowNavigationCommands.ts` — the show-side listener, called once from
  `AppContent` in `src/entries/frontend.tsx`.

**Why the listener lives at app level.** A mounted `GameScreen` has no command listener (only
its `GameLoadError` fallback does), and `BaseGameWrapper` — which owns commands during play —
has only `onNextGame` / `onPrevGame` and cannot reach an arbitrary index. One listener in
`AppContent` handles every `goto:*` from any screen. Every other listener ignores unknown
`controlId`s, so nothing else changes.

**Same game twice in `gameOrder`.** `GameScreen` renders `<GameFactory key={…}>` and relies on
the key change to reset a game. Keying on `gameId` alone did not remount when two slots
reference the same ref, so the key is `` `${gameId}#${currentIndex}` ``. A live
`content-changed` refresh keeps the same index, so this adds no extra remounts.

**Edge cases**
- No active show connected: the panel still renders the list; no row is highlighted.
- Desynced mirror: the existing `gm-desync-banner` in `GamemasterView` already covers it;
  the panel simply follows whatever the channels say.
- Empty `gameOrder`: the panel shows `Startseite` / `Regelwerk` / `Zusammenfassung` only.
- The gamemaster's "Steuerung sperren" lock does **not** disable the panel — the lock exists
  to stop accidental *implicit* navigation (stray clicks/keys), and every jump here is
  already explicit and confirmed.

## Known limitations
Both are pre-existing consequences of re-entering a game, already true of the supported
one-step back-navigation:

- Jumping to the title screen of an already-played **self-scored** game and advancing fires
  `RESET_GAME_TALLY` (`BaseGameWrapper.tsx`), wiping `correctAnswersByGame[index]`.
  Back-navigation avoids this only because `resumeAtEnd` enters the game phase directly.
- With `jokerUsageScope: 'per-game'`, any index change refreshes all non-`comeback` jokers
  (`GameContext.tsx`, `SET_CURRENT_GAME`) — including a jump backwards.

Team points survive a jump and can be corrected with the existing "Letzte Wertungen" undo.

## Out of scope
- Resuming a jumped-to game mid-phase — a jump always opens the title screen, like
  [app-navigation-flow.md](app-navigation-flow.md).
- Reordering the game order from the gamemaster (that is the admin's Gameshows tab).
- Presenter notes / next-clip cue — the other half of cockpit Piece 5.
- Any automatic reconciliation of points or tallies for skipped or replayed games.
