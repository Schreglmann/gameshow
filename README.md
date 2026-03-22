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
   mkdir -p audio-guess images audio background-music
   ```
   - `audio-guess/` - Audio clips for audio-guess game (organize in subfolders by song name)
   - `images/` - Images for simple-quiz answers
   - `audio/` - Audio files for simple-quiz answers
   - `background-music/` - Background music files (optional, plays continuously during gameshow)

4. **Normalize audio volumes** (recommended for consistent playback):
   ```bash
   npm run normalize-audio
   ```
   This ensures all audio files in `audio/`, `audio-guess/`, and `background-music/` have consistent volume levels.

5. **Validate your configuration**:
   ```bash
   npm run validate
   ```

6. **Start the server**:
   ```bash
   npm start
   ```

7. **Open in browser**:
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
- **🎵 Background Music**: Continuous music playback with crossfading and controls
- **📊 Answer Lists**: Display ranked lists with highlighted correct answers
- **🎨 Beautiful UI**: Modern glassmorphism design with smooth animations

## 🎲 Available Game Types

1. **Simple Quiz** (`simple-quiz`) - Standard Q&A with optional images, audio, and ranked lists
2. **Audio Guess** (`audio-guess`) - Music/sound recognition from audio clips
3. **Guessing Game** (`guessing-game`) - Numerical guessing (closest answer wins)
4. **Four Statements** (`four-statements`) - Find the odd one out
5. **Fact or Fake** (`fact-or-fake`) - Determine truth from fiction
6. **Quizjagd** (`quizjagd`) - Teams bet points on questions of varying difficulty
7. **Final Quiz** (`final-quiz`) - Fast-paced buzzer round

## 📖 Documentation

- **[GAME_TYPES.md](GAME_TYPES.md)** - Comprehensive guide for each game type with examples
- **[MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)** - Technical documentation and system architecture

## 🚀 Creating a Custom Gameshow

Games are stored as individual files in `games/`. The main `config.json` selects which gameshow to run and defines all gameshows:

```json
// config.json
{
  "pointSystemEnabled": true,
  "teamRandomizationEnabled": true,
  "activeGameshow": "gameshow1",
  "gameshows": {
    "gameshow1": {
      "name": "Gameshow 1",
      "gameOrder": [
        "allgemeinwissen/v1",
        "audio-guess",
        "trump-oder-hitler",
        "quizjagd/v2"
      ]
    },
    "gameshow2": {
      "name": "Gameshow 2",
      "gameOrder": [
        "emoji-raten",
        "four-statements/v2"
      ]
    }
  }
}
```

Each game lives in its own file under `games/`:

```json
// games/trump-oder-hitler.json (single-instance)
{
  "type": "simple-quiz",
  "title": "Trump oder Hitler",
  "randomizeQuestions": true,
  "rules": ["..."],
  "questions": [...]
}

// games/allgemeinwissen.json (multi-instance)
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

**Game references in `gameOrder`**:
- `"trump-oder-hitler"` — loads `games/trump-oder-hitler.json` directly
- `"allgemeinwissen/v1"` — loads `games/allgemeinwissen.json`, picks instance `v1`

