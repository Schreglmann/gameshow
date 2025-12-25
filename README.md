# Modular Gameshow Application

A flexible, configurable gameshow system where you can create custom gameshows by simply editing a configuration file. Supports rich media including images, audio, and interactive question formats.

## 🎮 Quick Start

1. **Setup**:
   ```bash
   npm install
   ```

2. **Create your gameshow configuration**:
   
   **Option A - Use the interactive generator:**
   ```bash
   npm run generate
   ```
   
   **Option B - Copy and edit the template:**
   ```bash
   cp config.template.json config.json
   # Edit config.json to configure your games
   ```

3. **Create required folders** (for media assets):
   ```bash
   mkdir -p audio-guess image-guess images audio
   ```
   - `audio-guess/` - Audio clips for audio-guess game (organize in subfolders)
   - `image-guess/` - Images for image-game
   - `images/` - Images for simple-quiz answers
   - `audio/` - Audio files for simple-quiz answers

4. **Validate your configuration**:
   ```bash
   npm run validate
   ```

5. **Start the server**:
   ```bash
   npm start
   ```

6. **Open in browser**:
   ```
   http://localhost:3000
   ```

## ✨ Features

- **🔧 Fully Modular**: Games are separate modules that can be mixed and matched
- **⚙️ Config-Driven**: Create different gameshows by editing `config.json`
- **🎯 Dynamic**: Number of games and their order are completely flexible
- **🔄 Reusable**: Use the same game type multiple times with different content
- **📝 Easy to Extend**: Add new game types by creating new modules
- **🖼️ Rich Media**: Support for images and audio in quiz answers
- **📊 Answer Lists**: Display ranked lists with highlighted correct answers
- **🎨 Beautiful UI**: Modern glassmorphism design with smooth animations

## 🎲 Available Game Types

1. **Simple Quiz** (`simple-quiz`) - Standard Q&A with optional images, audio, and ranked lists
2. **Audio Guess** (`audio-guess`) - Music/sound recognition from audio clips
3. **Guessing Game** (`guessing-game`) - Numerical guessing (closest answer wins)
4. **Image Game** (`image-game`) - Picture identification
5. **Four Statements** (`four-statements`) - Find the odd one out
6. **Fact or Fake** (`fact-or-fake`) - Determine truth from fiction
7. **Final Quiz** (`final-quiz`) - Fast-paced buzzer round

## 📖 Documentation

- **[GAME_TYPES.md](GAME_TYPES.md)** - Comprehensive guide for each game type with examples
- **[MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)** - Technical documentation and system architecture

## 🚀 Creating a Custom Gameshow

Edit `config.json` to configure your games:

```json
{
  "gameOrder": ["game1", "game2", "game3"],
  "games": {
    "game1": {
      "type": "simple-quiz",
      "title": "Geography Quiz",
      "randomizeQuestions": true,
      "questions": [
        {
          "question": "Second highest mountain?",
          "answer": "K2 (8.611 m)",
          "answerList": [
            "1. Mount Everest (8.849 m)",
            "2. K2 (8.611 m)",
            "3. Kangchenzönga (8.586 m)"
          ],
          "answerImage": "/images/k2.jpg"
        }
      ]
    },
    "game2": {
      "type": "audio-guess",
      "title": "Music Quiz"
    }
  }
}
```

**Simple Quiz Features**:
- `answerList` - Display ranked lists with the correct answer highlighted
- `answerImage` - Show image alongside answer (path: `/images/filename.jpg`)
- `answerAudio` - Play audio when answer is revealed (path: `/audio/filename.mp3`)

See [GAME_TYPES.md](GAME_TYPES.md) for detailed examples of all game types.

## 📁 Project Structure

```
gameshow/
├── config.json              # Your gameshow configuration
├── config.template.json     # Configuration template
├── server.js               # Express server
├── package.json            # Dependencies
├── public/
│   ├── index.html          # Landing page
│   ├── admin.html          # Host control panel
│   ├── game-loader.html    # Dynamic game loader
│   ├── rules.html          # Game rules display
│   ├── summary.html        # Final scores
│   ├── script.js           # Main client logic
│   ├── styles.css          # UI styling
│   └── game-modules/       # Game type modules
│       ├── base-game.js    # Base class
│       ├── game-factory.js # Game instantiation
│       ├── simple-quiz.js
│       ├── audio-guess.js
│       ├── guessing-game.js
│       ├── image-game.js
│       ├── four-statements.js
│       ├── fact-or-fake.js
│       └── final-quiz.js
├── audio-guess/            # Audio clips for audio-guess
│   └── round1/             # Subfolder per game
├── image-guess/            # Images for image-game
├── images/                 # Images for simple-quiz answers
├── audio/                  # Audio for simple-quiz answers
├── GAME_TYPES.md          # Game type documentation
└── MODULAR_SYSTEM.md      # Technical documentation
```

## 🛠️ Development

```bash
npm run generate  # Interactive config generator
npm run validate  # Validate your config.json
npm run dev       # Start with auto-reload
npm start         # Production mode
```

## 📝 Requirements

- Node.js (v12+)
- Express.js

## 🆘 Support

See documentation files for help:
- **[GAME_TYPES.md](GAME_TYPES.md)** - Configuration examples for each game type
- **[MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)** - System architecture and technical details

**Common Issues**:
- Ensure all media files are in the correct folders (`audio-guess/`, `image-guess/`, `images/`, `audio/`)
- Validate your `config.json` with `npm run validate`
- Check that file paths in config match actual file locations (case-sensitive)
- For audio-guess and image-game, files are auto-discovered from folders

## 🎨 Customization

- **Appearance**: Edit [public/styles.css](public/styles.css) for colors, fonts, and layout
- **Game Logic**: Modify modules in [public/game-modules/](public/game-modules/)
- **New Game Types**: Create new modules extending the `BaseGame` class
- **UI Text**: Update HTML files in [public/](public/) directory

## 📦 Technologies

- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Styling**: CSS3 with glassmorphism design
- **Audio/Images**: Native HTML5 media elements
