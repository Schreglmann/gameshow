# Game Types Documentation

This document provides detailed information about each game type available in the gameshow system.

---

## 1. Simple Quiz (`simple-quiz`)

**Description**: Standard quiz game where teams answer questions. The host reveals the answer after both teams have submitted their responses.

**Configuration Example**:
```json
{
  "type": "simple-quiz",
  "title": "General Knowledge Quiz",
  "randomizeQuestions": true,
  "rules": [
    "Each team writes down their answer",
    "Points are awarded to the team with the correct answer"
  ],
  "questions": [
    {
      "question": "What is the capital of France?",
      "answer": "Paris"
    }
  ]
}
```

**Optional Features**:
- **Answer List**: Display a ranked list with the correct answer highlighted
  ```json
  {
    "question": "Second highest mountain?",
    "answer": "K2 (8.611 m)",
    "answerList": [
      "1. Mount Everest (8.849 m)",
      "2. K2 (8.611 m)",
      "3. Kangchenzönga (8.586 m)",
      "4. Lhotse (8.516 m)",
      "5. Makalu (8.485 m)"
    ]
  }
  ```

- **Answer Image**: Display an image alongside the answer
  ```json
  {
    "question": "Who painted the Mona Lisa?",
    "answer": "Leonardo da Vinci",
    "answerImage": "/images/mona-lisa.jpg"
  }
  ```

- **Answer Audio**: Play audio when the answer is revealed
  ```json
  {
    "question": "What is this instrument?",
    "answer": "Violin",
    "answerAudio": "/audio/violin.mp3"
  }
  ```

- **Question Audio**: Play audio during the question (stops when answer is revealed)
  ```json
  {
    "question": "What song is this?",
    "answer": "Never Gonna Give You Up",
    "questionAudio": "/audio/rickroll-clip.mp3"
  }
  ```

- **Replace Image**: Swap the question image with the answer image instead of showing it separately
  ```json
  {
    "question": "What logo is this?",
    "questionImage": "/images/logo-blurred.jpg",
    "answerImage": "/images/logo-clear.jpg",
    "replaceImage": true
  }
  ```

**How to Play**:
1. Question is displayed to both teams
2. Teams write down their answers
3. Host clicks to reveal the answer
4. Host awards points to the winning team

---

## 1b. Bet Quiz / Einsatzquiz (`bet-quiz`)

**Description**: Same question shape as `simple-quiz` but with a required `category` per question. Before each question the category is revealed; both teams secretly write down a wager from their current total points. The gamemaster selects which team had the higher bet and enters the bet amount — that team answers the question. Correct → team gains the bet; wrong → team loses the bet. The bet is hard-capped at the team's current points.

**Configuration Example**:
```json
{
  "type": "bet-quiz",
  "title": "Einsatzquiz",
  "rules": [
    "Vor jeder Frage wird die Kategorie enthüllt.",
    "Beide Teams setzen geheim einen Teil ihrer Punkte.",
    "Das Team mit dem höheren Einsatz beantwortet."
  ],
  "questions": [
    { "category": "Geografie", "question": "Hauptstadt von Australien?", "answer": "Canberra" },
    { "category": "Sport", "question": "Wie viele Spieler im Fussball-Team?", "answer": "11" }
  ]
}
```

Question fields match `simple-quiz` (image, audio, list, colors, timer, replaceImage) — `category` is required.

