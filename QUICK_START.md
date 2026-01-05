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

# Edit config.json to customize your gameshow
# - Modify "gameOrder" to select which games
# - Update questions in each game
```

### Step 3: Validate Your Configuration (Optional but Recommended)
```bash
npm run validate
```

You should see:
```
✅ Configuration is valid!
📊 Games configured: 3
🎮 Game order: game1 → game3 → game7
```

### Step 4: Start the Server
```bash
npm start
```

### Step 5: Open in Browser
```
http://localhost:3000
```

## 🎯 Your First Custom Gameshow

Here's a minimal example to get started:

### Create `config.json`:
```json
{
  "gameOrder": ["intro", "main", "final"],
  "games": {
    "intro": {
      "type": "quiz",
      "title": "Warm-Up Quiz",
      "questions": [
        { "question": "Example question", "answer": "Example answer" },
        { "question": "What is 5 + 3?", "answer": "8" },
        { "question": "What color is the sky?", "answer": "Blue" }
      ]
    },
    "main": {
      "type": "guessing",
      "title": "Number Challenge",
      "questions": [
        { "question": "Example", "answer": 0 },
        { "question": "How many days in a year?", "answer": 365 }
      ]
    },
    "final": {
      "type": "buzzer",
      "title": "Speed Round",
      "questions": [
        { "question": "Example", "answer": "Example" },
        { "question": "Capital of Germany?", "answer": "Berlin" }
      ]
    }
  }
}
```

That's it! Run `npm start` and your custom gameshow is ready!

## 📝 Configuration Basics

### The `gameOrder` Array
Controls which games appear and in what order:
```json
"gameOrder": ["game1", "game3", "game5"]
```

- Games play in this order
- Can repeat games: `["game1", "game2", "game1"]`
- Can skip games: Just don't include them
- Can have 1 game or 100 games

### The `games` Object
Defines each game:
```json
"games": {
  "game1": {
    "type": "quiz",           // Game type (see below)
    "title": "My Quiz",       // Display title
    "questions": [...]        // Questions array
  }
}
```

### Game Types
- `quiz` - Standard Q&A
- `guessing` - Guess numbers
- `buzzer` - Fast buzzer quiz
- `music` - Music recognition
- `image` - Picture quiz
- `oddoneout` - Find the fake
- `factorfake` - True or false

## ⚡ Common Tasks

### Change Game Order
Edit `gameOrder` in config.json:
```json
// Before
"gameOrder": ["game1", "game2", "game3"]

// After
"gameOrder": ["game3", "game1", "game2"]
```

### Add More Questions
Add to the questions array:
```json
"questions": [
  { "question": "Example", "answer": "Example" },
  { "question": "New question?", "answer": "New answer" },
  { "question": "Another question?", "answer": "Another answer" }
]
```

### Remove a Game
Remove from `gameOrder`:
```json
// Before
"gameOrder": ["game1", "game2", "game3"]

// After (removed game2)
"gameOrder": ["game1", "game3"]
```

### Use Only Specific Games
Just list what you want:
```json
"gameOrder": ["game1", "game5"]  // Only uses game1 and game5
```

## 🔧 Validate Before Running

Always validate your config before starting:
```bash
npm run validate
```

Common errors:
- ❌ Game in gameOrder not found in games
- ❌ Missing required fields (type, title)
- ❌ Invalid game type
- ❌ Empty questions array

## 📂 Folder Setup for Special Games

Some game types need additional folders:

### Music Game
```bash
mkdir music
# Add subfolders with MP3 files
```

### Image Game
```bash
mkdir images
# Add image files (JPG, PNG)
# Prefix example images with "Beispiel_"
```

## 🎮 Running the Gameshow

1. **Setup teams**: Enter names on the home page
2. **View rules**: See configured games
3. **Start**: Begin with the first game
4. **Navigate**: Click or press arrow keys to advance
5. **Award points**: Select winning team
6. **Summary**: View final scores at the end

## 📚 Need More Help?

- **Full documentation**: See [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)
- **What changed**: See [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md)
- **Main README**: See [README.md](README.md)

## 🐛 Troubleshooting

### Config not loading
- Check `config.json` exists in root folder
- Run `npm run validate` to check for errors

### Game not appearing
- Verify game ID in `gameOrder` matches key in `games`
- Check browser console for errors

### Questions not showing
- Ensure questions array is not empty
- First question is treated as an example

## ✨ Tips

1. **Start simple**: Use the provided `config.json` as a starting point
2. **Validate often**: Run `npm run validate` after changes
3. **Test locally**: Always test your gameshow before the event
4. **Backup config**: Keep a copy of working configurations
5. **Read docs**: Check `MODULAR_SYSTEM.md` for advanced features

Happy gaming! 🎉
