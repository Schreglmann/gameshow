# Modular Gameshow System

> **Editing convention:** every file shown below — `config.json`, `games/*.json`, asset folders — is meant to be edited through the **Admin Panel** at `http://localhost:3000/admin`. The admin validates as you type, catches missing fields and broken references, and saves to disk for you. Hand-editing these files is only required for bulk edits, scripted migrations, or when working on the codebase itself. See [docs/admin-guide.md](docs/admin-guide.md).

## Overview

The gameshow is fully modular and config-driven. Games are stored as individual JSON files in `games/`, and the main `config.json` defines gameshows and selects which one is active via `activeGameshow`.

## Architecture

### Config Structure

```
config.json              ← Defines all gameshows + selects active one + settings
games/
  allgemeinwissen.json   ← One file per game concept
  trump-oder-hitler.json
  quizjagd.json
  audio-guess.json
  ...
```

### `config.json` — Gameshow Selector

```json
{
  "showTitle": "Sommerfest Quiz",
  "pointSystemEnabled": true,
  "teamRandomizationEnabled": true,
  "jokersInLastGame": false,
  "globalRules": [
    "Es gibt mehrere Spiele.",
    "Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.",
    "Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.",
    "Das Team mit den meisten Punkten gewinnt am Ende."
  ],
  "activeGameshow": "gameshow1",
  "gameshows": {
    "gameshow1": {
      "name": "Gameshow 1",
      "showTitle": "Sommerfest Quiz 2026",
      "teamCount": 2,
      "pointMode": "positional",
      "gameOrder": [
        "allgemeinwissen/v1",
        "audio-guess",
        "trump-oder-hitler",
        "quizjagd/v2"
      ]
    },
    "gameshow2": {
      "name": "Gameshow 2",
      "gameOrder": [
        "emoji-raten",
        "q1/v2",
        "quizjagd/v1"
      ]
    }
  }
}
```

