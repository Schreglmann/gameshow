# Modular Gameshow System

## Overview

This gameshow application has been refactored to be fully modular and configurable. You can now easily create different gameshows by simply configuring which games to include and in what order, without modifying any code.

## Key Features

- **Dynamic Game Loading**: Games are loaded dynamically based on configuration
- **Modular Architecture**: Each game type is a separate module that can be reused
- **Flexible Configuration**: Easily configure game order, types, and content via `config.json`
- **Easy to Extend**: Add new game types by creating new modules

## Configuration

### Main Config File: `config.json`

The `config.json` file (based on `config.template.json`) controls your entire gameshow:

```json
{
  "gameOrder": [
    "game1",
    "game3",
    "game5"
  ],
  "games": {
    "game1": {
      "type": "quiz",
      "title": "Spiel 1 - Quiz",
      "questions": [...]
    },
    "game3": {
      "type": "guessing",
      "title": "Spiel 3 - Ratespiel",
      "questions": [...]
    }
  }
}
```

### Configuration Structure

#### `gameOrder` (Array)
- Defines which games to include and their order
- Reference games by their ID (e.g., "game1", "game2", etc.)
- You can include games multiple times or skip games entirely
- Example: `["game1", "game3", "game1"]` would play game1, then game3, then game1 again

#### `games` (Object)
- Contains configuration for each game
- Each game must have:
  - `type`: The game type (quiz, guessing, buzzer, music, image, oddoneout, factorfake)
  - `title`: Display title for the game
  - `questions`: Array of questions (structure varies by game type)

## Game Types

### 1. Quiz (`type: "quiz"`)
Standard quiz game where teams write answers.
```json
{
  "type": "quiz",
  "title": "General Knowledge Quiz",
  "questions": [
    { "question": "What is 2+2?", "answer": "4" }
  ]
}
```

### 2. Guessing (`type: "guessing"`)
Teams guess numerical answers, closest wins.
```json
{
  "type": "guessing",
  "title": "Number Guessing Game",
  "questions": [
    { "question": "How many countries in Europe?", "answer": 44 }
  ]
}
```

### 3. Buzzer (`type: "buzzer"`)
Fast-paced buzzer quiz.
```json
{
  "type": "buzzer",
  "title": "Speed Quiz",
  "questions": [
    { "question": "Capital of France?", "answer": "Paris" }
  ]
}
```

### 4. Music (`type: "music"`)
Music recognition game (uses music folder).
```json
{
  "type": "music",
  "title": "Music Quiz"
}
```

### 5. Image (`type: "image"`)
Image recognition game (uses images folder).
```json
{
  "type": "image",
  "title": "Picture Quiz"
}
```

### 6. Odd One Out (`type: "oddoneout"`)
Find the false statement among true ones.
```json
{
  "type": "oddoneout",
  "title": "Spot the Fake",
  "questions": [
    {
      "Frage": "Which is wrong?",
      "trueStatements": ["Statement 1", "Statement 2", "Statement 3"],
      "wrongStatement": "False Statement",
      "answer": "Explanation"
    }
  ]
}
```

### 7. Fact or Fake (`type: "factorfake"`)
Determine if statements are true or false.
```json
{
  "type": "factorfake",
  "title": "Fact or Fake",
  "questions": [
    {
      "statement": "The Earth is flat",
      "isFact": false,
      "description": "Explanation why this is false"
    }
  ]
}
```

## Creating a New Gameshow

### Quick Start

1. **Copy the template**:
   ```bash
   cp config.template.json config.json
   ```

2. **Edit `config.json`**:
   - Modify `gameOrder` to select which games and in what order
   - Update game configurations with your questions
   - Add or remove games as needed

3. **Start the server**:
   ```bash
   npm start
   ```

### Example: Creating a 3-Game Show

```json
{
  "gameOrder": ["myQuiz", "myGuess", "myBuzzer"],
  "games": {
    "myQuiz": {
      "type": "quiz",
      "title": "Science Quiz",
      "questions": [
        { "question": "Example Question", "answer": "Example Answer" },
        { "question": "What is H2O?", "answer": "Water" },
        { "question": "What is CO2?", "answer": "Carbon Dioxide" }
      ]
    },
    "myGuess": {
      "type": "guessing",
      "title": "History Numbers",
      "questions": [
        { "question": "Example", "answer": 0 },
        { "question": "Year Columbus discovered America?", "answer": 1492 }
      ]
    },
    "myBuzzer": {
      "type": "buzzer",
      "title": "Speed Round",
      "questions": [
        { "question": "Example", "answer": "Example" },
        { "question": "Fastest land animal?", "answer": "Cheetah" }
      ]
    }
  }
}
```

