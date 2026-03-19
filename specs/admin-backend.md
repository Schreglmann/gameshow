# Spec: Admin Backend

## Goal

A full content management system accessible at `/admin` that allows the gameshow operator to manage game content, media assets, and gameshow configuration — all persisted directly to JSON files and the filesystem. The existing session management functionality (teams, points, localStorage) is preserved as the "Session" tab.

## Route

`/admin` — replaces the previous single-purpose admin screen. No `PageLayout` or additional context wrapper needed beyond the existing `GameProvider`.

## Tabs

### Session (existing functionality, unchanged)
- Edit team 1 and team 2 member lists (comma-separated)
- Edit team points
- Dispatch `SET_TEAM_STATE` to save
- Reset points (`RESET_POINTS`)
- View / clear localStorage (double confirmation for clear-all)

### Games
- Table of all `.json` game files from `/games/` (excluding `_template-*`)
- Each row: filename, type badge, title, instance names, Edit / Delete buttons
- Edit opens `GameEditor`:
  - Base fields: title, type, rules (add/remove/reorder), randomizeQuestions toggle
  - Per-instance tabs for multi-instance games; single unnamed block for single-instance
  - Instance fields: `_players` (metadata), title override, rules override
  - Type-specific question form (see below)
  - Save writes file atomically via `PUT /api/backend/games/:fileName`
- New game button opens modal: choose filename + game type → creates file from template → opens editor
- Delete with confirmation removes the `.json` file

#### Question forms per game type

| Type | Fields per question |
|------|-------------------|
| simple-quiz | question*, answer*, questionImage, answerImage, questionAudio, answerAudio, replaceImage, timer, answerList |
| guessing-game | question*, answer (number)*, answerImage |
| final-quiz | question*, answer*, answerImage |
| four-statements | Frage*, trueStatements[3]*, wrongStatement*, answer |
| fact-or-fake | statement*, isFact toggle (Fakt/Fake)*, description* |
| quizjagd | question*, answer*, difficulty (3/5/7)*, isExample; plus questionsPerTeam setting |
| audio-guess | Read-only info panel — questions are filesystem-derived; link to Assets tab |
| image-game | Read-only info panel — questions are filesystem-derived; link to Assets tab |

All question forms support Add, Delete, Move Up, Move Down.

### Config
- Global settings: `pointSystemEnabled`, `teamRandomizationEnabled` (checkboxes)
- Global rules: add/remove/reorder string list
- Gameshows section: one card per gameshow with:
  - Name field
  - "Set as Active" button (marks `activeGameshow`)
  - Game order list (editable entries, Move Up/Down/Delete, Add new ref)
  - Delete gameshow button (with confirmation)
- Add new gameshow button
- Save writes `config.json` atomically via `PUT /api/backend/config`

### Assets (DAM)
Category tabs: **Bilder** (`/images/`), **Audio** (`/audio/`), **Audio-Guess** (`/audio-guess/`), **Image-Guess** (`/image-guess/`), **Hintergrundmusik** (`/background-music/`)

Flat categories (all except audio-guess):
- Grid of filenames with Delete buttons
- File upload via file picker; file is moved to the category directory

Audio-Guess (special two-level view):
- List of subfolders (each = one song/question)
- Per folder: expand/collapse, file listing, Upload button, Delete folder button
- Create new folder (folder is created on first file upload)
- Subfolder name = answer text in the game (prefix `Beispiel_` = example question)

## Server API

All new endpoints under `/api/backend/*`. Added to `server/index.ts` before the SPA fallback.

### Games
```
GET  /api/backend/games                     → { games: GameFileSummary[] }
GET  /api/backend/games/:fileName           → raw game file JSON
PUT  /api/backend/games/:fileName           → write game file (atomic)
POST /api/backend/games                     → create new game file
DELETE /api/backend/games/:fileName         → delete game file
```

### Config
```
GET  /api/backend/config                    → full config.json
PUT  /api/backend/config                    → write config.json (atomic)
```

### Assets
```
GET    /api/backend/assets/:category        → { files } or { subfolders }
POST   /api/backend/assets/:category/upload → multer upload; ?subfolder= for audio-guess
DELETE /api/backend/assets/:category/*      → delete file or folder
```

Atomic writes: write to `.tmp` then `rename()` to prevent corruption on crash.

Security: `fileName` and `subfolder` params are validated to reject `..`, `/`, null bytes. `category` is validated against an allowlist.

## Data storage

All changes go directly to:
- `/games/*.json` — game data files
- `/config.json` — app configuration
- `/audio/`, `/images/`, `/audio-guess/`, `/image-guess/`, `/background-music/` — media files

No database. No authentication (local network only).

## Types added

In `src/types/config.ts`:
- `GameFileSummary` — summary returned by the games list endpoint
- `QuizjagdFlatQuestion` — documents the actual flat array format used in quizjagd JSON files
- `AssetCategory` — union type for the five asset categories
- `AudioGuessSubfolder` — folder + files structure for audio-guess DAM view
- `AssetListResponse` — union response for the assets endpoint

## New files

```
src/components/screens/AdminScreen.tsx         (replaced — now tab shell)
src/components/backend/SessionTab.tsx
src/components/backend/GamesTab.tsx
src/components/backend/GameEditor.tsx
src/components/backend/InstanceEditor.tsx
src/components/backend/ConfigTab.tsx
src/components/backend/GameshowEditor.tsx
src/components/backend/AssetsTab.tsx
src/components/backend/RulesEditor.tsx
src/components/backend/StatusMessage.tsx
src/components/backend/questions/SimpleQuizForm.tsx
src/components/backend/questions/GuessingGameForm.tsx
src/components/backend/questions/FinalQuizForm.tsx
src/components/backend/questions/FourStatementsForm.tsx
src/components/backend/questions/FactOrFakeForm.tsx
src/components/backend/questions/QuizjagdForm.tsx
src/components/backend/questions/AudioGuessInfo.tsx
src/components/backend/questions/ImageGameInfo.tsx
src/services/backendApi.ts
src/backend.css
```

## Out of scope
- Authentication / access control
- Undo/redo for content edits
- Preview of how a game will look in-game
- Drag-and-drop reordering (up/down buttons used instead)
- Image thumbnails in the flat asset grid
