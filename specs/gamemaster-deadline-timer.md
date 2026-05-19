# Spec: Gamemaster Deadline Timer

## Goal
Allow the gamemaster to start a temporary countdown timer on the **current question only**, for any game type, from buttons in the GM toolbar. When the timer expires, currently-playing question audio (and video) is paused — the same effect the existing `simple-quiz` per-question timer already has, but on-demand and cross-game. The GM can also **Pause/Resume** any currently-running timer (deadline OR per-question `q.timer`).

## Acceptance criteria
- [ ] The GM toolbar shows a deadline-timer row directly below the "Steuerung sperren" and "Bilder einblenden" toggles
- [ ] The row contains four duration buttons labeled `5s`, `10s`, `30s`, `60s`
- [ ] A `Pause` button appears in the row whenever **any** timer is currently ticking — the GM deadline timer OR a per-question `q.timer` in SimpleQuiz / BetQuiz. The button label flips to `Weiter` while the timer is paused
- [ ] A `Stop` button appears in the row alongside Pause whenever any timer is currently ticking (running or paused). Pressing it removes the running timer entirely — clears the GM deadline state AND calls the active game's stop-timer handler (clears its `q.timer`)
- [ ] Both Pause and Stop disappear the instant a timer expires naturally (they stay hidden while the "Zeit abgelaufen!" badge is showing during its auto-clear delay)
- [ ] The entire deadline-timer row (duration buttons + Pause + Stop) is hidden during the game's answer-reveal phase — countdowns are meaningless once players see the solution
- [ ] Duration buttons are disabled when the show's phase is not `game` (landing / rules / points)
- [ ] Pressing a duration button while a timer is running restarts the timer with the new duration (the visible Timer component remounts) and clears any paused state
- [ ] Pressing Pause freezes the active timer at its current value; pressing Weiter resumes from the same value. The same single Pause control governs both the GM deadline timer and the per-question `q.timer`
- [ ] On the show frontend, the deadline `Timer` renders at the same bottom-left position used by the existing per-question timer, via `createPortal` to `document.body`
- [ ] On expiry, the ding sound at `/sfx/timer-end.mp3` plays (bundled from `public/sfx/` so it ships with every PWA and isn't dependent on `local-assets`) and the display shows "Zeit abgelaufen!"
- [ ] The "Zeit abgelaufen!" badge auto-hides after a few seconds (≈4s) so the expired timer doesn't linger on screen
- [ ] When the GM starts a new deadline after the previous one expired, any audio that was paused at expiry **resumes** from its paused position so the next countdown plays the same clip without the GM having to re-trigger playback
- [ ] On expiry, any `<audio>` / `<video>` element in the document is paused (covers Bandle, AudioGuess, VideoGuess), AND any game-registered stop-audio handler is invoked (covers SimpleQuiz / BetQuiz which use detached `new Audio()` instances)
- [ ] Background music continues playing (it uses `new Audio()` and is not registered as a stop-audio handler)
- [ ] Pause does NOT trigger the on-expiry audio-pause: it only freezes the visible Timer
- [ ] When a per-question timer (`q.timer`) is configured (SimpleQuiz / BetQuiz), the deadline timer **overrides** it — the per-question timer is hidden while the deadline is active and resumes on the next question if still configured
- [ ] When the question number changes (Weiter / Pfeil rechts), any active deadline timer is cleared automatically and the paused flag resets — deadlines do not bleed across questions
- [ ] When the game reveals its answer, any active deadline timer disappears immediately (answer reveal supersedes the countdown). All game types signal their answer-reveal phase to `BaseGameWrapper` via the `setAnswerRevealed` render-prop
- [ ] No game JSON file or `config.json` is mutated by the feature
- [ ] The GM toolbar (lock + image-visibility + deadline row) always flows inline above the gamemaster-content card — at every viewport width. The long German labels ("Steuerung sperren" / "Bilder ausblenden") make a fixed-positioned toolbar overlap the centered card at common tablet/laptop widths, so inline placement is the robust choice

## State / data changes
- `BaseGameWrapper` owns timer state: `deadlineSeconds`, `deadlineKey`, `deadlineRunning`, `timerPaused`, `gameTimerActive`, `answerRevealed`, plus refs `stopAudioHandlerRef`, `pausedMediaRef`, `resumeGameAudioRef`, `expiryClearTimerRef`. Local React state / refs — not persisted.
- New optional fields on `GamemasterControlsData` (broadcast over the `gamemaster-controls` WS channel):
  - `deadlineActive?: boolean` — deadline timer has a value set (running or in expiry badge)
  - `timerActive?: boolean` — any timer (deadline or `q.timer`) is currently ticking; drives Pause/Stop button visibility
  - `timerPaused?: boolean` — the active timer is paused
  - `answerRevealed?: boolean` — the active game is in its answer-reveal phase; the GM toolbar hides the entire deadline row while true
- New trailing parameters on `useGamemasterControlsSync(...)`: `timerActive?`, `timerPaused?`, `answerRevealed?`
- New `controlId` values handled by `BaseGameWrapper`'s gamemaster-command listener:
  - `deadline-5`, `deadline-10`, `deadline-30`, `deadline-60` — start/restart a countdown
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
- Asset: `public/sfx/timer-end.mp3` (committed in the repo, not under the gitignored `audio/` tree)

## UI behaviour
- **GM screen** (`/gamemaster`):
  - Toolbar flows inline at the top of `.gamemaster-screen` (no `position: fixed`). The lock + image-visibility toggles and the deadline row sit in a single flex-row above the content card.
  - Deadline row layout: a horizontal flex row with the four duration buttons + the optional Pause/Weiter button. Wraps at narrow widths.
  - Pause button uses a warning (yellow) variant to distinguish it from the duration buttons; on Weiter (resume) it uses the same neutral glass styling as the durations.
  - At ≤640px the toolbar children stack full-width for touch ergonomics; the deadline row stays inline.
- **Show screen** (`/show`):
  - Deadline `Timer` appears bottom-left in a fixed portal at `bottom: 1.5rem; left: 1.5rem; z-index: 9999;` — identical position to today's per-question timer.
  - At 0 it shows "Zeit abgelaufen!" with the existing `--done` animation, plays the ding, and pauses audio. The badge auto-clears ~4 seconds later (or earlier if the GM advances / reveals the answer / starts a new deadline).
  - When paused (deadline or `q.timer`), the Timer freezes at its current second; the badge does not show the expired state.

## Out of scope
- Configuring deadline timers in game JSON (this stays a runtime-only GM control)
- Persisting active deadlines across reloads or across questions
- Stopping background music or sound effects
- Showing the remaining time on the GM screen (the Timer renders only on the show)
- Per-team deadline timers (single timer, applies to the whole question)