**Top-level Settings:**
- `showTitle` — What the show calls itself: the `HomeScreen` heading, the gamemaster's start/summary label and the browser tab title. A gameshow can override it with its own `showTitle`; blank/omitted at both levels means `"Game Show"`. Editable in the admin (Konfiguration tab globally, Gameshows tab per show) — see [specs/show-title.md](specs/show-title.md)
- `pointSystemEnabled` — Enable/disable the point system (default: `true`). When `false` the show has **no teams**: no scores are shown or awarded, the `HomeScreen` drops the team overview/assignment for a bare "Zum Starten klicken" start prompt, jokers are auto-disabled (`enabledJokers` served empty), and **every** game becomes a pure play-through — the inline-scored games (BetQuiz, Quizjagd, FinalQuiz, WerKenntMehr) hide their bet/point/scoring UI and advance with a plain "Weiter" (see [specs/point-system.md](specs/point-system.md))
- `gameshows[key].teamCount` — how many teams this gameshow is played with (`0`–`4`, default `2`). `0` means no teams at all, exactly like the global `pointSystemEnabled: false`; `1` keeps the point system but still has no team assignment or randomization — the audience plays against the show. A game type whose mechanic cannot be scored at that count still plays, just without scoring — see [specs/team-count.md](specs/team-count.md)
- `gameshows[key].showTitle` — overrides the global `showTitle` while this gameshow is active (blank/omitted inherits it) — see [specs/show-title.md](specs/show-title.md)
- `gameshows[key].pointMode` — how this gameshow turns a game result into points: `positional` (default, omitted — game N is worth N points), `flat` (every game 1 point) or `per-correct-answer` (one point per correct answer, read off the gamemaster's tally). The four inline-scored types keep their own scoring in every mode — see [specs/point-system.md](specs/point-system.md)
- `teamRandomizationEnabled` — How the teams are formed on the `HomeScreen` (default: `true`). `true` = enter a name pool that is shuffled + split automatically; `false` = **manual assignment** — add/remove players per team by hand on the show and the gamemaster (see [specs/team-management.md](specs/team-management.md))
- `jokersInLastGame` — Allow jokers to stay available in the last game (default: `false`; when off, the joker UI is hidden in the last game)
- `globalRules` — Array of strings for the global rules screen
- `rulesPresets` — Optional list of `{ id, name, rules[], rulesSolo?[], rulesMulti?[] }` entries. Games may reference one via `rulesPreset`; the server resolves it onto the per-game task line at runtime, picking the wording band for the active gameshow's team count (`rulesSolo` at 0–1 teams, `rules` at 2, `rulesMulti` at 3–4). See [specs/rules-presets.md](specs/rules-presets.md).
- `activeGameshow` — Key of the gameshow to run (must match a key in `gameshows`)

**`gameshows`** — Record of all defined gameshows (current and past):
- Each entry has a `name` (display name) and a `gameOrder` array
- To switch gameshows, change `activeGameshow` — no need to create a new config file

**`gameOrder`** — Array of game references (inside each gameshow):
- `"game-name"` → loads `games/game-name.json` directly (single-instance game)
- `"game-name/instance"` → loads `games/game-name.json`, picks a specific instance

### Game Files

#### Single-Instance Game

Most games have a single set of questions:

```json
// games/trump-oder-hitler.json
{
  "type": "simple-quiz",
  "title": "Trump oder Hitler",
  "randomizeQuestions": true,
  "rules": [
    "Jede Frage wird gleichzeitig an die Teams gestellt.",
    "Die Teams schreiben ihre Antwort auf."
  ],
  "questions": [
    { "question": "Sorry losers and haters, but my IQ is one of the highest", "answer": "Trump" },
    { "question": "Obedience is the foundation of all order", "answer": "Hitler" }
  ]
}
```

Referenced in gameOrder as: `"trump-oder-hitler"`

#### Multi-Instance Game

Games that are reused across gameshows with different question sets:

```json
// games/allgemeinwissen.json
{
  "type": "simple-quiz",
  "title": "Allgemeinwissen",
  "rules": [
    "Jede Frage wird gleichzeitig an die Teams gestellt.",
    "Die Teams schreiben ihre Antwort auf.",
    "Das Team mit den meisten richtigen Antworten bekommt den Punkt."
  ],
  "instances": {
    "v1": {
      "questions": [
        { "question": "Wie viele Planeten hat unser Sonnensystem?", "answer": "8" }
      ]
    },
    "v2": {
      "questions": [
        { "question": "Wie viele Knochen hat ein erwachsener Mensch?", "answer": "206" }
      ]
    }
  }
}
```

Referenced in gameOrder as: `"allgemeinwissen/v1"` or `"allgemeinwissen/v2"`

Instance-specific fields override the base config. So an instance can have its own `title`, `randomizeQuestions`, etc.

### Game Types

| Type | Description | Questions in config? |
|------|-------------|---------------------|
| `simple-quiz` | Standard Q&A with optional images, audio, lists, timers | Yes |
| `bet-quiz` | Category reveal + secret bets per question (same fields as `simple-quiz` plus required `category`) | Yes |
| `guessing-game` | Numerical guessing (closest answer wins) | Yes |
| `final-quiz` | Buzzer round with point betting | Yes |
| `audio-guess` | Music recognition from audio clips | Yes |
| `q1` | Find the wrong statement (3 true + 1 false) | Yes |
| `four-statements` | Up to 4 clues revealed one-by-one → text/image answer | Yes |
| `fact-or-fake` | True or false statements | Yes |
| `quizjagd` | Teams bet on question difficulty (3/5/7 points) | Yes |
| `video-guess` | Video clip recognition (on-the-fly transcoded + cached) | Yes |
| `bandle` | Progressive song-intro guessing (Bandle-style) | Yes |
| `image-guess` | Identify subject from a progressively revealed image | Yes |
| `colorguess` | Identify a photo or logo (PNG/JPG/SVG) from an auto-generated pie chart of its dominant colors | Yes |
| `ranking` | Guess answers in the correct order; host reveals one rank at a time | Yes |
| `wer-kennt-mehr` | Final game: both teams name as many of a thing as possible; the team that named more scores that count (tie splits) | Yes |
| `random-frame` | Guess the movie/show from a single random still frame extracted from a video at runtime (GM can re-roll) | Yes |
| `city-compass` | Name the hidden city at the center of a compass rose, from the cities placed around it at their true bearing | Yes |

See [GAME_TYPES.md](GAME_TYPES.md) for detailed per-type documentation.

## How It Works

### Server (server/index.ts)

1. Reads `config.json` on each API request (allows live editing)
2. For `/api/game/:index`:
   - Resolves `activeGameshow` to get the active gameshow's `gameOrder`
   - Looks up `gameOrder[index]` to get the game reference
   - Parses the reference into `gameName` + optional `instanceName`
   - Loads `games/<gameName>.json`
   - If multi-instance, merges base config with the selected instance
3. For `/api/settings`: returns global settings from config

### Frontend (src/)

- React + TypeScript app built with Vite
- `GameContext` manages global state (teams, settings)
- `GameScreen` fetches game data from API by index
- `GameFactory` renders the appropriate game component based on `config.type`
- Each game type has its own component in `src/components/games/`

### API Endpoints

| Endpoint | Response |
|----------|----------|
| `GET /api/settings` | `{ showTitle, pointSystemEnabled, teamRandomizationEnabled, jokersInLastGame, globalRules, enabledJokers, jokerRules }` |
| `GET /api/game/:index` | `{ gameId, config, currentIndex, totalGames, pointSystemEnabled }` |
| `GET /api/background-music` | `string[]` (audio filenames) |

## Adding a New Game

**Preferred:** open the admin's **Spiele tab** → "Neues Spiel" → pick a type → fill in questions. Then in the **Gameshows tab**, drag the new game into your gameshow's "Spiel-Reihenfolge". The admin validates as you save.

**By hand (advanced):**

1. Create `games/my-new-game.json` with the appropriate type and questions
2. Add `"my-new-game"` to the active gameshow's `gameOrder` in `config.json`
3. Run `npm run validate` to verify
4. Start the server with `npm run dev`

## Adding a New Game Type

1. Define question types in `src/types/config.ts`
2. Create a game component in `src/components/games/`
3. Register it in `src/components/games/GameFactory.tsx`
4. Add server-side handling if needed (e.g., filesystem-based questions)
5. Update `validate-config.ts` with validation rules
6. Create a game file in `games/` and test it

## Running Multiple Gameshows

All gameshows are defined in the `gameshows` record inside `config.json`. To switch between them, change `activeGameshow`:

```json
{
  "activeGameshow": "gameshow2",
  "gameshows": {
    "gameshow1": {
      "name": "Gameshow 1",
      "gameOrder": ["allgemeinwissen/v1", "audio-guess", "trump-oder-hitler"]
    },
    "gameshow2": {
      "name": "Gameshow 2",
      "gameOrder": ["emoji-raten", "q1/v2", "quizjagd/v1"]
    }
  }
}
```

No need to copy config files — all gameshows live in one place. The same game files in `games/` are shared across all gameshows.

### Jokers

Each gameshow may enable a subset of jokers — single-use per-team powers that teams spend during a gameshow. The catalog is hardcoded in [src/data/jokers.ts](src/data/jokers.ts); the admin Gameshows tab renders a "Verfügbare Joker" checklist per gameshow that writes to `enabledJokers`. The frontend shows a persistent `JokerBar` inside `BaseGameWrapper` during every phase; the gamemaster has mirror toggles on `/gamemaster`. By default the joker UI is hidden in the last game — set the top-level `jokersInLastGame` flag to keep jokers available there. See [specs/jokers.md](specs/jokers.md). Add a new joker via `skills/add-joker/SKILL.md`.

## CLI Tools

| Command | Description |
|---------|-------------|
| `npm run validate` | Validate config.json and game files |
| `npm run normalize-audio` | Normalize audio volume levels |
| `npm run dev` | Start dev server with hot reload |
| `npm start` | Production mode |

## Troubleshooting

- **Game not found**: Check that the game file exists in `games/` and the reference in the active gameshow's `gameOrder` is correct
- **Instance not found**: For multi-instance games, verify the instance name matches a key in the `instances` object
- **Missing questions**: Ensure the game file (or instance) has a non-empty `questions` array
- **Validation errors**: Run `npm run validate` for detailed error messages
