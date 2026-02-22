# Quick Start Guide

## 🚀 Get Started in 3 Minutes

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Create Your Configuration
```bash
# Copy the template
cp config.template.json config.json
```

Edit `config.json` to select which gameshow to run:
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

Games are stored as individual files in `games/`. The config defines gameshows and picks which one is active.

### Step 3: Validate Your Configuration (Optional but Recommended)
```bash
npm run validate
```

You should see:
```
✅ Configuration is valid!
📊 Active gameshow: gameshow1
🎮 Game order: allgemeinwissen/v1 → audio-guess → trump-oder-hitler → quizjagd/v1
```

### Step 4: Start the Server
```bash
npm start
```

### Step 5: Open in Browser
```
http://localhost:3000
```

## 📝 Configuration Basics

### How it works

1. **Game files** live in `games/` — one JSON file per game concept
2. **`config.json`** defines gameshows (each with a `gameOrder`) and selects the active one via `activeGameshow`
3. **Settings** like `pointSystemEnabled` go in `config.json` (top-level)

### Game file formats

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

### Referencing games in `gameOrder`

- `"trump-oder-hitler"` → loads `games/trump-oder-hitler.json`
- `"allgemeinwissen/v1"` → loads `games/allgemeinwissen.json`, picks instance `v1`

Each gameshow in the `gameshows` record has its own `gameOrder` array.

### Game Types

| Type | Description |
|------|-------------|
| `simple-quiz` | Standard Q&A |
| `guessing-game` | Guess numbers (closest wins) |
| `final-quiz` | Fast buzzer quiz with betting |
| `audio-guess` | Music recognition |
| `image-game` | Picture quiz |
| `four-statements` | Find the wrong statement |
| `fact-or-fake` | True or false |
| `quizjagd` | Bet on question difficulty |

## ⚡ Common Tasks

### Create a new game
1. Create a JSON file in `games/` (e.g., `games/my-quiz.json`)
2. Add it to the active gameshow's `gameOrder` in `config.json`

### Switch to a different gameshow
Change `activeGameshow` in `config.json`:
```json
"activeGameshow": "gameshow2"
```

### Change game order
Edit the `gameOrder` inside the active gameshow entry:
```json
"gameshows": {
  "gameshow1": {
    "name": "Gameshow 1",
    "gameOrder": ["quizjagd/v1", "allgemeinwissen/v2", "audio-guess"]
  }
}
```

### Add questions to an existing game
Edit the game file in `games/` directly, or add a new instance for a multi-instance game.

### Create a new gameshow from existing games
Add a new entry to `gameshows` and set it as active:
```json
{
  "activeGameshow": "gameshow3",
  "gameshows": {
    "gameshow3": {
      "name": "My New Gameshow",
      "gameOrder": [
        "allgemeinwissen/v2",
        "emoji-raten",
        "four-statements/v2",
        "quizjagd/v1"
      ]
    }
  }
}
```

## 🔧 Validate Before Running

Always validate your config before starting:
```bash
npm run validate
```

Common errors:
- ❌ Game file not found in `games/`
- ❌ Instance not found in multi-instance game
- ❌ Missing required fields (type, title)
- ❌ Invalid game type
- ❌ Empty questions array

## 🎮 Running the Gameshow

1. **Setup teams**: Enter names on the home page
2. **View rules**: See configured games
3. **Start**: Begin with the first game
4. **Navigate**: Click or press arrow keys to advance
5. **Award points**: Select winning team
6. **Summary**: View final scores at the end

## 📚 Need More Help?

- **Game types**: See [GAME_TYPES.md](GAME_TYPES.md)
- **Architecture**: See [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)
- **Main README**: See [README.md](README.md)

## 🐛 Troubleshooting

### Config not loading
- Check `config.json` exists in root folder
- Run `npm run validate` to check for errors

### Game not appearing
- Verify the game file exists in `games/`
- For multi-instance games, verify the instance name is correct
- Check browser console for errors

### Questions not showing
- Ensure questions array is not empty
- For multi-instance games, check the instance has questions

## ✨ Tips

1. **Start simple**: Use `config.template.json` as a starting point
2. **Validate often**: Run `npm run validate` after changes
3. **Reuse games**: Reference the same game file across different gameshows
4. **Keep history**: All gameshows stay in the `gameshows` record — switch between them by changing `activeGameshow`
5. **Read docs**: Check `GAME_TYPES.md` for per-game-type details

Happy gaming! 🎉
