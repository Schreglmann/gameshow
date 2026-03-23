# Skill: Add New Game Type

You are helping the user add a new game type to the gameshow project. Follow the mandatory spec-driven workflow: **spec first, then code**.

---

## Phase 1 — Gather requirements

Before writing anything, ask the user for:

1. **Game type slug** (kebab-case, e.g. `hot-seat`) — becomes the JSON `type` value and file names
2. **Component name** (PascalCase, e.g. `HotSeat`) — becomes the React component and TypeScript interface prefix
3. **Game concept** — how the game plays, what teams do, how a round works, how scoring works
4. **Questions source** — JSON (`questions[]` array) or filesystem (audio files / images)?
5. **Question fields** — what data does each question need? Which fields are optional?
6. **Special behaviour** — any progressive reveal, timer, inline scoring, team betting, or other non-standard mechanics?

Do not proceed to Phase 2 until you have clear answers to all of the above.

---

## Phase 2 — Write the spec (PAUSE for user review)

Create `specs/games/<type>.md` with this exact structure:

```markdown
# Spec: <Name>

## Goal
One sentence: what teams do and why it's fun.

## Acceptance criteria
- [ ] <observable, testable behaviour>
- [ ] <observable, testable behaviour>
- [ ] ...

## State / data changes
- No `AppState` changes  (or: describe any new AppState fields needed)
- Config type: `<Name>Config` in `src/types/config.ts`
- Question type: `<Name>Question`
  - `fieldName: type` — description
  - `optionalField?: type` — description (optional)

## UI behaviour
- Component: `src/components/games/<Name>.tsx`
- <Describe the reveal flow, keyboard navigation, what host/teams see>
- Edge cases: <list edge cases>

## Out of scope
- <Things explicitly NOT included>
```

Then add a row to `specs/README.md` under "Game types":
```markdown
| <Name> | [games/<type>.md](games/<type>.md) | 🗂 Planned |
```

**STOP HERE.** Show the spec to the user and ask them to confirm it before proceeding to implementation. The spec is the contract — do not diverge from it silently.

---

## Phase 3 — Implement (8 steps, in order)

Only proceed after the user confirms the spec.

### Step 1 — Types (`src/types/config.ts`)

Add in the appropriate location (grouped with other game types):

```typescript
export interface <Name>Question {
  fieldName: string;
  optionalField?: string;
}

export interface <Name>Config extends BaseGameConfig {
  type: '<type>';
  questions: <Name>Question[];
}
```

Also add:
- `'<type>'` to the `GameType` union
- `<Name>Config` to the `GameConfig` union

Use `import type` for type-only imports throughout.

### Step 2 — Component (`src/components/games/<Name>.tsx`)

Rules:
- **Must** wrap in `<BaseGameWrapper>` — it owns phase transitions (landing → rules → game → points → next)
- **Must** call `onGameComplete()` after the last question (not `onNextGame`)
- Use `randomizeQuestions()` utility from `@/utils` if question shuffling is needed
- All player-facing text must be in **German** — no English strings in the UI
- Follow the same props interface: `GameComponentProps` from `@/components/games/types`

Pattern to follow: `src/components/games/FourStatements.tsx` (progressive reveal) or `src/components/games/SimpleQuiz.tsx` (simple reveal).

### Step 3 — Register (`src/components/games/GameFactory.tsx`)

Add a `case` in the switch statement:
```typescript
case '<type>':
  return <Name>;
```

### Step 4 — Server (`server/index.ts`)

Only needed for **filesystem-based** games (audio or image questions). For JSON-backed games, skip this step — the server merges instance data automatically.

If needed, follow the `audio-guess` pattern: scan the filesystem folder and build the `questions` array dynamically.

### Step 5 — Validator (`validate-config.ts`)

Add `'<type>'` to the `VALID_GAME_TYPES` array/set.

### Step 6 — Template (`games/_template-<type>.json`)

```json
{
    "type": "<type>",
    "title": "SPIELNAME",
    "rules": [
        "Regel 1",
        "Regel 2"
    ],
    "instances": {
        "template": {
            "title": "SPIELNAME (Template)",
            "questions": [
                {
                    "requiredField": "PFLICHTFELD",
                    "optionalField": "OPTIONALES FELD"
                },
                {
                    "requiredField": "PFLICHTFELD (ohne optionale Felder)"
                }
            ]
        }
    }
}
```

Rules:
- Use ALL-CAPS placeholders (e.g. `"SPIELNAME"`, `"FRAGE"`, `"ANTWORT"`)
- Always use the multi-instance structure with a `"template"` instance
- Include one question with every optional field, and one with only required fields
- This file is excluded from validation — never reference it in `gameOrder`

### Step 7 — Docs

**`GAME_TYPES.md`** — Add a new numbered section at the end, matching the style of existing sections:
- **Description**: what the game is
- **Configuration Example**: minimal valid JSON
- **Supported fields** (with types): list every question field, mark required vs optional
- **Optional Features**: one sub-section per optional field, with a JSON example
- **How to Play**: brief host instructions

**`AGENTS.md` §5** — Add a row to the game types reference table:
```markdown
| `<type>` | JSON `questions[]` | `AwardPoints` |
```
(Adjust "questions source" and "points awarded by" columns to match the actual behaviour.)

### Step 8 — Tests (`tests/unit/games/<Name>.test.tsx`)

Follow the pattern from `tests/unit/games/FourStatements.test.tsx` or `SimpleQuiz.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import <Name> from '@/components/games/<Name>';
import type { <Name>Config } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: false, globalRules: [] }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const defaultProps = {
  gameId: 'test-game',
  currentIndex: 0,
  totalGames: 3,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(overrides: Partial<<Name>Config> = {}): <Name>Config {
  return {
    type: '<type>',
    title: 'Test',
    questions: [ /* minimal test question */ ],
    ...overrides,
  };
}

function render<Name>(config?: <Name>Config) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <<Name> {...defaultProps} config={config ?? makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

describe('<Name>', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders initial state', () => { /* ... */ });
  it('main interaction flow works', async () => { /* ... */ });
  it('calls onNextGame after last question', async () => { /* ... */ });
  it('handles optional fields', () => { /* ... */ });
});
```

Cover:
- Initial render (what is visible on first load)
- Core interaction flow (advancing through questions, reveal)
- `onNextGame` / `onAwardPoints` called at the right time
- Any optional fields (if present in config, they display correctly; if absent, no crash)

---

## Phase 4 — Update spec status

After all 8 steps are done:

1. Tick every acceptance criterion in `specs/games/<type>.md` — change `- [ ]` to `- [x]`
2. Update `specs/README.md` row from `🗂 Planned` to `✅ Implemented`

---

## Phase 5 — Verify

Run in this order:

```bash
npm run validate   # checks all game JSON files — must pass cleanly
npm test           # unit + integration tests — all must pass
```

Fix any failures before declaring the task complete.

---

## Conventions to never skip

| Rule | Detail |
|------|--------|
| Spec first | Write spec → confirm → then code. Never the reverse. |
| German UI | All player-facing text in German. No English strings in components. |
| BaseGameWrapper | Every game component must use it. It owns phase transitions. |
| Point values | Always `currentIndex + 1`. Never hardcode a number. |
| Template prefix | `_template-` files are excluded from validation. Never reference in `gameOrder`. |
| Validate after JSON | Run `npm run validate` after any change to a game file. |
| Type imports | Use `import type { ... }` for type-only imports. |
| No derived state | Compute from raw state at read time — never store computed values in state. |