## Architecture

### File Structure

```
gameshow/
├── config.json              # Your gameshow configuration
├── config.template.json     # Template with all game types
├── server.js               # Node.js server with dynamic routing
├── package.json
└── public/
    ├── index.html          # Team setup page
    ├── rules.html          # Dynamic rules page
    ├── game-loader.html    # Universal game loader
    ├── game1.html          # Legacy game pages (still work)
    ├── game2.html
    ├── ...
    └── game-modules/       # Modular game system
        ├── base-game.js          # Base class for all games
        ├── game-factory.js       # Factory for creating games
        ├── quiz-game.js          # Quiz game module
        ├── guessing-game.js      # Guessing game module
        ├── buzzer-game.js        # Buzzer game module
        ├── music-game.js         # Music game module
        ├── image-game.js         # Image game module
        ├── oddoneout-game.js     # Odd one out module
        └── factorfake-game.js    # Fact or fake module
```

### How It Works

1. **Server** (`server.js`):
   - Reads `config.json` to determine available games
   - Provides API endpoints to fetch game configurations
   - Serves the dynamic game loader for all games

2. **Game Loader** (`game-loader.html`):
   - Universal HTML template for all game types
   - Fetches game config from server based on URL parameter
   - Loads appropriate game module dynamically

3. **Game Modules** (`public/game-modules/`):
   - Each game type has its own JavaScript class
   - All extend `BaseGame` for common functionality
   - `GameFactory` creates the appropriate game instance

## API Endpoints

### GET `/api/config`
Returns the complete configuration including all games.

### GET `/api/game-order`
Returns just the game order and total count.
```json
{
  "gameOrder": ["game1", "game3"],
  "totalGames": 2
}
```

### GET `/api/game/:index`
Returns configuration for a specific game by index.
```json
{
  "gameId": "game1",
  "config": { "type": "quiz", "title": "...", "questions": [...] },
  "currentIndex": 0,
  "totalGames": 7
}
```

### GET `/game?index=0`
Loads the game at the specified index using the dynamic loader.

## Adding a New Game Type

To add a completely new game type:

1. **Create a new module** in `public/game-modules/`:
   ```javascript
   // my-game.js
   class MyGame extends BaseGame {
       init() {
           super.init();
           // Your initialization
       }
       
       handleNavigation() {
           // Your navigation logic
       }
   }
   ```

2. **Register in GameFactory**:
   ```javascript
   // game-factory.js
   case 'mytype':
       return new MyGame(config, gameId, currentGameIndex, totalGames);
   ```

3. **Load in game-loader.html**:
   ```html
   <script src="/game-modules/my-game.js"></script>
   ```

4. **Use in config.json**:
   ```json
   {
     "type": "mytype",
     "title": "My New Game",
     ...
   }
   ```

## Tips for Creating Gameshows

1. **First Question as Example**: The first question in most game types is treated as an example
2. **Game IDs**: Use descriptive IDs for games (e.g., "scienceQuiz", "mathGuess")
3. **Testing**: Test with `config.template.json` first to see all game types
4. **Reusing Games**: You can reference the same game multiple times in `gameOrder`
5. **Flexible Length**: Have 1 game or 100 games - it's fully dynamic

## Backwards Compatibility

The old URLs (`/game1`, `/game2`, etc.) still work and redirect to the new dynamic system. Legacy HTML files are preserved but not required for new gameshows.

## Troubleshooting

### Game not loading
- Check that the game ID in `gameOrder` matches a key in `games`
- Verify the game type is valid
- Check browser console for errors

### Questions not appearing
- Ensure questions array is properly formatted
- First question is treated as example (not counted in total)

### Navigation not working
- Ensure game module is loaded in `game-loader.html`
- Check that `handleNavigation()` is implemented in the game module

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## License

[Your License Here]
