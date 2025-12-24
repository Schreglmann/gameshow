# Modular Gameshow Application

A flexible, configurable gameshow system where you can create custom gameshows by simply editing a configuration file.

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
   # Edit config.json to select your games
   ```

3. **Create required folders** (if using music or image games):
   ```bash
   mkdir music images
   ```

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

## 🎲 Available Game Types

1. **Quiz** - Standard Q&A format
2. **Guessing** - Numerical guessing game
3. **Buzzer** - Fast-paced buzzer quiz
4. **Music** - Music recognition
5. **Image** - Picture identification
6. **Odd One Out** - Find the false statement
7. **Fact or Fake** - Determine truth from fiction

## 📖 Documentation

For detailed documentation on creating and configuring gameshows, see [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md).

## 🚀 Creating a Custom Gameshow

Edit `config.json` to select which games to include:

```json
{
  "gameOrder": ["game1", "game3", "game5"],
  "games": {
    "game1": {
      "type": "quiz",
      "title": "Science Quiz",
      "questions": [...]
    },
    ...
  }
}
```

That's it! No code changes needed.

## 📁 Project Structure

```
gameshow/
├── config.json              # Your gameshow configuration
├── server.js               # Express server
├── public/
│   ├── game-loader.html    # Dynamic game loader
│   ├── game-modules/       # Game type modules
│   └── ...
└── music/                  # Music files for music game
└── images/                 # Images for image game
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

See [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md) for:
- Detailed configuration guide
- How to add new game types
- API documentation
- Troubleshooting

## 🎨 Customization

- Edit `styles.css` to change appearance
- Modify game modules in `public/game-modules/`
- Add new game types by extending `BaseGame` class
