# Quick Start Guide

> **The shortcut:** all of the steps below — creating a gameshow, picking which games it includes, editing questions, uploading images and audio, toggling jokers — happen in the **Admin Panel** at `http://localhost:3000/admin`. Editing `config.json` or the files under `games/` by hand is supported but no longer the recommended workflow. The admin saves to those same files for you, validates as you type, and refreshes the live game without a restart. See [docs/admin-guide.md](docs/admin-guide.md) for the full walkthrough.

## 🚀 Get Started in 3 Minutes

> **Fresh clone without the git-crypt key?** The server detects that `config.json` is encrypted (or missing) and writes a minimal default config (an empty "Beispiele" gameshow). Open the admin's **Spiele** tab and click **"Beispiele erstellen"** (or run `npm run fixtures`) to generate one real example game per type — with self-synthesized, copyright-free images and music. `npm run validate` is git-crypt-aware and exits 0 with a friendly message. See [specs/clean-install.md](specs/clean-install.md) and [specs/example-games.md](specs/example-games.md).

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the Server
```bash
npm start
```

### Step 3: Open the Admin Panel
```
http://localhost:3000/admin
```

In the admin:

1. **Config tab** → "Neue Gameshow" → name it, set it as active, drag in the games you want.
2. **Games tab** → "Neues Spiel" to create a new game, or pick an existing one to edit questions, images, audio, rules.
3. **Assets tab** → upload images / audio / videos / background music. Drag-and-drop, paste a URL, or use the internet image search.
4. **Optional:** enable jokers per gameshow in the Config tab (single-use powers your teams can spend during play — see [specs/jokers.md](specs/jokers.md)).

The admin writes to `config.json` and `games/*.json` for you and runs validation on every save.

### Step 4: Open the Show
```
http://localhost:3000
```

That's the player display — open it on the projector/TV. The gamemaster panel is at `http://localhost:3000/gamemaster` for remote control from a phone or tablet.

### Step 5 (Optional): Install the local-AI image upscaler
For upscaling low-resolution images directly in the DAM (Real-ESRGAN, runs locally — no internet needed):
```bash
npm run upscaler:install
```
Downloads ~150 MB of binary + models into `local-assets/.upscaler/` (gitignored).

**Linux only:** also install the Vulkan loader before running upscales:
```bash
sudo apt install -y libvulkan1 mesa-vulkan-drivers
```

Mac (arm64 + x64) works out of the box (MoltenVK is bundled). The feature surfaces as an "AI hochskalieren" tab inside the admin DAM's image-replace modal — see [specs/dam-image-upscale.md](specs/dam-image-upscale.md).

---

## 📝 Configuration Basics

### How it works (under the hood)

You don't need to know any of this to run the app — the admin handles it. It's here so you can understand the file layout if you ever need to look at it.

1. **Game files** live in `games/` — one JSON file per game concept. Type-level examples are generated on demand (`games/beispiel-*.json`, gitignored) from code fixtures in `server/example-games.ts` — see [specs/example-games.md](specs/example-games.md)
2. **`config.json`** defines gameshows (each with a `gameOrder`) and selects the active one via `activeGameshow`
3. **Settings** like `pointSystemEnabled` and `globalRules` live in `config.json` (top-level)

> `config.json` is git-crypt encrypted on the maintainer's machine. If you don't have the key, the server writes a minimal default config and the admin offers **"Beispiele erstellen"** to populate example games — the app works without any setup. Only commit `config.json` if you have the key.

### Game Types

The admin's "Neues Spiel" dialog lists all 14 types:

| Type | Description |
|------|-------------|
| `simple-quiz` | Standard Q&A |
| `bet-quiz` | Einsatzquiz: category-reveal + secret bets (same fields as `simple-quiz` + required `category`) |
| `guessing-game` | Guess numbers (closest wins) |
| `final-quiz` | Fast buzzer quiz |
| `audio-guess` | Music recognition |
| `q1` | Find the wrong statement (3 true + 1 false) |
| `four-statements` | Up to 4 clues revealed one-by-one → text/image answer |
| `fact-or-fake` | True or false |
| `quizjagd` | Bet on question difficulty |
| `video-guess` | Video clip recognition (transcoded + cached) |
| `bandle` | Progressive song-intro guessing |
| `image-guess` | Identify subject from a progressively revealed image |
| `colorguess` | Identify a photo or logo from an auto-generated pie chart of its dominant colors |
| `ranking` | Guess the answers to a question in the correct order — host reveals one rank at a time |

