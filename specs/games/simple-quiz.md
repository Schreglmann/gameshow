# Spec: Simple Quiz

## Goal
A standard question-and-answer game where the host reads a question aloud, then reveals the answer — optionally accompanied by images, audio, a list of answers, or a countdown timer.

## Acceptance criteria
- [x] Displays one question at a time; the host manually advances through questions
- [x] Question text is shown first; answer is hidden until the host reveals it
- [x] Optional `questionImage`: shown alongside the question before reveal
- [x] Optional `answerImage`: shown after reveal (replaces `questionImage` if `replaceImage` is true)
- [x] Optional `questionAudio`: plays when question is shown; fades out when answer is revealed; background music fades back in
- [x] Optional `answerAudio`: plays automatically when the answer is revealed
- [x] Optional `answerList`: displays a list of accepted answers instead of a single answer string
- [x] Optional `timer`: shows a countdown timer (seconds); timer starts when question is displayed
- [x] Questions can be randomised if `randomizeQuestions: true` in the game config
- [x] When `randomizeQuestions` is true, the first question is kept as-is (serves as an example)
- [x] After the last question, calls `onGameComplete()`

## State / data changes
- No `AppState` changes — question progression is local component state
- Config type: `SimpleQuizConfig` in `src/types/config.ts`
- Question type: `SimpleQuizQuestion`
  - `question: string`
  - `answer: string`
  - `questionImage?: string`
  - `answerImage?: string`
  - `questionAudio?: string`
  - `answerAudio?: string`
  - `answerList?: string[]`
  - `timer?: number`
  - `replaceImage?: boolean`

## UI behaviour
- Component: `src/components/games/SimpleQuiz.tsx`
- Question card with reveal button; clicking/pressing Space reveals answer
- Image displayed below question text (lightbox-zoomable)
- Timer counts down visually; no automatic action when it hits 0 (host decides)
- Audio controls fade gracefully with background music

## Out of scope
- Automatic answer checking or scoring
- Team buzzers
- Rich text / markdown in questions
