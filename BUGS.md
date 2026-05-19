# Frontend Test Sweep — Findings

_Generated: 2026-05-18 · Test config: `test-all` (87 games, 14 game types)_
_Methodology: see [plan file](/Users/georg-vivid/.claude/plans/currently-in-the-frontend-cryptic-whisper.md)_
_Screenshots: [pass-a/](pass-a/) (87 smoke), [pass-b/](pass-b/) (14 deep walks), [pass-c/](pass-c/) (9 themes × breakpoints)_

Severity tiers: **blocker** · **major** · **minor** · **cosmetic** · **info**

---

## Summary

| # | Severity | Title |
|---|----------|-------|
| 1 | **blocker** | 6 gameshow entries return 404 — `<game>/archive` rejected by server |
| 2 | **blocker** | Failed game load has no skip-forward affordance — gameshow is unrecoverable on the affected indices |
| 3 | **major** | 4 game titles are English (German-only rule) |
| 4 | **major** | Spelling: "Zaubersprücher" → "Zaubersprüche" |
| 5 | **major** | Q1 / four-statements / final-quiz / colorguess answer view overflows 1280×800 viewport |
| 6 | **major** | Bet-quiz + final-quiz unplayable as a first game (teams have 0 points, all bets rejected) |
| 7 | **minor** | Missing `/show/favicon.svg` — 404 on every page load |
| 8 | **minor** | FinalQuiz bet-input placeholder truncated ("Gesetzte Punkte Tea") |
| 9 | **minor** | "FAKE" / "FAKT" labels are loan-words; verify with the rules-standard library |
| 10 | **cosmetic** | Wer-ist-das (HP) lacks per-game theme — Critical Role gets `dnd`, HP doesn't |
| 11 | **cosmetic** | Content under-uses 1920px screens — game cards have a max-width that leaves wide gutters |
| 12 | **info** | Home page warns of 2 missing video caches (`hp-zauberspruecher · Clip 64 + 65`) |

---

## Findings

### [blocker] 1. 6 gameshow entries return 404 — `<game>/archive` rejected by server

**Where:** [config.json](config.json) → `gameshows["test-all"].gameOrder` indices 9, 13, 42, 63, 77, 80
**Symptom:** API returns `{"error":"Instance \"archive\" in \"X\" is reserved for archived questions and cannot be used in gameOrder"}` with HTTP 404 for:
- `bridgerton-soundtrack/archive`
- `colorguess/archive`
- `kennzeichen/archive`
- `q1-ein-hinweis-ist-falsch/archive`
- `was-war-vorher/archive`
- `wer-ist-das-critical-role-edition/archive`

The gameshow surfaces these as `"Spiel N konnte nicht geladen werden"` error cards.

**Repro:**
```
curl http://localhost:3000/api/game/9   # → 404
```
or visit [`/show/game?index=9`](pass-a/game-09-bridgerton-archive-BROKEN.png).

