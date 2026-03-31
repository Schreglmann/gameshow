# Specs

This directory contains spec-driven development specifications for every feature in this gameshow app.

**Rule:** write or read the relevant spec before writing any code. See `AGENTS.md §3` for the full workflow.

---

## Index

### Core features

| Spec | File | Status |
|------|------|--------|
| App navigation flow | [app-navigation-flow.md](app-navigation-flow.md) | ✅ Implemented |
| Team management | [team-management.md](team-management.md) | ✅ Implemented |
| Point system | [point-system.md](point-system.md) | ✅ Implemented |
| Config system | [config-system.md](config-system.md) | ✅ Implemented |
| Config validation | [config-validation.md](config-validation.md) | ✅ Implemented |
| Config generation | [config-generation.md](config-generation.md) | ✅ Implemented |
| Base game wrapper | [base-game-wrapper.md](base-game-wrapper.md) | ✅ Implemented |
| Background music | [background-music.md](background-music.md) | ✅ Implemented |
| Admin screen | [admin-screen.md](admin-screen.md) | ✅ Implemented |
| Game planning | [game-planning.md](game-planning.md) | ✅ Implemented |
| Media encryption | [media-encryption.md](media-encryption.md) | ✅ Implemented |
| Keyboard navigation | [keyboard-navigation.md](keyboard-navigation.md) | ✅ Implemented |
| Header | [header.md](header.md) | ✅ Implemented |
| Lightbox | [lightbox.md](lightbox.md) | ✅ Implemented |
| Timer | [timer.md](timer.md) | ✅ Implemented |
| Audio normalization | [audio-normalization.md](audio-normalization.md) | ✅ Implemented |
| Audio trim (start/end time) | [audio-trim.md](audio-trim.md) | ✅ Implemented |
| Video DAM | [video-dam.md](video-dam.md) | Planned |
| Bidirectional asset sync | [sync-bidirectional.md](sync-bidirectional.md) | ✅ Implemented |

### Game types

| Spec | File | Status |
|------|------|--------|
| Simple quiz | [games/simple-quiz.md](games/simple-quiz.md) | ✅ Implemented |
| Audio guess | [games/audio-guess.md](games/audio-guess.md) | ✅ Implemented |
| Guessing game | [games/guessing-game.md](games/guessing-game.md) | ✅ Implemented |
| Final quiz | [games/final-quiz.md](games/final-quiz.md) | ✅ Implemented |
| Four statements | [games/four-statements.md](games/four-statements.md) | ✅ Implemented |
| Fact or fake | [games/fact-or-fake.md](games/fact-or-fake.md) | ✅ Implemented |
| Quizjagd | [games/quizjagd.md](games/quizjagd.md) | ✅ Implemented |

---

## How to write a new spec

1. Create `specs/<feature-slug>.md` (or `specs/games/<type>.md` for a new game type)
2. Use the template below
3. Add a row to the index above with status `Planned`
4. Get the spec reviewed before starting implementation
5. Tick off criteria as they are met
6. Update status to `✅ Implemented` when all criteria are met

### Spec template

```markdown
# Spec: <Feature Name>

## Goal
One sentence describing what this feature does and why.

## Acceptance criteria
- [ ] Criterion 1 (observable, testable behaviour)
- [ ] Criterion 2
- [ ] ...

## State / data changes
- New field in AppState: `myField: string`
- New API endpoint: `POST /api/something` → `{ result: string }`
- Persisted to localStorage: yes / no

## UI behaviour
- Screen / component affected: `SummaryScreen`
- What the user sees: ...
- Edge cases: ...

## Out of scope
- Things explicitly NOT included in this feature
```
