# Spec: Audio Trim (Start/End Time)

## Goal
Allow a start time and end time to be set on any `questionAudio` or `answerAudio` in Simple Quiz, so only the relevant segment of the audio file is played; the admin form shows an interactive timeline for setting these markers.

## Acceptance criteria

### Data
- [x] `SimpleQuizQuestion` gains four optional numeric fields (seconds): `questionAudioStart`, `questionAudioEnd`, `answerAudioStart`, `answerAudioEnd`
- [x] All four fields are optional; omitting them means play from the beginning / until the end

### Player (SimpleQuiz.tsx)
- [x] When `questionAudioStart` is set, audio begins playback from that position instead of 0
- [x] When `questionAudioEnd` is set, audio stops automatically when `currentTime` reaches that value
- [x] The restart button restarts from `questionAudioStart` (not from 0)
- [x] The timestamp display uses `questionAudioStart` as the "zero point" (e.g. `0:00 / 0:45` for a 45-second clip)
- [x] Same logic applies to `answerAudio` using `answerAudioStart` / `answerAudioEnd`

### Admin form (SimpleQuizForm.tsx)
- [x] The trim timeline is hidden by default; a "✂ Trimmen" toggle appears next to the audio field only when an audio file is set
- [x] Clicking the toggle expands/collapses the timeline
- [x] If `start` or `end` is already set on the question, the timeline is expanded automatically
- [x] The timeline renders a waveform (amplitude bars) for the full file duration using the Web Audio API
- [x] The region of the waveform outside the start/end markers is visually dimmed; the selected region is highlighted
- [x] A playback cursor moves across the waveform during preview playback
- [x] While zoomed, the view auto-pans to keep the playback cursor visible. Once the user manually pans (trackpad scroll, wheel zoom, or minimap drag/click), auto-pan is suspended so the cursor can drift off-screen without the view jumping back. Auto-pan re-engages automatically as soon as the cursor is back inside the visible area — whether the user panned back to it or playback caught up — and also on explicit re-center actions (play button, canvas-click seek, jump button, zoom button)
- [x] A draggable **start marker** (left handle, optional) lets the user set `questionAudioStart` / `answerAudioStart`
- [x] A draggable **end marker** (right handle, optional) lets the user set `questionAudioEnd` / `answerAudioEnd`
- [x] Clicking anywhere on the timeline seeks the preview audio to that position
- [x] Inline transport controls let the host preview audio directly in the admin form: **play/pause**, **jump to file start** (seeks to 0:00), and **jump to start marker** (seeks to `start`; button disabled/hidden when no start marker is set)
- [x] Clearing the audio file clears the start/end values for that audio field too
- [x] The start/end times are shown numerically (e.g. `0:05 → 0:50`) next to or below the timeline
- [x] Compact badge in collapsed question view shows trim indicator if start or end is set (e.g. `🎵Q ✂`)

## State / data changes
- Type changes in `src/types/config.ts` → `SimpleQuizQuestion`:
  - `questionAudioStart?: number`
  - `questionAudioEnd?: number`
  - `answerAudioStart?: number`
  - `answerAudioEnd?: number`
- No `AppState` changes — these are config fields only
- Persisted: yes (in game JSON via the admin save flow)

## UI behaviour

### Timeline widget (admin)
- The `AudioTrimTimeline` is **collapsed by default** — not shown even when an audio file is set
- A small "✂ Trimmen" toggle button appears next to the audio field label only when an audio file is selected; clicking it expands the timeline
- Once expanded, the timeline stays visible until the user collapses it or clears the audio file
- If `start` or `end` is already set on a question, the timeline is **expanded automatically** so the values are visible
- Self-contained component: `AudioTrimTimeline` (in `src/components/backend/`)
- Props: `src: string`, `start?: number`, `end?: number`, `onChange: (start: number | undefined, end: number | undefined) => void`
- The widget decodes the audio file with the Web Audio API (`AudioContext.decodeAudioData`) and renders a **waveform** onto a `<canvas>` element (downsampled amplitude bars)
- The waveform fills the full file duration; the region outside the start/end markers is dimmed
- Dragging the start handle sets the start marker; dragging the end handle sets the end marker
- Either marker can be removed (reset to undefined) by double-clicking or a small ✕ button
- Timeline bar is fully interactive with mouse; no need for touch/mobile support in admin

### Player timeline display
- Existing timestamp `currentTime / duration` is adjusted: displayed time = `currentTime - (start ?? 0)`, displayed duration = `(end ?? duration) - (start ?? 0)`

## Out of scope
- ~~Waveform visualisation~~ (included, see UI behaviour)
- Touch/mobile drag support in admin timeline
- Trim support for game types other than Simple Quiz
- Crossfading at trim boundaries
