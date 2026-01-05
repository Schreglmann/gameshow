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

**How to Play**:
1. Question is displayed to both teams
2. Teams write down their answers
3. Host clicks to reveal the answer
4. Host awards points to the winning team

---

## 2. Audio Guess (`audio-guess`)

**Description**: Teams listen to audio clips and identify the song, artist, or sound.

**Configuration Example**:
```json
{
  "type": "audio-guess",
  "title": "Music Quiz",
  "randomizeQuestions": false,
  "rules": [
    "Listen to the audio clip",
    "Identify the song or artist",
    "First correct answer wins"
  ],
  "questions": []
}
```

**Special Setup**:
- Create a folder in `/audio-guess/` directory (e.g., `/audio-guess/round1/`)
- Place audio files (MP3 format) in this folder
- Questions are automatically generated from the audio files
- File names become the answers (without extension)

**Example Structure**:
```
audio-guess/
  round1/
    Bohemian Rhapsody.mp3
    Imagine.mp3
    Hotel California.mp3
```

**How to Play**:
1. Audio clip plays automatically
2. Teams listen and write their answer
3. Host reveals the correct answer
4. Host awards points

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

## 4. Image Game (`image-game`)

**Description**: Teams identify what's shown in an image.

**Configuration Example**:
```json
{
  "type": "image-game",
  "title": "Picture Quiz",
  "randomizeQuestions": false,
  "rules": [
    "Look at the image",
    "Identify what you see"
  ],
  "questions": []
}
```

**Special Setup**:
- Place images in the `/image-guess/` directory
- Questions are automatically generated from image files
- File names become the answers (without extension)

**Example Structure**:
```
image-guess/
  Eiffel Tower.jpg
  Taj Mahal.png
  Great Wall of China.jpg
```

**How to Play**:
1. Image is displayed
2. Teams write their answers
3. Host reveals the correct answer
4. Host awards points

---

## 5. Four Statements (`four-statements`)

**Description**: Teams identify which of four statements is different or false.

**Configuration Example**:
```json
{
  "type": "four-statements",
  "title": "Odd One Out",
  "randomizeQuestions": true,
  "rules": [
    "Read all four statements",
    "Identify which one is different"
  ],
  "questions": [
    {
      "statements": [
        "Paris is in France",
        "Berlin is in Germany",
        "Madrid is in Italy",
        "London is in England"
      ],
      "answer": "Madrid is in Italy",
      "explanation": "Madrid is actually in Spain, not Italy"
    }
  ]
}
```

**How to Play**:
1. Four statements are displayed
2. Teams identify the odd one out
3. Host reveals the correct answer with explanation
4. Host awards points

---

## 6. Fact or Fake (`fact-or-fake`)

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

## 7. Quizjagd (`quizjagd`)

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

## 8. Final Quiz (`final-quiz`)

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
├── audio/              # Audio files for simple-quiz answers
├── audio-guess/        # Audio clips for audio-guess game
│   └── round1/        # Subfolder for each audio-guess game
├── image-guess/        # Images for image-game
├── images/            # Images for simple-quiz answers
└── config.json        # Main configuration file
```

---

## Tips for Creating Games

1. **Start Simple**: Begin with simple-quiz to test your setup
2. **Test Questions**: Use the first question as a test/example
3. **Use Descriptive Names**: Name your audio/image files clearly - they become the answers
4. **Balance Difficulty**: Mix easy and hard questions for engagement
5. **Prepare Media**: Have all images and audio ready before configuring
6. **Check Paths**: Verify all file paths are correct (case-sensitive)
7. **Validate JSON**: Use a JSON validator to check your config file before running
