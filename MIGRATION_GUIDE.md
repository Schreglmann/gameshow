# Migration Guide

## For Existing Gameshow Users

If you have an existing gameshow with hardcoded games, this guide will help you migrate to the new modular system.

## ⚠️ Important: Migration Required

The refactored system has replaced the old individual game HTML files with a universal game loader. The old files (game1.html, game2.html, etc.) have been removed.

**To continue using the gameshow, you must create a `config.json` file.**

## 🎯 Why Migrate?

### Benefits of the New System:
1. **No code editing** - Configure games via JSON file
2. **Easy to swap** - Change game order by editing one line
3. **Reusable** - Create multiple gameshows from one codebase
4. **Flexible** - Any number of games in any order
5. **Future-proof** - Easier to maintain and extend

## 📋 Migration Steps

### Step 1: Understand Your Current Setup

Your old gameshow likely has:
- Hardcoded links: `game1.html` → `game2.html` → `game3.html`
- Questions embedded in HTML or loaded from old config
- Fixed game order

### Step 2: Extract Your Questions

Look at your existing game HTML files and extract questions into the new format.

#### Example: Migrating game1.html

**Old way** (questions in config or HTML):
```json
{
  "game1": {
    "questions": [
      { "question": "Q1", "answer": "A1" },
      { "question": "Q2", "answer": "A2" }
    ]
  }
}
```

**New way** (in new config.json):
```json
{
  "gameOrder": ["game1", ...],
  "games": {
    "game1": {
      "type": "quiz",
      "title": "Spiel 1 - Quiz",
      "questions": [
        { "question": "Q1", "answer": "A1" },
        { "question": "Q2", "answer": "A2" }
      ]
    }
  }
}
```

### Step 3: Create config.json

You have two options:

#### Option A: Manual Creation

1. Copy the template:
   ```bash
   cp config.template.json config.json
   ```

2. Edit `config.json`:
   - Set `gameOrder` to match your current game sequence
   - Copy your questions into each game's configuration

#### Option B: Use the Generator

1. Run the generator:
   ```bash
   npm run generate
   ```

2. Answer the prompts to create your gameshow structure

3. Edit the generated `config.json` to add your actual questions

### Step 4: Map Your Game Types

Match your current games to the new game types:

| Your Game | New Type | Description |
|-----------|----------|-------------|
| game1.html | `quiz` | Standard quiz questions |
| game2.html | `music` | Music recognition |
| game3.html | `guessing` | Number guessing game |
| game4.html | `image` | Image recognition |
| game5.html | `oddoneout` | Find the wrong statement |
| game6.html | `factorfake` | True or false statements |
| game7.html | `buzzer` | Buzzer quiz |

### Step 5: Configure Your Game Order

In `config.json`, set the `gameOrder` array to match your current sequence:

```json
{
  "gameOrder": [
    "game1",
    "game2", 
    "game3",
    "game4",
    "game5",
    "game6",
    "game7"
  ],
  "games": { ... }
}
```

Or create a custom order:
```json
{
  "gameOrder": ["intro", "main", "final"],
  "games": { ... }
}
```

### Step 6: Validate Your Configuration

```bash
npm run validate
```

Fix any errors reported by the validator.

### Step 7: Test Your Migration

1. Start the server:
   ```bash
   npm start
   ```

2. Test both systems:
   - **New URL**: `http://localhost:3000/game?index=0`

3. Verify:
   - Games load correctly
   - Questions appear
   - Navigation works
   - Points are awarded

### Step 8: Update Your Links (Optional)
Start Using the New System

Access your games at:
```
http://localhost:3000/game?index=0  (first game)
http://localhost:3000/game?index=1  (second game)
etc.
```

Or start from the home page which will navigate through games automatically.
## 📊 Migration Examples

### Example 1: Simple Migration

**Before** - You had 3 games in fixed order:
- game1.html (quiz)
- game3.html (guessing)  
- game7.html (buzzer)

**After** - Create config.json:
```json
{
  "gameOrder": ["game1", "game3", "game7"],
  "games": {
    "game1": {
      "type": "quiz",
      "title": "Quiz Round",
      "questions": [ /* your questions */ ]
    },
    "game3": {
      "type": "guessing",
      "title": "Guessing Game",
      "questions": [ /* your questions */ ]
    },
    "game7": {
      "type": "buzzer",
      "title": "Final Buzzer",
      "questions": [ /* your questions */ ]
    }
  }
}
```

### Example 2: Reordering Games

Want to swap game order? Just change the array:

```json
// Original order
"gameOrder": ["game1", "game3", "game7"]

// New order (no code changes needed!)
"gameOrder": ["game7", "game1", "game3"]
```

### Example 3: Adding More Games

Want to play game1 twice? Easy:

```json
{
  "gameOrder": ["game1", "game3", "game1"],
  "games": {
    "game1": {
      "type": "quiz",
      "title": "Quiz Round",
      "questions": [ /* your questions */ ]
    }
  }
}
```

Or create a second quiz with different questions:

```json
{
  "gameOrder": ["quiz1", "game3", "quiz2"],
  "games": {
    "quiz1": {
      "type": "quiz",
      "title": "Science Quiz",
      "questions": [ /* science questions */ ]
    },
    "quiz2": {
      "type": "quiz",
      "title": "History Quiz",
      "questions": [ /* history questions */ ]
    },
    "game3": { /* ... */ }
  }
}
```

## 🔄 Migration Required

The new system requires configuration:

### Quick Migration
1. Create config.json (use generator or template)
2. Validate your configuration
3. Start using the new dynamic system

## 🛠️ Troubleshooting Migration

### Problem: Config validation fails

**Solution**: Check the error message and fix:
```bash
npm run validate
```

Common issues:
- Missing game type
- Invalid game type name
- Game in gameOrder not defined in games object

### Problem: Questions not showing

**Check**:
1. Questions array exists and is not empty
2. First question is example (use simple example content)
3. Question structure matches game type

### Problem: Navigation not working

**Check**:
1. Using new game loader: `/game?index=0`
2. Not mixing old HTML files with new loader
3. Browser console for JavaScript errors

### Problem: Points not saving

**Verify**:
1. localStorage is enabled in browser
2. Using same domain/port throughout
3. Not in incognito/private mode

## 📚 Resources

- **Full Documentation**: [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)
- **Quick Start**: [QUICK_START.md](QUICK_START.md)
- **What Changed**: [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md)
- **Main README**: [README.md](README.md)

## ✅ Migration Checklist

- [ ] Backup existing config/game files
- [ ] Understand current game structure
- [ ] Extract all questions from HTML files
- [ ] Create config.json (manual or with generator)
- [ ] Map game types correctly
- [ ] Set correct game order
- [ ] Run `npm run validate`
- [ ] Test on localhost
- [ ] Verify all games work
- [ ] Check point awarding
- [ ] Test navigation
- [ ] Update documentation/notes

## 🎉 After Migration

You can now:
- ✅ Create new gameshows by editing config.json
- ✅ Swap game order instantly
- ✅ Reuse games with different content
- ✅ Add or remove games easily
- ✅ Maintain multiple gameshow configs

## 💡 Tips

1. **Start simple**: Migrate one game at a time
2. **Use validator**: Run `npm run validate` frequently
3. **Keep backups**: Save working configurations
4. **Test thoroughly**: Verify each game before moving on
5. **Read docs**: Check MODULAR_SYSTEM.md for details

## Need Help?

If you encounter issues during migration:

1. Check the browser console for errors
2. Run `npm run validate` to verify config
3. Compare your config with `config.template.json`
4. Review [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md) for detailed examples

Happy migrating! 🚀
