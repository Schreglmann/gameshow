# Spec: Gamemaster Deadline Timer

## Goal
Allow the gamemaster to start a temporary countdown timer on the **current question only**, for any game type, from buttons in the GM toolbar. When the timer expires, currently-playing question audio (and video) is paused — the same effect the existing `simple-quiz` per-question timer already has, but on-demand and cross-game. The GM can also **Pause/Resume** any currently-running timer (deadline OR per-question `q.timer`).

## Acceptance criteria
- [ ] The GM toolbar shows a deadline-timer row directly below the "Steuerung sperren" and "Bilder einblenden" toggles
- [x] The row contains six duration buttons labeled `5s`, `10s`, `30s`, `60s`, `90s`, `120s`, laid out as a tidy 3×2 grid (2×3 in the narrow vertical GM gutter)
- [x] While a **GM deadline** is active (`timerKind === 'deadline'`), a `+10s` button extends it: pushes `deadlineEndsAt` 10s later (or grows the paused remaining), and grows `deadlineTotalSeconds` so the ring stays proportional. The `+10s` button is NOT shown for a per-question timer (it can be paused/stopped/muted, not extended)
- [x] Both the GM deadline AND a per-question `q.timer` are **absolute-deadline based** and owned by `BaseGameWrapper`: the show computes `endsAt = Date.now() + secs*1000` and renders its ring from that local state. For the GM mirror the show broadcasts the **remaining ms** (`timerRemainingMs`), refreshed ~1×/sec, on the cached `gamemaster-controls` channel; the GM rebases it onto ITS OWN clock (`endsAt = Date.now() + timerRemainingMs`) rather than trusting the show's absolute timestamp — so the two surfaces stay in sync across **device clock skew** and the GM is correct after a reconnect (the old broadcast of an absolute `deadlineEndsAt`, read against the GM device clock, drifted by the clock skew)
- [x] The countdown renders LARGE on BOTH the projector (show portal) and the GM screen, as a shrinking ring + number that goes green → yellow (≤30%) → red (≤5s), for **both** timer kinds. The GM mirror is **silent** (only the projector plays sound)
- [x] A tick plays once per second, synthesized via the shared `src/utils/timerSound.ts` (`playTimerTick`) — Web Audio, no shipped asset; best-effort, silently no-ops if audio can't start. A **soft LOW-pitch pulse (660 Hz)** for the calm phase, switching to a **louder HIGH-pitch tick (1320 Hz)** for the **final 10 seconds** (`remaining ≤ 10s`). **The LOW pulse starts only once 30 seconds remain — for both timer types:**
  - **GM-by-hand deadline (`DeadlineTimer`):** the LOW pulse starts once **30 seconds remain** (a duration ≤30s therefore ticks from its start), HIGH in the final 10s.
  - **Game-set per-question timer (configured `q.timer`, now the same `DeadlineTimer` ring):** the LOW pulse starts only once **30 seconds remain** (these are often long, e.g. wer-kennt-mehr's 120s — no point ticking the whole time), HIGH in the final 10s.
  - The GM mirror of the deadline timer is silent (only the projector plays sound)
  - The GM can **mute the tick** for the current game via the `Ticken aus` toggle (see below): while `tickMuted` is set, `playTimerTick` is suppressed for BOTH timer types on the show, but `playTimerEnd` (the finish motif) still fires.
- [x] Pause freezes the ring + number; Resume re-derives a fresh `deadlineEndsAt` from the captured remaining ms (a frozen absolute timestamp would keep counting down on a reconnecting tab)
- [ ] A `Pause` button appears in the row whenever **any** timer is currently ticking — the GM deadline timer OR a per-question `q.timer` in SimpleQuiz / BetQuiz / WerKenntMehr. The button label flips to `Weiter` while the timer is paused
- [ ] While a GM deadline timer is active it **overrides** the per-question `q.timer`: `BaseGameWrapper` keeps them as separate state and the active timer is `activeEndsAt = deadlineEndsAt ?? gameTimerEndsAt`, so the deadline is what renders + broadcasts (`timerKind === 'deadline'`) while it runs. The game timer keeps running "underneath" and resurfaces at its true remaining if the GM stops the deadline mid-question.
- [ ] A `Stop` button appears in the row alongside Pause whenever any timer is currently ticking (running or paused). Pressing it removes the running timer entirely — clears BOTH the GM deadline state and the per-question game-timer state in `BaseGameWrapper`. The game's arm-effect deps don't change on stop, so it won't re-arm until the next question (reproducing the old "stopped stays stopped until next question")
- [ ] A **mute-ticking** toggle button (`Ticken aus` / `Ticken an`) appears in the row alongside Pause/Stop whenever any timer is currently ticking. Pressing it toggles a per-game `tickMuted` flag that suppresses **only the per-second tick** on the show (both timer types) — the `playTimerEnd` "time's up" motif at expiry still plays. The mute **persists for the whole game** (it survives question changes and Pause/Resume/Stop and new deadlines) and resets only when the game changes (the `BaseGameWrapper` remounts). The button highlights (accent variant, `aria-pressed`) while muted. The GM-side mirror is unaffected (already `silent`).
- [ ] Both Pause and Stop disappear the instant a timer expires naturally (they stay hidden while the "Zeit abgelaufen!" badge is showing during its auto-clear delay)
- [ ] The entire deadline-timer row (duration buttons + Pause + Stop) is hidden during the game's answer-reveal phase — countdowns are meaningless once players see the solution
- [ ] Duration buttons are disabled when the show's phase is not `game` (landing / rules / points)
- [ ] Pressing a duration button while a timer is running restarts the countdown with the new duration and clears any paused state
- [ ] Pressing Pause freezes the active timer at its current value; pressing Weiter resumes from the same value. The single Pause control governs whichever timer is active (deadline or per-question) via `freezeActiveTimer`/`resumeActiveTimer`, which record the frozen kind so Resume re-derives the correct endsAt
- [ ] On the show frontend, the countdown ring renders bottom-left via `createPortal` to `document.body` (`.deadline-timer-portal`) — one ring for whichever timer is active
- [x] On expiry, a synthesized **"time's up"** motif plays (`playTimerEnd` in `src/utils/timerSound.ts` — a short descending three-note E6→A5→A4 in the same Web Audio timbre as the ticks, so the end fits the tick sound theme instead of a sampled buzzer) and the display shows "Zeit abgelaufen!". No binary asset — the old `public/sfx/timer-end.mp3` was removed. Both the GM deadline timer and the per-question `Timer` use this same finish sound.
- [ ] The "Zeit abgelaufen!" badge auto-hides after a few seconds (≈4s) so the expired timer doesn't linger on screen
- [ ] When the GM starts a new deadline after the previous one expired, any audio that was paused at expiry **resumes** from its paused position so the next countdown plays the same clip without the GM having to re-trigger playback
- [ ] On expiry, any `<audio>` / `<video>` element in the document is paused (covers Bandle, AudioGuess, VideoGuess), AND any game-registered stop-audio handler is invoked (covers SimpleQuiz / BetQuiz which use detached `new Audio()` instances)
- [ ] Background music continues playing (it uses `new Audio()` and is not registered as a stop-audio handler)
- [ ] Pause does NOT trigger the on-expiry audio-pause: it only freezes the visible Timer
- [ ] When a per-question timer (`q.timer`) is configured (SimpleQuiz / BetQuiz / WerKenntMehr), the game declares it via `setGameTimer(q.timer ?? null)` on each question and clears it on the answer phase; a GM deadline **overrides** it while active (see above)
- [ ] When the question number changes (Weiter / Pfeil rechts), any active GM deadline is cleared automatically and the paused flag resets — deadlines do not bleed across questions. The per-question timer is re-armed by the game (its effect runs first, as a child), so the wrapper must NOT clear the game timer on question change
- [ ] When the game reveals its answer, both an active GM deadline AND the per-question game timer disappear immediately (answer reveal supersedes the countdown). All game types signal their answer-reveal phase to `BaseGameWrapper` via the `setAnswerRevealed` render-prop
- [x] **While the pause/hold overlay (`show-hold`) is active, any running timer freezes** — `BaseGameWrapper` auto-pauses the deadline (capturing remaining ms exactly like a manual Pause) and resumes it when the hold lifts. A paused show must not keep burning the clock. The auto-resume only re-starts a timer the hold itself paused — a timer the GM had paused by hand before the hold stays paused (and a manual `timer-pause`/`timer-resume`/`timer-stop`/new-`deadline-N` during a hold takes ownership, so the hold no longer auto-resumes it)
- [ ] No game JSON file or `config.json` is mutated by the feature
- [ ] The GM toolbar (lock + image-visibility + deadline row) always flows inline above the gamemaster-content card — at every viewport width. The long German labels ("Steuerung sperren" / "Bilder ausblenden") make a fixed-positioned toolbar overlap the centered card at common tablet/laptop widths, so inline placement is the robust choice

## State / data changes
- `BaseGameWrapper` owns the GM deadline state (`deadlineEndsAt` epoch-ms, `deadlineTotalSeconds`, `deadlineRunning`) AND separate per-question game-timer state (`gameTimerEndsAt`, `gameTimerTotalSeconds`, `gameTimerRunning`), plus `timerPaused`, `tickMuted`, `answerRevealed`, `broadcastRemainingMs`, and refs `pausedRemainingMsRef` + `pausedTimerKindRef` (remaining ms + which timer was frozen), `deadlineEndsAtRef`/`gameTimerEndsAtRef` (fresh values for the freeze helpers), `stopAudioHandlerRef`, `pausedMediaRef`, `resumeGameAudioRef`, `expiryClearTimerRef`. Local React state / refs — not persisted. The currently-visible timer is `activeEndsAt = deadlineEndsAt ?? gameTimerEndsAt` (deadline precedence), with `activeTotalSeconds`/`activeKind` derived alongside. `tickMuted` is intentionally NOT reset on question change (it persists for the whole game).
- `freezeActiveTimer()` / `resumeActiveTimer()` capture/re-derive the remaining ms on whichever timer is active; used by both the `timer-pause`/`timer-resume` commands and the hold auto-pause. `pauseActiveAudioOnExpiry()` is the shared audio-pause used by both `handleDeadlineComplete` (deadline: pauses audio + 4s badge auto-clear) and `handleGameTimerComplete` (game timer: pauses audio, keeps "Zeit abgelaufen!" until the answer/next question).
- `BaseGameWrapper` also subscribes to the cached `show-hold` channel (`holdActive` state) and, on its rising edge, auto-pauses any running timer (and resumes on the falling edge). `autoPausedByHoldRef` records that the pause was hold-driven so a manual pause is never auto-resumed; `prevHoldRef` makes the effect act only on the hold transition.
- A 1-second interval (running only while `activeEndsAt !== null && !timerPaused`) updates `broadcastRemainingMs = max(0, activeEndsAt - Date.now())`, which is broadcast as `timerRemainingMs`. Frozen at the paused remaining while paused.
- The visible countdown (both kinds) is rendered by `src/components/common/DeadlineTimer.tsx` (absolute-deadline driven, ring + tick-from-30s + synth finish; `muteTicks` gates only `playTimerTick`). The standalone `src/components/common/Timer.tsx` (number pill) was **removed** — the per-question `q.timer` now uses the same `DeadlineTimer` ring. `playTimerTick` / `playTimerEnd` come from the shared `src/utils/timerSound.ts` (one Web Audio context, no binary asset).
- Optional fields on `GamemasterControlsData` (broadcast over the `gamemaster-controls` WS channel):
  - `deadlineActive?: boolean` — the GM deadline has a value set (running or in expiry badge)
  - `timerActive?: boolean` — any timer (deadline or `q.timer`) is currently ticking; drives Pause/Stop button visibility
  - `timerPaused?: boolean` — the active timer is paused
  - `answerRevealed?: boolean` — the active game is in its answer-reveal phase; the GM toolbar hides the entire deadline row while true
  - `timerRemainingMs?: number` — remaining ms of the active timer, refreshed ~1×/sec; the GM rebases it onto its own clock (skew-proof + correct on reconnect)
  - `timerTotalSeconds?: number` — total duration for the ring fraction (both kinds)
  - `timerKind?: 'deadline' | 'question'` — which timer is active; the GM gates the deadline-only `+10s` button on it
  - `timerMuted?: boolean` — the GM has muted the per-second tick for the current game (only the tick; the finish motif still plays); drives the GM toolbar's mute-toggle label/state
  - (the old `deadlineEndsAt` / `deadlineTotalSeconds` fields were REMOVED from the wire — they were the clock-skew source)
- New trailing parameters on `useGamemasterControlsSync(...)`: `timerActive?`, `timerPaused?`, `answerRevealed?`, `scrollAnchors?`, `fullscreenAvailable?`, `fullscreenOpen?`, `timerRemainingMs?`, `timerTotalSeconds?`, `timerKind?`, `timerMuted?`
- `controlId` values handled by `BaseGameWrapper`'s gamemaster-command listener:
  - `deadline-30`, `deadline-60`, `deadline-90` — start/restart a GM countdown (the parse accepts any `deadline-<n>`)
  - `deadline-extend` — add 10s to the active (or paused) GM deadline
  - `timer-pause` / `timer-resume` — freeze/resume whichever timer is active (deadline OR `q.timer`)
  - `timer-stop` — remove the active timer entirely: clears BOTH the GM deadline state and the per-question game-timer state
  - `timer-mute-toggle` — toggle the per-game `tickMuted` flag (mutes only the per-second tick on the show for both timer types; the finish motif still plays)
  - (`deadline-stop` is removed; if an older client sends it, the parseInt yields NaN and it is a no-op)
  - `GamemasterCommand.controlId` is a free string in `specs/api/asyncapi.yaml`, so no command-schema change.
- Render-prop fields on `BaseGameWrapper.children({ ... })` relevant here:
  - `setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void` — the optional return value is a resume callback the wrapper invokes on the next deadline start
  - `setAnswerRevealed: (revealed: boolean) => void` — games call this when their answer-reveal phase enters/exits
  - `setGameTimer: (seconds: number | null) => void` — games declare their per-question `q.timer` here (duration to arm, `null` to clear). Replaces the old `setGameTimerActive` / `setStopGameTimerHandler` / `timerPaused` / `tickMuted` / `deadlineActive` timer props — the games no longer render their own Timer.
- No binary audio asset — all countdown sound (tick + finish) is synthesized in `src/utils/timerSound.ts`. (The former `public/sfx/timer-end.mp3` was removed.)

## UI behaviour
- **GM screen** (`/gamemaster`):
  - Toolbar flows inline at the top of `.gamemaster-screen` (no `position: fixed`). The lock + image-visibility toggles and the deadline row sit in a single flex-row above the content card.
  - Deadline row layout: a horizontal flex row with the four duration buttons + the optional Pause/Weiter button. Wraps at narrow widths.
  - Pause button uses a warning (yellow) variant to distinguish it from the duration buttons; on Weiter (resume) it uses the same neutral glass styling as the durations.
  - At ≤640px the toolbar children stack full-width for touch ergonomics; the deadline row stays inline.
  - The GM toolbar mirrors the live countdown as a **silent** ring (`DeadlineTimer ... silent`) so the host sees the remaining time without the GM device duplicating the projector's tick/buzzer. The `+10s`, Pause/Weiter, `Ticken aus`/`Ticken an` (mute) and Stop buttons sit alongside each other while a timer runs.
- **Show screen** (`/show`):
  - Deadline `DeadlineTimer` appears bottom-left in a fixed portal at `bottom: 1.5rem; left: 1.5rem; z-index: 9999;` — identical position to today's per-question timer. It renders a shrinking ring + number.
  - At 0 it shows "Zeit abgelaufen!", plays the ding, and pauses audio. The badge auto-clears ~4 seconds later (or earlier if the GM advances / reveals the answer / starts a new deadline).
  - When paused (deadline or `q.timer`), the timer freezes at its current second; the badge does not show the expired state.

## Out of scope
- Configuring deadline timers in game JSON (this stays a runtime-only GM control)
- Persisting active deadlines across reloads or across questions beyond what the cached `gamemaster-controls` channel re-broadcasts (a reconnect within the same session does recover the correct remaining time from `deadlineEndsAt`)
- Stopping background music or sound effects
- Per-team deadline timers (single timer, applies to the whole question)
- Sub-second precision across devices: the GM rebases the show's `timerRemainingMs` onto its own clock each ~1s, so any residual difference is bounded by WS latency + the 1s refresh (not the raw device clock skew, which the old absolute-`deadlineEndsAt` broadcast suffered from). Good enough for a single-venue show on one network