**How the Game Works**:
1. Category screen reveals the topic of the next question
2. Teams write their bets secretly (on paper)
3. Gamemaster picks the winning team + enters their bet (hard-capped at the team's current points)
4. Question is shown; a banner on screen displays the team, its members, and the bet amount
5. Host reveals answer, marks Richtig/Falsch — points are awarded (+bet / −bet) immediately
6. The first question acts as an example (no points awarded)

---

## 2. Audio Guess (`audio-guess`)

**Description**: Teams listen to audio clips and identify the song, artist, or sound. Questions are defined in JSON with audio trim markers for short/long versions.

**Configuration Example**:
```json
{
  "type": "audio-guess",
  "title": "Music Quiz",
  "rules": [
    "Aufgabe: Identifizieren eines Songs anhand eines sehr kurzen Ausschnittes.",
    "Beide Teams schreiben ihre Antwort auf.",
    "Wenn keines der Teams den Song erkennen kann, wird eine längere Version gespielt."
  ],
  "questions": [
    {
      "answer": "bad guy - Billie Eilish",
      "audio": "/audio/audio-guess/song.m4a",
      "audioStart": 30,
      "audioEnd": 33,
      "isExample": true
    },
    {
      "answer": "Dancing Queen - ABBA",
      "audio": "/audio/audio-guess/abba.m4a",
      "audioStart": 10,
      "audioEnd": 14
    }
  ]
}
```

**Question Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `answer` | string | yes | Song name / artist shown on reveal |
| `audio` | string | yes | Path to audio file in `/audio/` DAM |
| `audioStart` | number | no | Start time (seconds) for the short clip; also used as start for the long version |
| `audioEnd` | number | no | End time (seconds) for the short clip |
| `isExample` | boolean | no | Marks the question as an example |

**How to Play**:
1. Short audio clip plays automatically (trimmed via `audioStart`/`audioEnd`)
2. Teams listen and write their answer
3. If no one guesses, the host plays the longer version (from `audioStart`)
4. Host reveals the correct answer
5. Host awards points

---

## 2b. Video Guess (`video-guess`)

**Description**: Teams watch a video clip and guess what film, show, or scene is being shown. The video plays from a start marker to a question marker, then pauses. On reveal, the answer text is shown and optionally the video continues to an answer end marker.

**Configuration Example**:
```json
{
  "type": "video-guess",
  "title": "Film Quiz",
  "rules": [
    "Aufgabe: Erkennt den Film anhand eines kurzen Ausschnittes.",
    "Beide Teams schreiben ihre Antwort auf.",
    "Nach der Auflösung wird optional ein weiterer Ausschnitt gezeigt."
  ],
  "questions": [
    {
      "answer": "Der Hobbit - Eine unerwartete Reise",
      "video": "/videos/der-hobbit.m4v",
      "videoStart": 120,
      "videoQuestionEnd": 135,
      "videoAnswerEnd": 160
    },
    {
      "answer": "Iron Man",
      "video": "/videos/iron-man.mp4",
      "videoStart": 60,
      "videoQuestionEnd": 75,
      "videoAnswerEnd": 90
    }
  ]
}
```

**Question Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `answer` | string | yes | Answer text shown on reveal |
| `video` | string | yes | Path to video file in `/videos/` DAM |
| `videoStart` | number | no | Start time (seconds) for playback (default: 0) |
| `videoQuestionEnd` | number | no | Time (seconds) where video pauses for the question |
| `videoAnswerEnd` | number | no | Time (seconds) where the answer segment ends |
| `answerImage` | string | no | Path to image shown alongside answer |

**How to Play**:
1. Video clip plays automatically from `videoStart` to `videoQuestionEnd`, then pauses
2. Teams discuss and write their answer
3. Host reveals the answer — answer text is shown
4. If `videoAnswerEnd` is set, video continues from `videoQuestionEnd` to `videoAnswerEnd`
5. Host awards points

---

## 3. Guessing Game (`guessing-game`)

**Description**: Teams guess numerical values. The team closest to the correct answer wins.

**Configuration Example**:
```json
{
  "type": "guessing-game",
  "title": "Number Guessing",
  "randomizeQuestions": true,
  "rules": [
    "Both teams enter their guess",
    "Closest answer wins the round"
  ],
  "questions": [
    {
      "question": "How many countries are in Europe?",
      "answer": 44
    },
    {
      "question": "Population of Tokyo (in millions)?",
      "answer": 37400000
    }
  ]
}
```

**Features**:
- Automatic number formatting (e.g., 1.000.000)
- Calculates which team is closer
- Displays both guesses and the correct answer

**How to Play**:
1. Question is displayed
2. Both teams enter their numerical guess
3. Host submits both guesses
4. System reveals which team was closer
5. Host awards points to the winning team

---

## 4. Q1 (`q1`)

**Description**: Teams identify the one false statement among four — three are true, one is false. Spec: [`specs/games/q1.md`](specs/games/q1.md).

**Configuration Example**:
```json
{
  "type": "q1",
  "title": "Q1",
  "randomizeQuestions": true,
  "rules": [
    "Drei Aussagen sind wahr, eine ist falsch",
    "Findet die falsche Aussage"
  ],
  "questions": [
    {
      "Frage": "Tier",
      "trueStatements": [
        "Es ist ein Säugetier",
        "Es lebt meist in Afrika",
        "Es hat einen langen Rüssel"
      ],
      "wrongStatement": "Es legt Eier",
      "answer": "Elefant"
    }
  ]
}
```

**How to Play**:
1. Statements are revealed one at a time
2. Teams confer as each new statement appears
3. After all four, host advances to reveal which is false (red) and which are true (green)

## 4b. Four Statements (`four-statements`)

**Description**: Host reveals up to 4 clue-statements one at a time, describing a target concept. After the last clue, host reveals the answer (text and/or image). Spec: [`specs/games/four-statements.md`](specs/games/four-statements.md).

**Configuration Example**:
```json
{
  "type": "four-statements",
  "title": "Wer bin ich?",
  "rules": ["Errate die Lösung anhand von bis zu 4 Hinweisen."],
  "questions": [
    {
      "topic": "Gesucht ist ein Erfinder",
      "statements": [
        "Geboren 1847 in den USA",
        "Hält über 1000 Patente",
        "Gründete General Electric",
        "Sein bekanntestes Produkt leuchtet"
      ],
      "answer": "Thomas Edison",
      "answerImage": "images/edison.jpg"
    }
  ]
}
```

**How to Play**:
1. Host shows the topic prompt; no clues visible yet
2. Host advances once per clue to reveal it
3. After the last clue, host advances once more to reveal the answer (text + image)
4. Host awards points

---

## 5. Fact or Fake (`fact-or-fake`)

**Description**: Teams determine if a statement is true (fact) or false (fake).

**Configuration Example**:
```json
{
  "type": "fact-or-fake",
  "title": "True or False",
  "randomizeQuestions": true,
  "rules": [
    "Read the statement carefully",
    "Decide if it's a fact or fake"
  ],
  "questions": [
    {
      "statement": "The Great Wall of China is visible from space",
      "answer": "Fake",
      "explanation": "This is a common myth. The Great Wall is not visible from space with the naked eye."
    },
    {
      "statement": "Honey never spoils",
      "answer": "Fact",
      "explanation": "Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible."
    }
  ]
}
```

**How to Play**:
1. Statement is displayed
2. Teams vote "Fact" or "Fake"
3. Host reveals the answer with explanation
4. Host awards points to correct teams

---

## 6. Quizjagd (`quizjagd`)

**Description**: Turn-based betting quiz game where teams alternate choosing question difficulty and wager points accordingly.

**Configuration Example**:
```json
{
  "type": "quizjagd",
  "title": "Quiz Hunt",
  "questionsPerTeam": 10,
  "rules": [
    "Teams take turns",
    "Choose 3, 5, or 7 points for easy, medium, or hard questions",
    "Correct: gain points, Wrong: lose points",
    "Each team answers 10 questions"
  ],
  "questions": [
    {
      "question": "Example: How many legs does a spider have?",
      "answer": "8",
      "difficulty": 3,
      "isExample": true
    },
    {
      "question": "What is the capital of Italy?",
      "answer": "Rome",
      "difficulty": 3
    },
    {
      "question": "What year did World War II end?",
      "answer": "1945",
      "difficulty": 5
    },
    {
      "question": "What is the Heisenberg Uncertainty Principle?",
      "answer": "Simultaneous indeterminacy of position and momentum",
      "difficulty": 7
    }
  ]
}
```

**Configuration Options**:
- **`questionsPerTeam`** (optional): Number of questions each team answers (default: 10)

**How to Play**:
1. Teams alternate turns
2. Active team chooses difficulty: 3 (easy), 5 (medium), or 7 (hard) points
3. Question is displayed based on chosen difficulty
4. Team answers the question
5. Host marks answer as correct or incorrect
6. Points are added (correct) or subtracted (incorrect)
7. Other team takes their turn
8. Each team answers the configured number of questions (default: 10)

**Question Properties**:
- **`question`** (required): The question text
- **`answer`** (required): The correct answer
- **`difficulty`** (required): Point value - 3 (easy), 5 (medium), or 7 (hard)
- **`isExample`** (optional): Set to `true` for the first question only

**Special Features**:
- First question with `isExample: true` is shown as a demonstration (no points awarded)
- Questions are randomly selected from each difficulty pool
- No question is shown twice
- Negative points are prevented (teams can't go below 0)
- Visual feedback when marking answers (green glow for correct, red for incorrect)

---

## 7. Final Quiz (`final-quiz`)

**Description**: Fast-paced buzzer round where the first team to answer correctly wins the point.

**Configuration Example**:
```json
{
  "type": "final-quiz",
  "title": "Speed Round",
  "randomizeQuestions": true,
  "rules": [
    "First team to buzz in gets to answer",
    "Correct answer wins the point",
    "Wrong answer gives the other team a chance"
  ],
  "questions": [
    {
      "question": "What is H2O?",
      "answer": "Water"
    }
  ]
}
```

**How to Play**:
1. Question is displayed
2. Teams buzz in (Team 1 or Team 2 button)
3. Buzzing team gives their answer
4. Host awards point if correct
5. Quick succession of questions

---

## 8. Bandle (`bandle`)

**Description**: Teams guess songs by hearing instruments revealed one at a time. Each question has multiple audio tracks — the first is a single instrument, each subsequent track adds more instruments to the mix. The host reveals tracks one by one; fewer tracks needed to guess = better. Inspired by bandle.app.

**Configuration Example**:
```json
{
  "type": "bandle",
  "title": "Bandle",
  "rules": [
    "Ihr hört einen Song Schicht für Schicht.",
    "Zuerst nur ein Instrument, dann kommen nach und nach weitere dazu.",
    "Wer den Song mit weniger Hinweisen erkennt, gewinnt."
  ],
  "questions": [
    {
      "answer": "Maroon 5 - Sugar",
      "tracks": [
        { "label": "Schlagzeug", "audio": "/audio/bandle/sugar/track1.mp3" },
        { "label": "Bass", "audio": "/audio/bandle/sugar/track2.mp3" },
        { "label": "Gitarre", "audio": "/audio/bandle/sugar/track3.mp3" },
        { "label": "Streicher + Orgel", "audio": "/audio/bandle/sugar/track4.mp3" },
        { "label": "Gesang", "audio": "/audio/bandle/sugar/track5.mp3" }
      ],
      "answerImage": "/images/audio-covers/maroon5-sugar.jpg",
      "isExample": true
    }
  ]
}
```

**Question Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `answer` | string | yes | Song title and artist |
| `tracks` | BandleTrack[] | yes | Ordered array of track objects |
| `tracks[].label` | string | yes | Instrument name shown on screen |
| `tracks[].audio` | string | yes | Path to pre-mixed audio file |
| `answerImage` | string | no | Cover art shown on reveal |
| `isExample` | boolean | no | Marks as example question |
| `disabled` | boolean | no | Excluded from play |

**Audio Track Convention**: Each track file is a cumulative pre-mix. Track 1 = drums only, Track 2 = drums + bass, Track 3 = drums + bass + guitar, etc. The number of tracks per question can vary (typically 3–6).

**How to Play**:
1. Host advances through the game landing and rules screens
2. First track plays automatically — teams discuss
3. Host presses right arrow to reveal the next instrument (audio auto-plays)
4. Teams can guess at any point; host can click "Auflösen" to reveal the answer immediately
5. After reveal, host advances to the next song
6. After the last song, points are awarded via AwardPoints

---

## 9. Image Guess (`image-guess`)

Teams guess what an image shows as it is progressively de-obfuscated. The image starts heavily obfuscated and automatically becomes clearer over time on a timer. The host reveals the answer when ready.

### Configuration Example

```json
{
  "type": "image-guess",
  "title": "Bilderrätsel",
  "rules": [
    "Ein Bild wird schrittweise enthüllt.",
    "Erratet so früh wie möglich, was darauf zu sehen ist!"
  ],
  "questions": [
    {
      "image": "/images/example.jpg",
      "answer": "Eiffelturm",
      "isExample": true
    },
    {
      "image": "/images/bild1.jpg",
      "answer": "Brandenburger Tor",
      "obfuscation": "blur",
      "steps": 5,
      "duration": 15
    },
    {
      "image": "/images/bild2.jpg",
      "answer": "Mona Lisa",
      "obfuscation": "pixelate",
      "answerImage": "/images/mona-lisa-full.jpg"
    },
    {
      "image": "/images/bild3.jpg",
      "answer": "Kolosseum",
      "obfuscation": "zoom",
      "zoomOrigin": "40% 60%"
    }
  ]
}
```

### Question Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | Yes | Path to image file in `/images/` DAM |
| `answer` | string | Yes | Text shown when the answer is revealed |
| `answerImage` | string | No | Different image shown on reveal (replaces question image) |
| `obfuscation` | `"blur"` \| `"pixelate"` \| `"zoom"` | No | Obfuscation effect (default: `"blur"`) |
| `steps` | number | No | Number of obfuscation levels, 2-10 (default: 5) |
| `duration` | number | No | Total seconds from max obfuscation to clear (default: 15) |
| `zoomOrigin` | string | No | CSS transform-origin for zoom mode (e.g. `"30% 70%"`) |
| `isExample` | boolean | No | Mark as example question |
| `disabled` | boolean | No | Skip this question |

### Obfuscation Modes

- **blur**: Gaussian blur that progressively sharpens (CSS `filter: blur()`)
- **pixelate**: Classic mosaic/pixel effect that increases resolution over time (canvas-based)
- **zoom**: Extreme zoom into a portion of the image that progressively zooms out to reveal the full picture

### How to Play

1. A heavily obfuscated image is shown — teams try to guess what it is
2. The image automatically becomes clearer over time (one step every `duration / steps` seconds)
3. Teams can guess at any point — guessing earlier (more obfuscated) is more impressive
4. The host advances (ArrowRight/click) to reveal the answer at any time
5. After reveal, host advances to the next image
6. After the last image, points are awarded via AwardPoints

---

## 10. Color Guess (`colorguess`)

Teams see only a pie chart of the dominant colors of an image (photo or logo, including SVG) and must guess what the image shows. The host then reveals the original image next to the chart.

### Configuration Example

```json
{
  "type": "colorguess",
  "title": "Logo Farbenspiel",
  "rules": [
    "Ihr seht nur die Farbverteilung eines Logos.",
    "Erratet, zu welcher Marke es gehört!"
  ],
  "questions": [
    { "image": "/images/Logos/Logo Quiz/level1/amazon.svg", "answer": "Amazon" },
    { "image": "/images/Logos/Logo Quiz/level1/google.svg", "answer": "Google" }
  ]
}
```

### Question Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | Yes | Path to image in `/images/` DAM. Must end in `.png`, `.jpg`, `.jpeg`, `.webp`, or `.svg` |
| `answer` | string | Yes | Text shown when the answer is revealed |
| `disabled` | boolean | No | Skip this question |

> Authors never list colors — the server extracts them from the image and caches them in `local-assets/images/.color-profiles.json`, keyed by mtime. See [specs/games/colorguess.md](specs/games/colorguess.md).

### How to Play

1. Teams see only a pie chart of the image's dominant colors, with percentages on each wedge
2. Hovering or clicking a wedge reveals its hex code
3. Teams guess what the image shows
4. The host advances (ArrowRight/click) to reveal the original image next to the pie chart
5. After the last image, points are awarded via AwardPoints

---

## 11. Ranking (`ranking`)

Teams guess the answers to a question in the correct order (e.g. "Top 5 highest-grossing films of 2023 — in order"). The host reveals one rank at a time, stacked below the question, until the full list is shown. Holding the Right arrow key reveals all remaining answers at once.

### Configuration Example

```json
{
  "type": "ranking",
  "title": "Bestenlisten",
  "rules": [
    "Errate die Antworten in der richtigen Reihenfolge.",
    "Pro Runde wird ein Platz nach dem anderen aufgelöst."
  ],
  "questions": [
    {
      "question": "Die 5 umsatzstärksten Filme 2023 – in absteigender Reihenfolge",
      "answers": [
        "Barbie",
        "The Super Mario Bros. Movie",
        "Oppenheimer",
        "Guardians of the Galaxy Vol. 3",
        "Fast X"
      ]
    }
  ]
}
```

### Question Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | The prompt shown at the top |
| `answers` | string[] | Yes | Ordered list of answers; index 0 = rank 1. At least one non-empty entry |
| `topic` | string | No | Optional subtitle rendered under the question |
| `disabled` | boolean | No | Skip this question |

### How to Play

1. Teams see the question with no answers revealed yet
2. Host advances (ArrowRight / click) to reveal one answer at a time in the correct order
3. Each revealed answer is prefixed with its rank (`1.`, `2.`, …) and stacked below the previous
4. Holding ArrowRight for ≥500 ms reveals all remaining answers at once
5. After the last answer of the last question, points are awarded via AwardPoints

---

## Common Configuration Options

### Available for All Game Types:

- **`type`** (required): The game type identifier
- **`title`** (required): Display name for the game
- **`rules`** (optional): Array of rule strings displayed before the game starts
- **`randomizeQuestions`** (optional): Set to `true` to randomize question order (preserves first question as example)

### Notes:
- First question is always treated as an example question
- Point values increase per game (Game 1 = 1 point, Game 2 = 2 points, etc.)
- All static assets (images, audio) should be placed in their respective folders

---

## Folder Structure

```
gameshow/
├── games/              # Individual game config files
│   ├── allgemeinwissen.json
│   ├── quizjagd.json
│   └── ...
├── audio/              # Audio files for quizzes (including audio-guess songs)
├── images/             # Images for simple-quiz answers
├── background-music/   # Background music (optional)
└── config.json         # Gameshow selector (activeGameshow + gameshows + settings)
```

Each game file in `games/` contains the full config for that game (type, title, rules, questions).
For games with multiple question sets, use `instances` — see [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md).

---

## Tips for Creating Games

1. **Start Simple**: Begin with simple-quiz to test your setup
2. **Test Questions**: Use the first question as a test/example
3. **Use Descriptive Names**: Name your audio/image files clearly - they become the answers
4. **Balance Difficulty**: Mix easy and hard questions for engagement
5. **Prepare Media**: Have all images and audio ready before configuring
6. **Check Paths**: Verify all file paths are correct (case-sensitive)
7. **Validate JSON**: Use a JSON validator to check your config file before running
