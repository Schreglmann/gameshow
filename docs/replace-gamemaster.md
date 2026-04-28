# Replacing the gamemaster PWA

The gamemaster PWA is the live-control surface served at `/gamemaster/`. During an event the gamemaster sits with a second device (tablet, phone, laptop) and uses this PWA to drive the show: see the current question/answer, send `next`/`award`/`use-joker` commands to the show, toggle team state, and track correct answers.

It is the smallest of the three PWAs — two HTTP endpoints and five WebSocket channels. A replacement can be very lightweight. Full schemas: [`openapi.yaml`](../specs/api/openapi.yaml), [`asyncapi.yaml`](../specs/api/asyncapi.yaml).

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
| `GET` | `/api/settings` | Read enabled jokers, team randomization flag, global rules. |
| `GET` | `/api/game/:index` | Look up game metadata (mainly `title`, `totalQuestions`) when rendering answer cards. |

That's it for HTTP. Everything else flows over WebSocket.

## Required WebSocket channels

One socket at `/api/ws`. Wire format: `{ channel, data }`.

### Subscribe to (receive)

| Channel | Cached? | Purpose |
|---------|---------|---------|
| `gamemaster-answer` | yes | Current answer card state pushed by the active show. |
| `gamemaster-controls` | yes | Current control panel + phase + gameIndex pushed by the active show. |
| `gamemaster-team-state` | yes | Team members, points, joker usage. |
| `gamemaster-correct-answers` | yes | `{ [gameIndex]: { [teamId]: number } }` tally. |

"Cached" means the server holds the last value and sends it immediately on connect, so a freshly-opened gamemaster tab paints the right UI within one round-trip.

### Publish to (send)

| Channel | Cached? | When to send |
|---------|---------|--------------|
| `gamemaster-command` | no | On every button tap or input submit. |
| `gamemaster-team-state` | yes | On every local team/joker state mutation. |
| `gamemaster-correct-answers` | yes | On every local tally mutation. |

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
    case 'gamemaster-team-state': setTeams(msg.data); break;
    case 'gamemaster-correct-answers': setTally(msg.data); break;
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

`data.phase` is one of `landing | rules | game | points`. Use it for contextual UI decisions. `data.gameIndex` is the 0-based game slot. `data.hideCorrectTracker` says whether to show the correct-answer counter bar (some game types track progress via points instead).

## State persistence

The reference implementation persists these `localStorage` keys so the PWA paints on first frame even before the WebSocket connects:

| Key | Shape |
|-----|-------|
| `gm:last-answer` | `GamemasterAnswerData \| null` |
| `gm:last-controls` | `GamemasterControlsData \| null` |
| `gameshow:teams` | `TeamState` |
| `gm:correct-answers` | `Record<number, Record<'team1' \| 'team2', number>>` |

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
