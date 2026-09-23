# Replacing the gamemaster PWA

The gamemaster PWA is the live-control surface served at `/gamemaster/`. During an event the gamemaster sits with a second device (tablet, phone, laptop) and uses this PWA to drive the show: see the current question/answer, send `next`/`award`/`use-joker` commands to the show, toggle team state, and track correct answers.

It is the smallest of the three PWAs — two HTTP endpoints and a handful of WebSocket channels (a few of them optional, including the background-music remote control). A replacement can be very lightweight. Full schemas: [`openapi.yaml`](../specs/api/openapi.yaml), [`asyncapi.yaml`](../specs/api/asyncapi.yaml).

## What the gamemaster PWA does

- Displays the "answer card" mirror of what's currently visible on the show: game title, question number, answer text, optional answer image, optional extra info.
- Renders a dynamic control panel: buttons, button groups, input groups, info cards, navigation — all pushed by the show over WebSocket.
- Lets the gamemaster tap buttons → emits `gamemaster-command` → the show responds.
- Shows per-team correct-answer counters (toggleable per-gameshow).
- Shows per-team joker usage with a tap-to-toggle UI.
- Works across devices: multiple gamemasters can open the PWA simultaneously; all see the same state.

## Required HTTP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Read enabled jokers, team randomization flag, global rules, `teamColors` (per-team accent colours, empty when off). |
| `GET` | `/api/game/:index` | Look up game metadata (mainly `title`, `totalQuestions`) when rendering answer cards. |
| `GET` | `/api/run-of-show` | **Optional.** `{ games: [{ index, gameId, title, type, missing? }] }` — the active gameshow's running order. Fetch it if you render a run-of-show overview or offer jump-to-game; the WebSocket channels only ever tell you about the CURRENT game. See [specs/gamemaster-run-of-show.md](../specs/gamemaster-run-of-show.md). |

That's it for HTTP. Everything else flows over WebSocket.

## Required WebSocket channels

One socket at `/api/ws`. Wire format: `{ channel, data }`.

### Subscribe to (receive)

| Channel | Cached? | Purpose |
|---------|---------|---------|
| `gamemaster-answer` | yes | Current answer card state pushed by the active show. |
| `gamemaster-controls` | yes | Current control panel + phase + gameIndex pushed by the active show. Also carries `pointsDisabled`: when true the playing game awards no points (0 teams, or a type the team count cannot score) — hide any per-question scoring breakdown, since `pointSystemEnabled` is resolved per game by `GET /api/game/:index` and you never fetch it. |
| `gamemaster-team-state-v2` | yes | Team members, points, joker usage, and `scoreHistory` (scoring-undo audit log; ≤60 entries, each optionally carrying `gameIndex` + `questionNumber`). Teams 1-4; `team3`/`team4` only in a 3-4 team show. See specs/team-count.md. |
| `gamemaster-question-tally` | yes | `{ [gameIndex]: { [questionKey]: { team1, team2 } } }` correct-answer tally, nested per question (`"0"` = example question, `"none"` = no question attributable). |
| `music-state` | yes | **Optional.** `{ isPlaying, currentSong, currentTime, duration, volume }` — the active show's background-music snapshot (~1 Hz while playing). Subscribe to render a music remote-control player. See [specs/gamemaster-music-control.md](../specs/gamemaster-music-control.md). |
| `content-changed` | no | **Optional.** `{ config?, theme?, games? }`. Subscribe if you fetch `GET /api/game/:index` / `GET /api/settings` directly and want those re-fetched live when config/games change on disk. |

"Cached" means the server holds the last value and sends it immediately on connect, so a freshly-opened gamemaster tab paints the right UI within one round-trip.

### Publish to (send)

| Channel | Cached? | When to send |
|---------|---------|--------------|
| `gamemaster-command` | no | On every button tap or input submit. |
| `gamemaster-team-state-v2` | yes | On every local team/joker state mutation (incl. a scoring undo, which mutates points + `scoreHistory`). Bump `rev` to `(highest rev seen) + 1`, and mutate the LAST RECEIVED state — publishing a snapshot this device captured earlier reverts points everywhere. The server drops a write that doesn't beat its cached rev and returns the cached value instead. |
| `gamemaster-question-tally` | yes | On every local tally mutation. |
| `show-hold` | yes | `{ active, message? }` when toggling the panic/pause hold overlay on the show. |
| `music-command` | no | **Optional.** `{ action: 'toggle'\|'skip'\|'volume'\|'seek', value?, timestamp }` to control the active show's background music. `value` is 0–1 for `volume`/`seek`. Set `timestamp` to `Date.now()` (replay dedup). See [specs/gamemaster-music-control.md](../specs/gamemaster-music-control.md). |

### Meta messages (send)

These ride on the same socket as `{ type }` envelopes (no `channel`):

| Type | When to send |
|------|--------------|
| `gm-register` | On every connect/reconnect, so the show knows a gamemaster is present (drives the `gm-presence` channel). |
| `gm-request-reemit` | **Optional.** When you detect your mirrored state is stale/inconsistent (e.g. the `gamemaster-answer` screen label contradicts the `gamemaster-controls` phase), send this to make the active show re-broadcast its current answer/controls. The reference GM wires it to a "Jetzt synchronisieren" button on a desync warning banner. |

