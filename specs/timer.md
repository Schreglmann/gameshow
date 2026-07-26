# Spec: Timer

> **Superseded.** The standalone `Timer` component (a local `setInterval` number
> pill) has been removed. A per-question `q.timer` now flows through the same
> absolute-deadline engine as the GM deadline timer: the game declares its
> duration via `setGameTimer(seconds | null)` and `BaseGameWrapper` owns the
> countdown, renders the shrinking **ring** (`DeadlineTimer`) on the show, and
> broadcasts the remaining time to the GM mirror. See
> [gamemaster-deadline-timer.md](gamemaster-deadline-timer.md). This file is kept
> for history; the acceptance criteria below describe the old component.

## Goal
A reusable countdown component gives the host and teams a visible time limit for questions that have an optional `timer` field.

## Acceptance criteria
- [x] Counts down from `seconds` prop to `0` at one-second intervals
- [x] Countdown only runs when `running` prop is `true`; pauses immediately when `running` becomes `false`
- [x] On expiry (reaching 0): plays a synthesized "time's up" motif via `playTimerEnd()` from the shared `src/utils/timerSound.ts` (a short descending three-note E6→A5→A4 in the same Web Audio timbre as the ticks — no shipped binary asset; the former `public/sfx/timer-end.mp3` was removed) and calls `onComplete?.()` once. Shared with the GM deadline timer (see [gamemaster-deadline-timer.md](gamemaster-deadline-timer.md))
- [x] Plays a countdown tick each second once `timeLeft ≤ 30`: a soft LOW tick (660 Hz) from 30s remaining, switching to a louder HIGH tick (1320 Hz) in the final 10 seconds, via `playTimerTick(high)` from the shared `src/utils/timerSound.ts`
- [x] Resetting the timer is done by changing the `seconds` prop value (or remounting via React key)
- [x] Visual state — **low**: time remaining ≤ 30% of initial `seconds`
- [x] Visual state — **critical**: time remaining ≤ 5 seconds
- [x] Visual state — **done**: timer has reached 0 and is no longer running; displays "Zeit abgelaufen!" instead of the countdown

## State / data changes
- No `AppState` changes — all state is local
- Component signature: `Timer({ seconds, onComplete?, running })`

## UI behaviour
- Component: `src/components/common/Timer.tsx`
- Displays remaining seconds as `Ns` (e.g. "30s")
- CSS classes reflect current state: `timer-display`, `timer-display--low`, `timer-display--critical`, `timer-display--done`
- Used by `SimpleQuiz` when a question has a `timer` field; the host decides what to do when time expires (no automatic question advance)

## Out of scope
- Automatic game or question advancement on expiry
- Configurable warning thresholds (fixed at 30% / 5 s)
- Count-up mode
