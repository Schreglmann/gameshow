# Spec: Gamemaster Deadline Timer

## Goal
Allow the gamemaster to start a temporary countdown timer on the **current question only**, for any game type, from buttons in the GM toolbar. When the timer expires, currently-playing question audio (and video) is paused — the same effect the existing `simple-quiz` per-question timer already has, but on-demand and cross-game. The GM can also **Pause/Resume** any currently-running timer (deadline OR per-question `q.timer`).

## Acceptance criteria
- [ ] The GM toolbar shows a deadline-timer row directly below the "Steuerung sperren" and "Bilder einblenden" toggles
- [x] The row contains six duration buttons labeled `5s`, `10s`, `30s`, `60s`, `90s`, `120s`, laid out as a tidy 3×2 grid (2×3 in the narrow vertical GM gutter)
- [x] While a GM deadline timer is active, a `+10s` button extends it: pushes `deadlineEndsAt` 10s later (or grows the paused remaining), and grows `deadlineTotalSeconds` so the ring stays proportional
- [x] The countdown is **absolute-deadline based**: the show computes `deadlineEndsAt = Date.now() + secs*1000` and broadcasts it on the cached `gamemaster-controls` channel; remaining time is always `deadlineEndsAt - Date.now()`, never a local counter. A reconnecting show/GM tab therefore shows the correct remaining time (the old local `setInterval` Timer was wrong on reconnect)
- [x] The countdown renders LARGE on BOTH the projector (show portal) and the GM screen, as a shrinking ring + number that goes green → yellow (≤30%) → red (≤5s). The GM mirror is **silent** (only the projector plays sound)
- [x] A tick plays once per second, synthesized via the shared `src/utils/timerSound.ts` (`playTimerTick`) — Web Audio, no shipped asset; best-effort, silently no-ops if audio can't start. A **soft LOW-pitch pulse (660 Hz)** for the calm phase, switching to a **louder HIGH-pitch tick (1320 Hz)** for the **final 10 seconds** (`remaining ≤ 10s`). **When the low pulse starts depends on who started the timer:**
  - **GM-by-hand deadline (`DeadlineTimer`):** the LOW pulse runs from the **very start** of the countdown (the GM chose to start it, so it's "live" from t=0), HIGH in the final 10s.
  - **Game-set per-question timer (`Timer`, configured `q.timer`):** the LOW pulse starts only once **30 seconds remain** (these are often long, e.g. wer-kennt-mehr's 120s — no point ticking the whole time), HIGH in the final 10s.
  - The GM mirror of the deadline timer is silent (only the projector plays sound)
- [x] Pause freezes the ring + number; Resume re-derives a fresh `deadlineEndsAt` from the captured remaining ms (a frozen absolute timestamp would keep counting down on a reconnecting tab)
- [ ] A `Pause` button appears in the row whenever **any** timer is currently ticking — the GM deadline timer OR a per-question `q.timer` in SimpleQuiz / BetQuiz / WerKenntMehr. The button label flips to `Weiter` while the timer is paused
- [ ] While a GM deadline timer is active it **overrides** the per-question `q.timer`: the game reports its per-question timer as NOT active (`setGameTimerActive(false)`) so the GM never shows the (hidden) per-question timer as a running timer. The deadline timer itself still drives the Pause/Stop controls. (Regression: a live show where wer-kennt-mehr's 120s `q.timer` "did not start" yet the GM showed it running — a GM countdown was active and the per-question timer was suppressed on the show but still reported active.)
- [ ] A `Stop` button appears in the row alongside Pause whenever any timer is currently ticking (running or paused). Pressing it removes the running timer entirely — clears the GM deadline state AND calls the active game's stop-timer handler (clears its `q.timer`)
- [ ] Both Pause and Stop disappear the instant a timer expires naturally (they stay hidden while the "Zeit abgelaufen!" badge is showing during its auto-clear delay)
- [ ] The entire deadline-timer row (duration buttons + Pause + Stop) is hidden during the game's answer-reveal phase — countdowns are meaningless once players see the solution
- [ ] Duration buttons are disabled when the show's phase is not `game` (landing / rules / points)
- [ ] Pressing a duration button while a timer is running restarts the timer with the new duration (the visible Timer component remounts) and clears any paused state
- [ ] Pressing Pause freezes the active timer at its current value; pressing Weiter resumes from the same value. The same single Pause control governs both the GM deadline timer and the per-question `q.timer`
- [ ] On the show frontend, the deadline `Timer` renders at the same bottom-left position used by the existing per-question timer, via `createPortal` to `document.body`
- [x] On expiry, a synthesized **"time's up"** motif plays (`playTimerEnd` in `src/utils/timerSound.ts` — a short descending three-note E6→A5→A4 in the same Web Audio timbre as the ticks, so the end fits the tick sound theme instead of a sampled buzzer) and the display shows "Zeit abgelaufen!". No binary asset — the old `public/sfx/timer-end.mp3` was removed. Both the GM deadline timer and the per-question `Timer` use this same finish sound.
- [ ] The "Zeit abgelaufen!" badge auto-hides after a few seconds (≈4s) so the expired timer doesn't linger on screen
- [ ] When the GM starts a new deadline after the previous one expired, any audio that was paused at expiry **resumes** from its paused position so the next countdown plays the same clip without the GM having to re-trigger playback
- [ ] On expiry, any `<audio>` / `<video>` element in the document is paused (covers Bandle, AudioGuess, VideoGuess), AND any game-registered stop-audio handler is invoked (covers SimpleQuiz / BetQuiz which use detached `new Audio()` instances)
- [ ] Background music continues playing (it uses `new Audio()` and is not registered as a stop-audio handler)
- [ ] Pause does NOT trigger the on-expiry audio-pause: it only freezes the visible Timer
- [ ] When a per-question timer (`q.timer`) is configured (SimpleQuiz / BetQuiz / WerKenntMehr), the deadline timer **overrides** it — the per-question timer is hidden while the deadline is active (and its `setGameTimerActive` reports `false`), and it resumes on the next question if still configured
- [ ] When the question number changes (Weiter / Pfeil rechts), any active deadline timer is cleared automatically and the paused flag resets — deadlines do not bleed across questions
- [ ] When the game reveals its answer, any active deadline timer disappears immediately (answer reveal supersedes the countdown). All game types signal their answer-reveal phase to `BaseGameWrapper` via the `setAnswerRevealed` render-prop
- [x] **While the pause/hold overlay (`show-hold`) is active, any running timer freezes** — `BaseGameWrapper` auto-pauses the deadline (capturing remaining ms exactly like a manual Pause) and resumes it when the hold lifts. A paused show must not keep burning the clock. The auto-resume only re-starts a timer the hold itself paused — a timer the GM had paused by hand before the hold stays paused (and a manual `timer-pause`/`timer-resume`/`timer-stop`/new-`deadline-N` during a hold takes ownership, so the hold no longer auto-resumes it)
- [ ] No game JSON file or `config.json` is mutated by the feature
- [ ] The GM toolbar (lock + image-visibility + deadline row) always flows inline above the gamemaster-content card — at every viewport width. The long German labels ("Steuerung sperren" / "Bilder ausblenden") make a fixed-positioned toolbar overlap the centered card at common tablet/laptop widths, so inline placement is the robust choice

## State / data changes
- `BaseGameWrapper` owns timer state: `deadlineEndsAt` (absolute epoch-ms), `deadlineTotalSeconds`, `deadlineRunning`, `timerPaused`, `gameTimerActive`, `answerRevealed`, plus refs `pausedRemainingMsRef` (remaining at the moment of Pause), `stopAudioHandlerRef`, `pausedMediaRef`, `resumeGameAudioRef`, `expiryClearTimerRef`. Local React state / refs — not persisted.
- `BaseGameWrapper` also subscribes to the cached `show-hold` channel (`holdActive` state) and, on its rising edge, auto-pauses any running timer (and resumes on the falling edge). `autoPausedByHoldRef` records that the pause was hold-driven so a manual pause is never auto-resumed; `prevHoldRef` makes the effect act only on the hold transition.
- The visible countdown is rendered by `src/components/common/DeadlineTimer.tsx` (absolute-deadline driven, ring + tick-from-start + synth finish). The per-question `src/components/common/Timer.tsx` (SimpleQuiz / BetQuiz / WerKenntMehr) now also ticks (low from 30s, high in the final 10s) and shares the same synthesized finish sound. Both pull `playTimerTick` / `playTimerEnd` from the shared `src/utils/timerSound.ts` (one Web Audio context, no binary asset).
- New optional fields on `GamemasterControlsData` (broadcast over the `gamemaster-controls` WS channel):
  - `deadlineActive?: boolean` — deadline timer has a value set (running or in expiry badge)
  - `timerActive?: boolean` — any timer (deadline or `q.timer`) is currently ticking; drives Pause/Stop button visibility
  - `timerPaused?: boolean` — the active timer is paused
  - `answerRevealed?: boolean` — the active game is in its answer-reveal phase; the GM toolbar hides the entire deadline row while true
  - `deadlineEndsAt?: number` — absolute epoch-ms when the GM deadline expires; drives the GM-side mirror's correct-on-reconnect remaining time
  - `deadlineTotalSeconds?: number` — total duration for the ring fraction
- New trailing parameters on `useGamemasterControlsSync(...)`: `timerActive?`, `timerPaused?`, `answerRevealed?`, `scrollAnchors?`, `fullscreenAvailable?`, `fullscreenOpen?`, `deadlineEndsAt?`, `deadlineTotalSeconds?`
- New `controlId` values handled by `BaseGameWrapper`'s gamemaster-command listener:
  - `deadline-30`, `deadline-60`, `deadline-90` — start/restart a countdown (the parse accepts any `deadline-<n>`)
  - `deadline-extend` — add 10s to the active (or paused) deadline
  - `timer-pause` / `timer-resume` — pause or resume the currently active timer (deadline OR `q.timer`)
  - `timer-stop` — remove the active timer entirely: clears the GM deadline state and calls the registered `setStopGameTimerHandler` so games can clear their `q.timer`
  - (`deadline-stop` is removed; if an older client sends it, the parseInt yields NaN and it is a no-op)
  - `GamemasterCommand.controlId` is a free string in `specs/api/asyncapi.yaml`, so no command-schema change.
- New render-prop fields on `BaseGameWrapper.children({ ... })`:
  - `deadlineActive: boolean`
  - `setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void` — the optional return value is a resume callback the wrapper invokes on the next deadline start
  - `setAnswerRevealed: (revealed: boolean) => void` — games call this when their answer-reveal phase enters/exits
  - `timerPaused: boolean` — games with a per-question Timer apply this to their Timer's `running` prop so Pause from the GM freezes the countdown
  - `setGameTimerActive: (active: boolean) => void` — games with a per-question Timer call this whenever the Timer is rendered & ticking, so the wrapper can broadcast a unified `timerActive` flag
  - `setStopGameTimerHandler: (fn: (() => void) | null) => void` — games with a per-question Timer register a callback the wrapper invokes on `timer-stop` so the game can clear its own `timerRunning`
- No binary audio asset — all countdown sound (tick + finish) is synthesized in `src/utils/timerSound.ts`. (The former `public/sfx/timer-end.mp3` was removed.)

## UI behaviour
- **GM screen** (`/gamemaster`):
  - Toolbar flows inline at the top of `.gamemaster-screen` (no `position: fixed`). The lock + image-visibility toggles and the deadline row sit in a single flex-row above the content card.
  - Deadline row layout: a horizontal flex row with the four duration buttons + the optional Pause/Weiter button. Wraps at narrow widths.
  - Pause button uses a warning (yellow) variant to distinguish it from the duration buttons; on Weiter (resume) it uses the same neutral glass styling as the durations.
  - At ≤640px the toolbar children stack full-width for touch ergonomics; the deadline row stays inline.
  - The GM toolbar mirrors the live countdown as a **silent** ring (`DeadlineTimer ... silent`) so the host sees the remaining time without the GM device duplicating the projector's tick/buzzer. The `+10s` button sits alongside Pause/Stop while a GM deadline runs.
- **Show screen** (`/show`):
  - Deadline `DeadlineTimer` appears bottom-left in a fixed portal at `bottom: 1.5rem; left: 1.5rem; z-index: 9999;` — identical position to today's per-question timer. It renders a shrinking ring + number.
  - At 0 it shows "Zeit abgelaufen!", plays the ding, and pauses audio. The badge auto-clears ~4 seconds later (or earlier if the GM advances / reveals the answer / starts a new deadline).
  - When paused (deadline or `q.timer`), the timer freezes at its current second; the badge does not show the expired state.

## Out of scope
- Configuring deadline timers in game JSON (this stays a runtime-only GM control)
- Persisting active deadlines across reloads or across questions beyond what the cached `gamemaster-controls` channel re-broadcasts (a reconnect within the same session does recover the correct remaining time from `deadlineEndsAt`)
- Stopping background music or sound effects
- Per-team deadline timers (single timer, applies to the whole question)
- Synchronizing device clocks: `deadlineEndsAt` is the show's wall clock, so a GM device with a skewed clock is off by the skew (acceptable for a single-venue show on one network)
