# Skill: New Spec

You are helping the user write a spec for a new feature or component in the gameshow project. Follow the spec-driven workflow from AGENTS.md §3: **spec first, then code**.

---

## Phase 1 — Categorize & gather requirements

First, ask the user what kind of thing they are speccing:

- **feature** — new user-facing behaviour (state changes, API routes, screen-level UI)
- **component** — reusable UI piece used by multiple features (defined props, visual states)
- **game type** — stop here and redirect: "Use `/add-gametype` instead — it handles game type specs and implementation together."

Do not assume the category from context alone — ask explicitly if it is not clear.

Once the category is confirmed, ask the following questions. Collect all answers before proceeding to Phase 2.

**All categories:**
1. **Slug** — kebab-case name for the file (e.g. `keyboard-navigation`, `score-display`)
2. **Goal** — one sentence: what it does and why
3. **Key behaviours** — list the observable outcomes the feature must produce (these become acceptance criteria)
4. **Out of scope** — what is explicitly excluded from this feature?

**Feature only (in addition to the above):**
5. **State changes** — any new `AppState` fields? New `Action` types? New API endpoints? New `localStorage` keys?
6. **Components / screens affected** — which existing files change, and are any new ones created?

**Component only (in addition to the above):**
5. **Props** — what does the component accept? Which are required vs optional?
6. **Visual states** — what distinct states does it render (e.g. loading, empty, error, active)?
7. **Consumers** — which existing components or screens will use it?

Do not proceed to Phase 2 until you have clear answers to all relevant questions.

---

## Phase 2 — Write the spec (PAUSE for user review)

Create the spec file and update the index.

### File location

- `specs/<slug>.md` for features and components

### Feature template

```markdown
# Spec: <Name>

## Goal
One sentence.

## Acceptance criteria
- [ ] <observable, testable behaviour>
- [ ] <observable, testable behaviour>
- [ ] ...

## State / data changes
- AppState: <new fields, or "No AppState changes">
- Actions: <new Action union members, or "None">
- API: <new endpoints, or "None">
- localStorage: <keys and format, or "Not persisted">

## UI behaviour
- Components affected: `<path/to/Component.tsx>`
- <Describe interaction flow step by step>
- Edge cases: <list edge cases>

## Out of scope
- <explicit exclusion>
- <explicit exclusion>
```

### Component template

```markdown
# Spec: <Name>

## Goal
One sentence.

## Acceptance criteria
- [ ] <observable, testable behaviour>
- [ ] <observable, testable behaviour>
- [ ] ...

## Props / interface
- `propName: type` — description
- `optionalProp?: type` — description (optional)

## Visual states
- Default: <what renders normally>
- <State name>: <what renders in this state>
- Edge cases: <list edge cases>

## Usage
- Used by: <list components / screens>

## Out of scope
- <explicit exclusion>
```

### Update the index

Add a row to `specs/README.md` in the "Core features" section (or create a new section if appropriate):

```markdown
| <Name> | [<slug>.md](<slug>.md) | 🗂 Planned |
```

### STOP HERE

Show the spec to the user and ask them to confirm it before any implementation begins. The spec is the contract — implementation must not diverge from it silently.

---

## Phase 3 — Confirm & hand off

Once the user confirms the spec:

- Implementation must follow the spec exactly
- If scope changes during implementation, update the spec first — never diverge silently
- When implementation is complete:
  1. Tick every acceptance criterion: `- [ ]` → `- [x]`
  2. Update `specs/README.md` status to `✅ Implemented`

---

## Conventions

| Rule | Detail |
|------|--------|
| Spec first | Never write implementation code before the spec is confirmed |
| Acceptance criteria | Must be observable and testable — not vague intentions |
| State section | Always explicit: state "No AppState changes" or "Not persisted" rather than omitting |
| Out of scope | Always include at least one item — it prevents silent scope creep |
| German UI | If the spec describes player-facing text, all examples must be in German |
| Game types | Use `/add-gametype` instead — it handles the full spec + implementation workflow |
