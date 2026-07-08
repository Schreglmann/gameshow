# Spec: Four Statements (clue-based)

## Goal
Host reveals up to four clue-statements one at a time about a target concept; teams guess the answer, then host reveals it (text and/or image).

## Naming note
A previous game type named `four-statements` (find the false statement out of 3-true-1-false) was renamed to `q1` when this new clue-based mode was introduced. See [specs/games/q1.md](q1.md).

## Acceptance criteria
- [ ] Starts with **0** statements visible — only the topic/prompt is shown
- [ ] Each host advance reveals the next statement (1 → 2 → 3 → ...); previously revealed statements stay visible in order
- [ ] Each question has up to 4 statement slots. Empty slots are skipped (not rendered, not counted in the reveal sequence); at least one non-empty is required. After the last non-empty statement is revealed, one more advance shows the answer
- [ ] Answer can be: text only, image only, or both. At least one must be present — validator enforces
- [ ] Optional **answer audio**: when set, the audio auto-plays the moment the answer is revealed (e.g. the song in a Songtext quiz). Optional `answerAudioStart` / `answerAudioEnd` trim it; `answerAudioLoop` loops the trimmed segment. Audio **stops** as soon as the answer is left — advancing to the next question, navigating Back off the answer, or leaving the game all pause it (unlike simple-quiz, where answer audio bleeds across questions)
- [ ] When any question has `answerAudio`, background music fades out (~2 s) at the rules screen and fades back in (~3 s) when the game is left (award-points / next game), exactly like simple-quiz; the answer track is faded out on the way out so it never competes with the playlist. If no question has audio, background music is never touched
- [ ] The answer image can be **linked to the answer-audio cover**: the admin form offers a "🔗 Cover" button next to "Antwort-Bild" that fills `answerImage` with the audio's derived cover path (`/images/Audio-Covers/<audio-basename>.jpg`); once linked it shows a "🔗 Cover-verknüpft" badge (same pattern as simple-quiz). The frontend renders the answer image through `useCoverUrl()` so a swapped cover is cache-busted
- [ ] Host can navigate backwards (ArrowLeft) to un-reveal the answer, un-reveal a statement, or return to the previous question
- [ ] Holding the forward key (ArrowRight **or** Space) jumps straight to the full solution — all clues **and** the answer revealed at once (same interaction as Bandle's jump-to-answer); a short tap still advances one step. The hold is detected via OS key-repeat or a ≥500 ms timer, whichever comes first (robust against presenter clickers that send an early keyup). Works both on the show's local keyboard and via the gamemaster remote (a held forward key there arrives as `nav-forward-long`)
- [ ] The gamemaster remote shows an **"Auflösung"** button (control id `four-statements-reveal`, primary variant) that jumps straight to the full solution — all clues **and** the answer revealed at once, identical to the long-press. It is marked active once the answer is shown (mirrors Bandle's reveal button)
- [ ] Works across multiple questions; after the last answer, advance calls `onGameComplete()`
- [ ] Uses `BaseGameWrapper`; points awarded via `AwardPoints` (host picks winner) — point value = `currentIndex + 1`
- [ ] Gamemaster sync publishes `answer`, `answerImage`, and `extraInfo: "Hinweis N/M"`

## State / data changes
- No `AppState` changes
- Config type: `FourStatementsConfig` (`type: 'four-statements'`) in [`src/types/config.ts`](../../src/types/config.ts)
- Question type: `FourStatementsQuestion`:
  - `topic: string` — prompt shown at top
  - `statements: string[]` — up to 4 entries; empty strings are allowed and represent empty slots (skipped at render). At least one non-empty entry is required
  - `answer?: string` — text label
  - `answerImage?: string` — DAM-relative image path
  - `answerAudio?: string` — DAM-relative audio path; auto-plays on answer reveal
  - `answerAudioStart?: number` / `answerAudioEnd?: number` — trim bounds in seconds
  - `answerAudioLoop?: boolean` — loop the trimmed segment
  - `disabled?: boolean`
  - Invariant: at least one of `answer` / `answerImage` must be set (`answerAudio` is supplementary, not a substitute)

## UI behaviour
- Component: [`src/components/games/FourStatements.tsx`](../../src/components/games/FourStatements.tsx)
- Topic displayed at top with `.quiz-question` styling
- Statements rendered in order using existing `.statements-container` / `.statement` CSS classes (shared with Q1)
- Each statement gets a small numeric prefix (1., 2., ...)
- No shuffle — statement order is the JSON order
- Answer block: if `answer` → text card (`rgba(74,222,128,0.2)` background, same "Lösung" style as Q1's "Gesuchter Begriff"); if `answerImage` → `<img className="quiz-image">` below the text
- Long-press detection uses the shared [`useArrowRightLongPress`](../../src/hooks/useArrowRightLongPress.ts) hook (capture-phase listeners; hold detected via OS key-repeat or a 500 ms timer; forward key is ArrowRight or Space): a held forward key reveals all clues + the answer, a short tap falls through to the normal "advance one" handler. The hook is disabled once the answer is shown so a press then advances to the next question. The gamemaster's `nav-forward-long` command is routed to the same reveal-all action via the component's command handler (mirrors `bandle` and `ranking`)
- Admin form: [`src/components/backend/questions/FourStatementsForm.tsx`](../../src/components/backend/questions/FourStatementsForm.tsx). Always shows all 4 statement inputs as a 2×2 grid (via the existing 2-col `.question-fields` grid) — no add/remove buttons. Empty inputs persist as empty strings and simply aren't rendered in the game. Image picked via shared `AssetField` (DAM), with a "🔗 Cover" button (shown when an answer audio is set and the image isn't already the derived cover) that links `answerImage` to the answer-audio cover — identical to `SimpleQuizForm`. Answer audio picked via shared `AssetField` (`category="audio"`) with a "✂ Trimmen" toggle revealing an `AudioTrimTimeline` for start/end/loop — same control group as `SimpleQuizForm`

## Out of scope
- Per-team device guessing
- More than 4 statements
- Timed auto-reveal
- True/false semantics on individual statements (that's `q1`)