**Switching gameshows**: Change `activeGameshow` to point to a different entry in `gameshows` — no need to create a new config file.
```

**Global Options**:
- `pointSystemEnabled` - Enable/disable the point system (default: `true`). When disabled, points are hidden from the header, the award points screen is skipped, and the summary screen shows a generic end message. Note: Games that require points to function (like `final-quiz` and `quizjagd`) will still track points.
- `teamRandomizationEnabled` - Enable/disable team randomization at the start (default: `true`). When disabled, the name entry form is hidden and players can proceed directly to the rules.
- `globalRules` - Array of strings for the global rules screen (optional). If not provided, defaults to standard rules. Rules at indices 1-3 are automatically treated as point-related and hidden when points are disabled.

**Simple Quiz Features**:
- `questionImage` - Show image with the question (path: `/images/filename.jpg`)
- `timer` - Add countdown timer in seconds (e.g., `"timer": 30` for 30 seconds)
- `answerList` - Display ranked lists with the correct answer highlighted
- `answerImage` - Show image alongside answer (path: `/images/filename.jpg`)
- `answerAudio` - Play audio when answer is revealed (path: `/audio/filename.mp3`)

See [GAME_TYPES.md](GAME_TYPES.md) for detailed examples of all game types.

## 📁 Project Structure

```
gameshow/
├── config.json              # Gameshow selector (activeGameshow + gameshows + settings)
├── config.template.json     # Configuration template
├── config_gameshow1.json    # Example gameshow 1 config
├── config_gameshow2.json    # Example gameshow 2 config
├── games/                   # Individual game files
│   ├── allgemeinwissen.json # Multi-instance: v1, v2, v3
│   ├── trump-oder-hitler.json
│   ├── quizjagd.json        # Multi-instance: v1, v2
│   ├── audio-guess.json
│   └── ...                  # One file per game concept
├── server/
│   └── index.ts             # Express server
├── src/                     # React frontend
│   ├── components/
│   ├── context/
│   ├── services/
│   ├── types/
│   └── ...
├── audio-guess/             # Audio clips for audio-guess
├── images/                  # Images for quiz answers
├── audio/                   # Audio for quiz answers
├── background-music/        # Background music (optional)
├── GAME_TYPES.md            # Game type documentation
└── MODULAR_SYSTEM.md        # Technical documentation
```

## 🛠️ Development

```bash
npm run generate        # Interactive config generator
npm run validate        # Validate your config.json
npm run normalize-audio # Normalize audio volume levels
npm run dev             # Start with auto-reload
npm start               # Production mode
```

### Audio Normalization

All audio files should have consistent volume levels for the best user experience. The normalization script ensures all audio tracks play at the same loudness:

```bash
npm run normalize-audio
```

**What it does**:
- Normalizes all audio files in `audio/`, `audio-guess/`, and `background-music/` directories to -16 LUFS (web content standard)
- Recursively processes all subfolders (useful for audio-guess structure)
- Automatically backs up original files to `backup/` folders within each directory (e.g., `audio/backup/`, `audio-guess/backup/`)
- Skips already-normalized files on subsequent runs
- Works cross-platform (includes ffmpeg via npm)

**When to use**:
- After adding new audio files to your gameshow
- When audio tracks have inconsistent volume levels
- First time setup with audio content

**Note**: Original files are preserved in `backup/` folders within each audio directory, so it's safe to run. Only new/unnormalized files will be processed on subsequent runs.

## 🎵 Background Music

The gameshow includes an optional background music system that plays continuously during the show with seamless crossfading between tracks.

**Setup**:
1. Add MP3 files to the `background-music/` folder
2. Music files will be auto-discovered and shuffled randomly
3. Use the music controls to play/pause, adjust volume, skip tracks, and seek within songs

**Features**:
- **Seamless Crossfading**: 3-second crossfade between tracks for smooth transitions
- **Sliding Controls**: Unobtrusive toggle button on the right side of the screen
- **Volume Control**: Slider with percentage display (default: 15%)
- **Track Navigation**: Skip to next track, pause/resume playback
- **Interactive Timeline**: Click to seek to any position in the current track
- **Shuffled Playlist**: Random playback order on each page load

**Controls**:
- Click the **◀** button on the right edge to expand the music controls
- **▶/⏸** - Play/Pause
- **Volume slider** - Adjust volume (0-100%)
- **⏭** - Skip to next track
- **Timeline bar** - Click to seek within the current track

**Note**: The `background-music/` folder is excluded from git by default. Use copyright-free music (CC0 or similar licenses) for public distributions.

## 📝 Requirements

- Node.js (v12+)
- Express.js
- ffmpeg (included via ffmpeg-static npm package for audio normalization)

## 🆘 Support

See documentation files for help:
- **[GAME_TYPES.md](GAME_TYPES.md)** - Configuration examples for each game type
- **[MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)** - System architecture and technical details

**Common Issues**:
- Ensure all media files are in the correct folders (`audio-guess/`, `images/`, `audio/`, `background-music/`)
- Validate your `config.json` with `npm run validate`
- Check that file paths in config match actual file locations (case-sensitive)
- For audio-guess, files are auto-discovered from folders
- Background music is optional - add MP3 files to `background-music/` folder to enable

## 🎨 Customization

- **Appearance**: Edit styles in `src/styles/` and `src/*.css`
- **Game Logic**: Modify game components in `src/components/games/`
- **New Game Types**: Add new components and register in `GameFactory`
- **Add New Games**: Create a new JSON file in `games/` and reference it in the active gameshow's `gameOrder`

## 📦 Technologies

- **Backend**: Node.js with Express + TypeScript
- **Frontend**: React + TypeScript (Vite)
- **Styling**: CSS3 with glassmorphism design
- **Audio/Images**: Native HTML5 media elements