## Command payload

`gamemaster-command` messages are `GamemasterCommand`:

```ts
interface GamemasterCommand {
  controlId: string;                       // matches the `id` field from the controls message
  value?: string | Record<string, string>; // for input groups, the entered values
  timestamp: number;                       // epoch ms — used for replay deduplication
}
```

The show uses `timestamp` to de-duplicate replays. Always set it to `Date.now()` on send — never reuse a stale timestamp.

Most `controlId`s come straight from the controls message. Four do not — they are
navigation commands you can send unprompted, from any screen, to jump the show out of its
linear order: `goto:home`, `goto:rules`, `goto:game-<index>` (index as served by
`GET /api/run-of-show`) and `goto:summary`. Confirm before sending one: the show leaves the
running game and restarts the target from its title screen. See
[specs/gamemaster-run-of-show.md](../specs/gamemaster-run-of-show.md).

## Example: minimal flow

```ts
const ws = new WebSocket(`ws://${location.host}/api/ws`);

// No registration needed for gamemaster — unlike the show, any number of
// gamemaster tabs can be connected with no "active" concept.

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  switch (msg.channel) {
    case 'gamemaster-answer':    setAnswer(msg.data); break;
    case 'gamemaster-controls':  setControls(msg.data); break;
    case 'gamemaster-team-state-v2': setTeams(msg.data); break;
    case 'gamemaster-question-tally': setTally(msg.data); break;
  }
});

function sendCommand(controlId: string, value?: string | Record<string,string>) {
  ws.send(JSON.stringify({
    channel: 'gamemaster-command',
    data: { controlId, value, timestamp: Date.now() },
  }));
}
```

## Rendering the control panel

`gamemaster-controls.data.controls` is an array of `GamemasterControl` union members. Render each according to its `type` field:

- `button` — single button. Emit `gamemaster-command` with the button's `id` on click. Styling: `variant` is `success | danger | primary` or undefined.
- `button-group` — multiple buttons laid out together (often one per team). Buttons carry `sublabel` (e.g. team member names), `active` (highlighted), `disabled`.
- `input-group` — inputs + a single submit button. Emit `gamemaster-command` with `{ controlId: submit-button-id, value: { [inputId]: enteredText } }`. If any input has `emitOnChange: true`, emit on change too.
- `info` — read-only text card. No interaction.
- `nav` — implicit back/next navigation control. Respect `hideBack`.

`data.phase` is one of `landing | rules | game | points`. Use it for contextual UI decisions. `data.gameIndex` is the 0-based game slot. `data.hideCorrectTracker` says whether to show the correct-answer counter bar (some game types track progress via points instead). `data.tallyReadOnly` says the playing game fills that tally itself (guessing-game's automatic scoring) - render the counts, but leave out the editing controls.

## State persistence

The reference implementation persists these `localStorage` keys so the PWA paints on first frame even before the WebSocket connects:

| Key | Shape |
|-----|-------|
| `gm:last-answer` | `GamemasterAnswerData \| null` |
| `gm:last-controls` | `GamemasterControlsData \| null` |
| `team1` / `team2` | `string[]` — team members |
| `team1Name` / `team2Name` | `string` (absent when unset) |
| `team1Points` / `team2Points` | `string` — the integer total |
| `team1JokersUsed` / `team2JokersUsed` | `string[]` — joker ids |
| `scoreHistory` | `ScoreLogEntry[]` — the scoring-undo audit log |
| `doubleNextGame` | `'team1' \| 'team2'` (absent when unarmed) |
| `teamOrderSwapped` | `'true' \| 'false'` |
| `teamStateRev` | `string` — the Lamport `rev` last published |
| `currentGame` | `CurrentGame` |
| `correctAnswersByQuestion` | `Record<gameIndex, Record<questionKey, { team1, team2 }>>` |

Device-local gamemaster preferences, deliberately **not** synced: `gm-input-locked`,
`gm-show-answer-images`, `gm-hide-answers`.

Seed your state from these on mount, then let WS messages overwrite them.

## Build & serve contract

- **Mount point**: `/gamemaster/` (set `base: "/gamemaster/"`).
- **Service worker scope**: `/gamemaster/`.
- **Manifest**: `start_url: "/gamemaster/"`, `scope: "/gamemaster/"`, `display: "standalone"`.
- **Build output**: static files under `dist/client/gamemaster/`.

## What NOT to do from a replacement gamemaster

- **Don't send `show-register` or `show-claim`.** Those are show-only.
- **Don't emit `gamemaster-answer` or `gamemaster-controls`.** The server will re-broadcast your emit to the show and everyone else, immediately followed by the show's next emit — net effect is a visible flicker. The cached answer/controls channels are show-owned.
- **Don't swallow the `timestamp` field on `gamemaster-command`.** The show uses it to dedupe replays; a command with a stale or missing timestamp is silently ignored.
- **Don't assume a single gamemaster.** Multiple gamemaster tabs are a supported deployment. All writes must be idempotent and conflict-free.
