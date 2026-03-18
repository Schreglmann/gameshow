# Spec: Timer

## Goal
A reusable countdown component gives the host and teams a visible time limit for questions that have an optional `timer` field.

## Acceptance criteria
- [x] Counts down from `seconds` prop to `0` at one-second intervals
- [x] Countdown only runs when `running` prop is `true`; pauses immediately when `running` becomes `false`
- [x] On expiry (reaching 0): plays `/audio/timer-end.mp3` and calls `onComplete?.()` once
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