See [GAME_TYPES.md](GAME_TYPES.md) for the per-type field reference.

---

## ⚡ Common Tasks (in the Admin)

| I want to… | Do this in the admin |
|------------|----------------------|
| Switch to a different gameshow | **Config tab** → click "Aktiv setzen" on the gameshow card |
| Create a new gameshow | **Config tab** → "Neue Gameshow" → drag games into "Spiel-Reihenfolge" |
| Reorder games | **Config tab** → drag the games in "Spiel-Reihenfolge" |
| Add questions to a game | **Games tab** → click the game → "Frage hinzufügen" |
| Add a new instance of a game (v1, v2, …) | **Games tab** → open the game → "+" in the tab bar |
| Upload an image / audio / video | **Assets tab** → drag files into the upload zone |
| Replace a low-res image | open the asset → "↻ Ersetzen" → Suchen / URL / Datei / AI hochskalieren |
| Merge duplicate assets | open the asset → "⇆ Zusammenführen" → pick the twin |
| Toggle jokers for a gameshow | **Config tab** → "Verfügbare Joker" on the gameshow card |
| Edit team names / points during a live session | **Session tab** |

---

## 🔧 Editing Files by Hand (Advanced)

If you really want to edit `config.json` or `games/*.json` directly (for bulk edits, scripted changes, or because the admin doesn't expose a niche field), run the validator after every change:

```bash
npm run validate
```

Expected output:
```
✅ Configuration is valid!
📊 Active gameshow: gameshow1
🎮 Game order: allgemeinwissen/v1 → audio-guess → trump-oder-hitler → quizjagd/v1
```

Common errors:
- ❌ Game file not found in `games/`
- ❌ Instance not found in multi-instance game
- ❌ Missing required fields (type, title)
- ❌ Invalid game type
- ❌ Empty questions array

### File formats — for reference

**Single-instance** (most games):
```json
// games/trump-oder-hitler.json
{
  "type": "simple-quiz",
  "title": "Trump oder Hitler",
  "rules": ["..."],
  "questions": [...]
}
```

**Multi-instance** (games with multiple question sets):
```json
// games/allgemeinwissen.json
{
  "type": "simple-quiz",
  "title": "Allgemeinwissen",
  "rules": ["..."],
  "instances": {
    "v1": { "questions": [...] },
    "v2": { "questions": [...] }
  }
}
```

References in `gameOrder`:
- `"trump-oder-hitler"` → loads `games/trump-oder-hitler.json`
- `"allgemeinwissen/v1"` → loads `games/allgemeinwissen.json`, picks instance `v1`

`config.json` shape:
```json
{
  "activeGameshow": "gameshow1",
  "gameshows": {
    "gameshow1": {
      "name": "Gameshow 1",
      "gameOrder": [
        "allgemeinwissen/v1",
        "audio-guess",
        "trump-oder-hitler",
        "quizjagd/v1"
      ]
    }
  }
}
```

---

## 🎮 Running the Gameshow

1. **Setup teams**: players enter their names on the home page
2. **View rules**: global rules screen
3. **Start**: begin with the first game
4. **Navigate**: click or press arrow keys to advance
5. **Award points**: select the winning team (or use the gamemaster panel)
6. **Summary**: final scores at the end

---

## 📚 Need More Help?

- **Admin walkthrough**: [docs/admin-guide.md](docs/admin-guide.md)
- **Per-game details**: [GAME_TYPES.md](GAME_TYPES.md)
- **Architecture**: [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)
- **Main README**: [README.md](README.md)

---

## 🐛 Troubleshooting

### Config not loading
- Make sure `config.json` exists in the repo root (the admin creates one on first save if it doesn't)
- Run `npm run validate` to check for errors

### Game not appearing
- In the admin, verify the game shows up in the Games tab and is referenced in the active gameshow's "Spiel-Reihenfolge"
- For multi-instance games, verify the instance is selected
- Check the browser console for errors

### Questions not showing
- Make sure the game's question list is not empty
- For multi-instance games, check the selected instance has questions

---

## ✨ Tips

1. **Use the admin**: it validates as you type and catches mistakes (missing answers, broken file references, duplicate filenames) before the show starts
2. **Validate after manual edits**: `npm run validate` is still the source of truth if you bypass the admin
3. **Reuse games**: drag the same game into multiple gameshows in the Config tab — they all read from the same file
4. **Keep history**: every gameshow stays in `gameshows` — switch between them by changing the active one
5. **Read the specs**: each feature has a spec under [`specs/`](specs/) — read it before changing behaviour

Happy gaming! 🎉
