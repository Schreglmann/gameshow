# Spec: Simple Quiz

## Goal
A standard question-and-answer game where the host reads a question aloud, then reveals the answer — optionally accompanied by images, audio, a list of answers, or a countdown timer.

## Acceptance criteria
- [x] Displays one question at a time; the host manually advances through questions
- [x] Question text is shown first; answer is hidden until the host reveals it
- [x] Optional `info`: small-font subtitle rendered above the question text (e.g. "Reihenfolge")
- [x] Optional `questionImage`: shown alongside the question before reveal
- [x] Optional `answerImage`: shown after reveal (replaces `questionImage` if `replaceImage` is true)
- [x] Optional `questionAudio`: plays when question is shown and **keeps playing** while the answer is shown; if the question also has `answerAudio` that refers to a different file, question audio is stopped immediately (not faded) when the answer is revealed
- [x] Optional `answerAudio`: plays automatically when the answer is revealed; if it refers to a different file than `questionAudio`, the question audio is stopped immediately to hand over
- [x] When `questionAudio` and `answerAudio` reference the **same file**, playback continues on reveal instead of restarting — the existing audio element keeps playing from its current position, and answer-side `answerAudioEnd` / `answerAudioLoop` settings take over. `answerAudioStart` is ignored in this case (the point is to continue, not jump)
- [x] Optional `answerList`: displays a list of accepted answers instead of a single answer string
- [x] When advancing to the next question, both question and answer audio are **cut immediately** (no fade)
- [x] When navigating **backwards** (ArrowLeft):
  - From an answer view: stop the answer audio, restart the question audio from the beginning (or `questionAudioStart`)
  - From a question view to the previous answer view: stop the current question audio and start only the previous question's answer audio — no overlap between the previous question's question and answer tracks
- [x] After the last question, audio keeps playing through the award-points phase; it fades out (~2 s) when the landing/title screen of the next game is shown, at which point background music fades back in (~3 s)
- [x] If the game contains no audio questions at all, background music is never touched — it plays uninterrupted
- [x] Optional `questionColors`: displays one or more colored boxes (defined by hex codes) below the question text
- [x] Optional `timer`: shows a countdown timer (seconds); timer starts when question is displayed
- [x] When the timer reaches 0 and the question has a `questionAudio`, the question audio is paused (playback stops at its current position)
- [x] Questions can be randomised if `randomizeQuestions: true` in the game config
- [x] When `randomizeQuestions` is true, the first question is kept as-is (serves as an example)
- [x] Optional `questionLimit`: limits the number of questions shown (excluding the example). When `randomizeQuestions` is true, a random subset of `questionLimit` questions is shown. When false, the first `questionLimit` questions are shown. The example question is always included on top.
- [x] After the last question, calls `onGameComplete()`

## State / data changes
- No `AppState` changes — question progression is local component state
- Config type: `SimpleQuizConfig` in `src/types/config.ts` (inherits `questionLimit?: number` from `BaseGameConfig`)
- Question type: `SimpleQuizQuestion`
  - `question: string`
  - `answer: string`
  - `info?: string`
  - `questionImage?: string`
  - `answerImage?: string`
  - `questionAudio?: string`
  - `answerAudio?: string`
  - `answerList?: string[]`
  - `questionColors?: string[]`
  - `timer?: number`
  - `replaceImage?: boolean`

## UI behaviour
- Component: `src/components/games/SimpleQuiz.tsx`
- Question card with reveal button; clicking/pressing Space reveals answer
- Image displayed below question text (lightbox-zoomable)
- `questionColors` renders as a row of colored boxes (`.color-swatch`) below the question text; each box fills with the given hex color
- Timer counts down visually; no automatic action when it hits 0 (host decides)
- `questionAudio` shows a play/pause and restart button with a timestamp; audio plays automatically on question load
- Background music fades out at the rules screen (if any question has audio); audio plays uninterrupted through the game; audio cuts between questions; after the last question audio lingers through award points then fades at the next game's landing screen

## Admin behaviour (SimpleQuizForm)
- The optional "Zusatzinfo" field is edited in the expanded options panel (not in the collapsed row)
- Colors are edited in the optional section under "Farben (Hex-Code)"
- Each color entry shows a clickable swatch (opens the native color picker) and a text input
- Text input validates on blur: valid `#rrggbb` values are committed; invalid values show an error toast and revert to the last valid value
- Compact badge view shows small colored squares when a question has colors set

## Out of scope
- Automatic answer checking or scoring
- Team buzzers
- Rich text / markdown in questions