**Suspected cause:** [server/index.ts:2858-2859](server/index.ts#L2858-L2859) — when a game file has a non-empty non-archive instance, `archive` cannot be selected from `gameOrder`. The 6 broken games all reference `<key>/archive` even though their files have a populated default/v1 instance.

**Suggested fix:** Either remove these 6 entries from `gameshows.test-all.gameOrder`, or change the keys to a real instance like `<key>/v1`. Run `npm run validate` after — the validator at [validate-config.ts:82](validate-config.ts#L82) would have caught this had the gameshow been validated.

---

### [blocker] 2. Failed game load has no skip-forward affordance

**Where:** every game that fails to load (the 6 from #1)
**Symptom:** The error card shows only the text `"Spiel N konnte nicht geladen werden"`. There's no "skip to next game" button, no error-recovery UI. The gameshow flow is dead-ended.
**Evidence:** [pass-a/game-09-bridgerton-archive-BROKEN.png](pass-a/game-09-bridgerton-archive-BROKEN.png)

ArrowRight does nothing because BaseGameWrapper never mounts when the API request fails.

**Suggested fix:** On 404 from `/api/game/:index`, render a recoverable error card with a "Spiel überspringen →" button that navigates to `index + 1`.

---

### [major] 3. 4 game titles are English (German-only rule)

[AGENTS.md §7](AGENTS.md) requires German-only player-facing text. These 4 titles violate it:

| Game | File | Current title | Suggested German |
|------|------|---------------|-------------------|
| `audio-guess/v1` | [games/audio-guess.json:3](games/audio-guess.json#L3) | "Audio Guess" | "Audio Quiz" / "Höre genau hin!" |
| `fact-or-fake/v1` | [games/fact-or-fake.json:3](games/fact-or-fake.json#L3) | "Fact or Fake" | "Wahrheit oder Lüge" / "Fakt oder Fake" |
| `ratespiel/v1` | [games/ratespiel.json:3](games/ratespiel.json#L3) | "Guessing Game" | "Schätzspiel" / "Ratespiel" |
| `final-quiz/v1` | [games/final-quiz.json:3](games/final-quiz.json#L3) | "Final Quiz" | "Finalrunde" / "Schlussrunde" |

**Evidence:**
- [pass-a/game-05-audio-guess-v1.png](pass-a/game-05-audio-guess-v1.png)
- [pass-a/game-21-fact-or-fake.png](pass-a/game-21-fact-or-fake.png)
- [pass-a/game-66-ratespiel.png](pass-a/game-66-ratespiel.png)
- [pass-a/game-28-final-quiz.png](pass-a/game-28-final-quiz.png)

---

### [major] 4. Spelling: "Zaubersprücher" → "Zaubersprüche"

**Where:** [games/harry-potter-zauberspruecher-erraten.json:3](games/harry-potter-zauberspruecher-erraten.json#L3)
**Symptom:** Game title is `"Harry Potter Zaubersprücher erraten"`. **"Zaubersprücher" is not a German word.** The plural of `der Zauberspruch` is `die Zaubersprüche`. The filename is also misspelled (`zauberspruecher` instead of `zauberspruche`), but that's just a slug.

**Evidence:** [pass-a/game-38-hp-zauberspruecher.png](pass-a/game-38-hp-zauberspruecher.png)

**Suggested fix:** Change the title to `"Harry Potter Zaubersprüche erraten"`. The file slug can stay (it's an external identifier) — but if you want to rename, also update the matching `gameOrder` entry in `config.json`.

---

### [major] 5. Answer phase overflows 1280×800 viewport for several game types

**Where:** Q1, four-statements, final-quiz, colorguess, image-guess answer phases
**Symptom:** At 1280×800 landscape (common laptop / projector size), the answer view requires scrolling. The question text + clues + answer all stacked vertically and exceed the 800-pixel height.

**Evidence:**
- [pass-b/q1/06-answer-revealed.png](pass-b/q1/06-answer-revealed.png) — question header pushed off-screen
- [pass-b/four-statements/05-answer.png](pass-b/four-statements/05-answer.png) — 4th actor cut off
- [pass-b/colorguess/04-answer.png](pass-b/colorguess/04-answer.png) — pie chart at top edge

At 375px portrait the same content scrolls naturally and looks fine ([pass-b/q1/bp-375-all-clues.png](pass-b/q1/bp-375-all-clues.png)). At 1920×1080 wide it fits.

**Suspected cause:** the game card has a fixed `padding` + `gap` that adds up to more vertical space than 800px when there are 4+ children. The 1280×800 aspect ratio (1.6) is in a dead-zone between portrait stacking and landscape pivoting.

**Suggested fix:** At ≥1024px landscape, switch the Q1/four-statements/colorguess answer layouts to 2-column grids (clues on the left, answer on the right). Or simply reduce padding/gap when `vh < 900`.

---

### [major] 6. Bet-quiz & final-quiz unplayable as a first game

**Where:** [src/components/games/BetQuiz.tsx](src/components/games/BetQuiz.tsx), [src/components/games/FinalQuiz.tsx](src/components/games/FinalQuiz.tsx)
**Symptom:** When teams have 0 points (start of show), every bet is rejected with `"Einsatz N übersteigt die Punkte von Team 1 (0)"`. The game cannot advance past the first question. The host cannot bypass this.

**Repro:**
1. Place either game at the start of `gameOrder` (or play it first).
2. Reach the bet phase.
3. Enter any number → validation rejects, "Frage anzeigen" stays disabled.

**Evidence:** [pass-b/bet-quiz/04-bet-entered.png](pass-b/bet-quiz/04-bet-entered.png) — the error message is visible in the snapshot for index 31 even though `georgs-quiz/archive` is at position 32 of the gameshow (so each prior game would normally have built up some points).

**Suggested fix:** allow bets of 0 (skip), OR seed each team with a minimum bettable balance (e.g. 1 point), OR provide a host-only "weiter" override that skips the bet validation. The current behavior is a hard wall.

---

### [minor] 7. Missing `/show/favicon.svg`

**Where:** every page load on the `/show/` zone triggers a 404
**Symptom:** `GET /show/favicon.svg` → 404. Console shows one error per page load:
```
[ERROR] Failed to load resource: 404 (Not Found) @ http://localhost:5173/show/favicon.svg
```
**Suggested fix:** Either remove the favicon `<link>` from [show/index.html](show/index.html), or add a `show/favicon.svg` asset. Same likely applies to `/admin/` and `/gamemaster/`.

---

### [minor] 8. FinalQuiz bet-input placeholder truncated

**Where:** [src/components/games/FinalQuiz.tsx:221](src/components/games/FinalQuiz.tsx#L221) and :228
**Symptom:** The bet inputs use `placeholder="Gesetzte Punkte Team 1"` / `"…Team 2"`, but the input's width is narrower than the placeholder text — it renders as `"Gesetzte Punkte Tea"` (cut off mid-word).
**Evidence:** [pass-b/final-quiz/05-after-press.png](pass-b/final-quiz/05-after-press.png)
**Suggested fix:** Shorten placeholder to `"Punkte Team 1"` (matches the gamemaster control at line 149), OR widen the input field, OR use a separate label above the input.

---

### [minor] 9. "FAKE" / "FAKT" labels are loan-words

**Where:** fact-or-fake answer reveal — the verdict word renders as `FAKE` (orange) or `FAKT` (green).
**Symptom:** "Fake" is a loan-word; "Fakt" is German but uncommon as a true-statement label. Some German speakers may find this jarring in an otherwise-German UI.
**Evidence:** [pass-b/fact-or-fake/04-answer.png](pass-b/fact-or-fake/04-answer.png)
**Suggested fix:** Check whether [specs/rules-standard.md](specs/rules-standard.md) canonicalizes the verdict word; if not, consider `WAHR` / `FALSCH` or `STIMMT` / `FAKE` instead. This is a judgment call — flag with user.

---

### [cosmetic] 10. Per-game theme override missing for Wer-ist-das (Harry Potter)

**Where:** [games/wer-ist-das-harry-potter-edition.json](games/wer-ist-das-harry-potter-edition.json)
**Symptom:** Critical Role's image-guess game sets `"theme": "dnd"` (dark/serif) — [games/wer-ist-das-critical-role-edition.json:124](games/wer-ist-das-critical-role-edition.json#L124). The Harry Potter edition does not, so it renders with the default Galaxia purple, breaking thematic consistency with the existing `harry-potter` theme.
**Evidence:**
- [pass-a/game-79-wer-ist-das-critical-role.png](pass-a/game-79-wer-ist-das-critical-role.png) (dark dnd theme)
- [pass-a/game-81-wer-ist-das-hp.png](pass-a/game-81-wer-ist-das-hp.png) (default theme)
**Suggested fix:** Add `"theme": "harry-potter"` to `games/wer-ist-das-harry-potter-edition.json`. Likewise consider checking every other Harry-Potter-themed game (`harry-potter-erster-satz`, `harry-potter-schauspieler`, `harry-potter-soundtrack`, `harry-potter-trivia`, `harry-potter-zaubersprueche`, `harry-potter-zauberstaebe`).

---

### [cosmetic] 11. Content under-uses 1920px screens

**Where:** every game type at 1920×1080
**Symptom:** Game cards have a max-width that leaves wide empty gutters and the content (question text, audio controls, etc.) renders at small sizes on a large screen. A projector-grade screen should treat 1920px as the *target*, not as something to scale down from.
**Evidence:** [pass-b/simple-quiz/bp-1920-answer.png](pass-b/simple-quiz/bp-1920-answer.png), [pass-c/bp-1920-modern-music.png](pass-c/bp-1920-modern-music.png)
**Suggested fix:** Allow `clamp()` widths to scale further at the upper end, or bump `max-width` on the main game card from whatever it currently is to e.g. `min(1600px, 90vw)`.

---

### [info] 12. Home page warns of 2 missing video caches

**Where:** `/show/` home banner
**Symptom:** A pre-game banner reads `⚠ 2 Video-Caches fehlen.` listing `harry-potter-zauberspruecher-erraten · archive · Clip 64` and `Clip 65`.
Not a frontend bug per se, but worth flagging: those clips live inside the **archive** instance of the HP-spells video-guess game; if the gameshow uses `<key>/archive` for that game (index 38), they're needed at runtime.
**Suggested fix:** click the "📦 Jetzt alle generieren (2)" button to warm the caches before the show.

---

## What was tested

### Pass A — Smoke sweep of all 87 games
- 87 navigations to `/show/game?index=N`, screenshot at 1280×800.
- 81 games loaded landing screens cleanly; 6 returned 404 (see #1).
- 4 game titles flagged as English (#3); 1 title misspelled (#4).
- Console: only the favicon 404 (#7) and the 2 expected error-state console-errors on the 6 broken games. No uncaught React errors.

### Pass B — Deep walkthrough per game type (14 types)
For each of `simple-quiz`, `bet-quiz`, `guessing-game`, `q1`, `four-statements`, `fact-or-fake`, `audio-guess`, `video-guess`, `quizjagd`, `final-quiz`, `bandle`, `image-guess`, `colorguess`, `ranking`:
- Landing → Rules → Game → reveal → next question → AwardPoints flow exercised
- Type-specific interaction tested (clicks, key inputs, audio/video playback)
- Responsive breakpoints sampled at 375, 768, 1280, 1920 for representative views

Working behaviors confirmed:
- ArrowRight / ArrowLeft / Spacebar navigation
- Audio playback in audio-guess, simple-quiz, bandle
- Video playback in video-guess
- Progressive reveal in bandle (5 stages), Q1 (4 clues), four-statements (4 clues), ranking (8 items)
- Pie chart in colorguess
- Per-team bet inputs in bet-quiz and final-quiz (UI works; logic blocked at 0 points — see #6)
- Closest-guess logic in guessing-game (verified: tip 35 vs answer 28 → "Team 1 ist näher dran!")
- Q1 false-clue highlight (red) vs true-clue (teal) on reveal
- Per-game theme override (`"theme": "dnd"` on Critical Role)

### Pass C — ThemeShowcase sweep
All 9 frontend themes rendered at 1280×800:
- Galaxia (default purple)
- Harry Potter (dark purple + gold serif)
- D&D (dark with serif)
- Arctic (black + cyan)
- Enterprise
- Retro (black + neon yellow/green)
- Minecraft (blue + blocky pixel font)
- Classical Music
- Modern Music (black + magenta)

Plus mobile (375) and projector (1920) breakpoints — both responsive.

---

## Not tested

- Award-points flow at all breakpoints (only at 1280 for simple-quiz)
- Joker UI (no jokers enabled in current config — `enabledJokers: []` per `/api/settings`)
- Long-press ArrowRight in bandle to reveal answer
- Background music (kept muted to avoid audio bleed during the sweep)
- Per-game testing of Gamemaster connection UI / fallback button — would need to test with no GM connected (which is current state) AND with GM connected
- Critical-Role and Harry-Potter themed games at the per-theme breakpoint matrix (only sampled at 1280)
- Color contrast / WCAG audit
- Keyboard navigation beyond ArrowRight/ArrowLeft/Tab
