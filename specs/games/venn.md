# Spec: Venn (Schnittmenge)

## Goal
Two overlapping circles each carry a category, and the teams name the term that belongs to both; an optional third circle is a hint.

## Acceptance criteria
- [x] Questions are defined in the game JSON with `sets` (2–3 category names), `answer`, and optional `answerImage`, `gmInfo`, `disabled`
- [x] A question opens with the first two circles, their category names, and a `?` in the overlap
- [x] If the question has a third set, the next host advance adds it as a hint circle below the other two; the `?` slides into the area all three share
- [x] The hint circle is visibly a hint: dashed outline and the theme's gold colour for circle and label
- [x] The next host advance reveals the answer: the `?` becomes the answer in a pill, the answer line appears below the diagram with the optional `answerImage`
- [x] A question with two sets goes from the open puzzle straight to the answer
- [x] Back navigation mirrors the forward steps: answer → hint circle → the two starting circles → previous question, shown solved with every circle
- [x] Holding ArrowRight/Space (≥500 ms) or the gamemaster "Auflösung" button (`venn-reveal`) jumps to the answer with every circle
- [x] Category names stand outside the circles (above the upper two, below the third). A name longer than 14 characters breaks into two lines at a space or after a hyphen; a name without a break point stays on one line and is set smaller
- [x] A label is centered on its circle where that fits and pushed outward only as far as needed to clear the other label and the canvas edge
- [x] The diagram's height follows the number of sets the question has, not the number on screen, so nothing below it moves when the hint circle arrives
- [x] The diagram is sized by width alone (height cap `60vh`, at most 760 px), like the compass rose; type sizes are SVG user units, so there are no breakpoints
- [x] Colours come from the theme: circles tinted with `--primary-rgb`, outlines and labels in the card text colour, the hint in `--card-gold`, the answer pill in the success colour of `.quiz-answer`
- [x] Animations (circles scale in, labels fade, `?` and answer pop) are skipped under `prefers-reduced-motion`; every keyframe animates from a hidden state to the normal styling
- [x] Play index 0 is the `Beispiel` question; the counter reads `Frage N von M` for the rest
- [x] Honors `randomizeQuestions` + `questionLimit` via `useQuestionOrder` and tracks the position with `useLiveQuestionIndex`; `disabled` questions are filtered; per-question state is keyed on `qKey`
- [x] After the last answer, calls `onGameComplete()`; points via `AwardPoints`, scorable at 0–4 teams, feeds the correct-answer tally
- [x] Gamemaster card: the prompt, the answer, and the categories as a clickable hint list with a `revealed` flag each. A click on category N sends `hint-<N>` and shows exactly circles 1…N with the answer hidden — clamped to at least the two starting circles
- [x] The gamemaster's next-question preview shows the next question's two starting categories joined by `∩`
- [x] Validator: `sets` is an array of 2 or 3 non-empty strings, `answer` a non-empty string
- [x] Admin form: three category slots (the third labelled as hint and optional), answer, answer image, GM note, and a live preview of the diagram once two categories are filled in

## State / data changes
- No `AppState` changes, no new API route, no new WebSocket channel
- New types in `src/types/config.ts`: `VennQuestion`, `VennConfig`; `'venn'` joins the `GameType` union and `VennConfig` the `GameConfig` union

```ts
export interface VennQuestion extends GmInfoField {
  sets: string[];      // 2-3 category names; the third is the hint circle
  answer: string;
  answerImage?: string;
  disabled?: boolean;
}
```

## UI behaviour
- Show component: `src/components/games/Venn.tsx`, wrapped in `BaseGameWrapper`
- Diagram: `src/components/common/VennDiagram.tsx`, a pure inline SVG; geometry in `src/utils/vennLayout.ts`. Both live outside `games/` so the admin preview and the theme showcase reuse them without pulling in `BaseGameWrapper`
- Prompt on screen: "Welcher Begriff passt in alle Kategorien?" (fixed)
- Rules: Archetype B (or its preset `simultaneous-race`) with a task line that names the hint — see `specs/rules-standard.md`
- Authoring: the first two sets must already have one clear answer for an attentive team; the third only narrows it. Every set must really contain the answer (a hint like "Britische Komikertruppe" for "Python" does not — the troupe is called Monty Python)

## Out of scope
- More than three circles
- A per-question prompt
- Showing terms in the areas outside the overlap
- Points that depend on whether the hint was used
