# Spec: Video Guess

## Goal
Teams watch a video clip played from a start marker to a question marker; the host reveals the answer (text), and optionally continues playback from the question marker to an end marker as a visual answer.

## Acceptance criteria
- [ ] Questions are defined in the game JSON file, like all other quiz types
- [ ] Each question has: `answer` (string), `video` (path to file in `/videos/` DAM), `videoStart` (seconds — where playback begins), `videoQuestionEnd` (seconds — where the clip pauses for the question), optional `videoAnswerEnd` (seconds — where the answer segment ends), optional `answerImage` (path to image shown on reveal), optional `audioTrack` (numeric audio-stream index override), optional `disabled` (boolean)
- [ ] Instance config may set a default `language` (ISO 639-2 code, e.g. `"deu"`, `"eng"`, `"fra"`). For every question without an explicit `audioTrack`, the effective audio track is the first audio stream whose ffprobe `language` tag matches. Per-question `audioTrack` always wins when set. If no matching track is found, playback falls back to the file's default audio stream.
- [ ] The first question is always treated as the example (not selectable)
- [ ] Video plays automatically when a question loads — from `videoStart` to `videoQuestionEnd`, then pauses
- [ ] On reveal (host advances): the answer text is shown; if `videoAnswerEnd` is set, playback resumes from `videoQuestionEnd` to `videoAnswerEnd`
- [ ] Host can replay the question clip via a button at any time before reveal
- [ ] Background music fades out when the rules phase starts (`onRulesShow`); fades back in when transitioning to the award-points phase after the last question (`onNextShow`)
- [ ] After the last question, calls `onGameComplete()`
- [ ] Admin preview uses `/videos-live/` for on-the-fly streaming (no pre-transcoding or caching needed) — the server handles HDR tone mapping and audio track selection via stream copy (SDR) or re-encode (HDR)
- [ ] Game frontend uses pre-cached routes (`/videos-compressed/`, `/videos-sdr/`, `/videos-track/`) for reliable playback
- [ ] Manual "Cache für Gameshow" button in admin generates the cached file for the trimmed segment before the live show
- [ ] Admin instance editor exposes a "Sprache (Standard)" picker for `video-guess` instances. The per-question language picker in `VideoGuessForm` visually indicates which track is selected by the instance default and distinguishes it from an explicit per-question override.
- [ ] Validator requires `questions` array with `answer` and `video` fields

## State / data changes
- No `AppState` changes — playback state is local
- Config type: `VideoGuessConfig` in `src/types/config.ts` gains `language?: string` (ISO 639-2 three-letter code; matches ffprobe stream tag)
- `VideoGuessQuestion`: `{ answer, video, videoStart?, videoQuestionEnd?, videoAnswerEnd?, answerImage?, audioTrack?, disabled? }`
- Questions defined in game JSON files under `games/`
- Server-side resolution: `loadGameConfig` in `server/index.ts` resolves `language` → `audioTrack` by probing each video (via existing `cachedProbe`) when the returned config reaches `/api/game/:index`. Explicit per-question `audioTrack` is never overwritten.
- Admin preview: `/videos-live/<path>?track=N` for on-the-fly streaming with audio track selection; original `/videos/<path>` when no track selected
- Game playback: pre-cached via `/videos-compressed/`, `/videos-sdr/`, or `/videos-track/` endpoints
- Cache generated manually via "Cache für Gameshow" button in admin editor. The cache URL uses the effective (resolved) track so instance-default language is honoured even when a question has no explicit `audioTrack`.

## UI behaviour
- Component: `src/components/games/VideoGuess.tsx`
- Single `<video>` element per question
- Question clip plays from `videoStart` (default 0) to `videoQuestionEnd` (pauses via timeupdate)
- On reveal: answer text shown below/above video; if `videoAnswerEnd` is set, video resumes from `videoQuestionEnd` to `videoAnswerEnd`; if `answerImage` is set, image displayed alongside answer text
- "Clip wiederholen" button replays the question segment (hidden after reveal)
- Navigation: ArrowRight reveals answer (first press) then advances to next question (second press); ArrowLeft un-reveals or goes back
- Back-navigation returns to previous question in revealed state with answer video segment playing

## Out of scope
- Admin backend form (can be added later)
- Score tracking per clip (handled by `AwardPoints` after the game)
