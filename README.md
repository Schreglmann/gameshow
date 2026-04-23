# Gameshow

A browser-based team quiz gameshow for live events. Two teams compete across multiple game rounds. The host controls the app from any device on the same network.

---

## Table of Contents

- [How to Play](#how-to-play)
  - [Starting the Game](#1-starting-the-game)
  - [Rules Screen](#2-rules-screen)
  - [During a Game](#3-during-a-game)
  - [Game Types](#4-game-types)
  - [Awarding Points](#5-awarding-points)
  - [Background Music](#6-background-music)
  - [End of the Gameshow](#7-end-of-the-gameshow)
- [Admin & Setup](#admin--setup)
- [Developer Docs](#developer-docs)

---

## How to Play

Two teams compete across multiple rounds. The host drives the app — players just watch and answer.

### 1. Starting the Game

Open the app in a browser. You will see the **Home Screen**.

![Home Screen](./docs/screenshots/home-screen.png)

Enter the names of all players into the text field, separated by commas:

```
Anna, Ben, Clara, David
```

Click **Weiter**. The app randomly assigns players to **Team 1** and **Team 2**.

> **Tip:** If the team randomization screen does not appear, the host has disabled it — the game starts directly.

---

### 2. Rules Screen

Before the first game, the global rules of the gameshow are shown.

![Rules Screen](./docs/screenshots/rules-screen.png)

Read the rules, then click **Weiter** or press the **→ right arrow key** to continue.

---

### 3. During a Game

The header at the top of the screen always shows both **team names**, their **scores**, and which game you are on (e.g. *Spiel 2 von 5*).

![Game Header](./docs/screenshots/header.png)

**Navigation**

| Action | Key / Click |
|--------|-------------|
| Next step / reveal answer | `→` Arrow, `Space`, `Enter`, or click anywhere |
| Go back (where supported) | `←` Arrow or `Backspace` |

---

### 4. Game Types

#### Simple Quiz

A question is shown. Both teams discuss and give their answer. The host then reveals the correct answer and awards points to the winning team.

![Simple Quiz — Question](./docs/screenshots/simple-quiz-question.png)

![Simple Quiz — Answer revealed](./docs/screenshots/simple-quiz-answer.png)

---

#### Bet Quiz (Einsatzquiz)

Before each question the category is revealed. Both teams **secretly wager** a portion of their current points. The team with the higher bet answers — correct gains the bet, wrong loses it. The gamemaster enters the winning team and their bet on the gamemaster panel; bets are hard-capped at the team's current points.

---

#### Guessing Game (Schätzspiel)

A numerical question is asked (e.g. *"How tall is the Eiffel Tower in meters?"*). Both teams write down a number — the team **closest** to the correct answer wins.

![Guessing Game](./docs/screenshots/guessing-game.png)

---

#### Q1 (Vier Aussagen)

Four statements about a topic are shown. **Three are true, one is false.** Teams pick the statement they think is wrong. The host then reveals the answer. (This game was previously named "four-statements".)

![Q1](./docs/screenshots/q1.png)

---

#### Four Statements (Hinweise raten)

Up to four clue-statements are revealed one at a time. Teams guess the target concept; host reveals the answer (text and/or image) after the last clue.

---

#### Fact or Fake (Fakt oder Fake)

A single statement is shown. Teams decide: **Fakt** (true) or **Fake** (false)? The host reveals the answer and an explanation.

![Fact or Fake](./docs/screenshots/fact-or-fake.png)

---

#### Audio Guess (Audio-Raten)

A music clip plays automatically. Teams try to identify the **song or artist**.

![Audio Guess](./docs/screenshots/audio-guess.png)

> Background music fades out automatically during this game type.

---

#### Video Guess (Video-Raten)

A short video clip plays. Teams try to identify the **movie, show, or scene**. The host reveals the answer; points are awarded via the points screen.

> Videos are transcoded on the fly and cached locally for smooth playback without live encoding during the show.

---

#### Bandle

A song plays in progressively longer snippets (Bandle-style). The first team to correctly name **title and artist** wins; the earlier they guess, the higher the points. The host picks the winner.

---

#### Image Guess (Bild-Raten)

An image is revealed progressively (blurred, pixelated, or cropped). Teams guess the **subject** (e.g. a movie, celebrity, or location). The host reveals the full image and awards points to the winner.

---

#### Color Guess (Farb-Puzzle)

Teams see only an auto-generated pie chart of a photo or logo's dominant colors (each wedge labelled with its percentage, hex revealed on hover). They guess what the image is; on reveal, the original image appears next to the chart. Works for PNG, JPG, and SVG — colors are extracted automatically on upload.

---

#### Quizjagd

Teams take turns. The active team picks a **difficulty level**, then answers a question:

| Difficulty | Points won / lost |
|------------|------------------|
| Easy | 3 |
| Medium | 5 |
| Hard | 7 |

Correct answer → points earned. Wrong answer → points deducted (minimum 0). Points are awarded **immediately** without a separate screen.

![Quizjagd](./docs/screenshots/quizjagd.png)

---

#### Final Quiz

A fast-paced buzzer round. The host reads a question and taps the team that buzzed in first. Correct = +1 point. Wrong = the other team gets a chance.

![Final Quiz](./docs/screenshots/final-quiz.png)

---

### 5. Awarding Points

After most game types, the host sees a points screen. Click the winning team — or **Unentschieden** for a draw — to add the points and move to the next game.

![Award Points](./docs/screenshots/award-points.png)

---

### 5b. Jokers

If the active gameshow has jokers enabled, each team sees a row of joker icons at the bottom of the screen. Teams spend jokers by clicking the icon (or the host marks them used from the Gamemaster screen). Each joker is single-use per team; the gamemaster resolves the joker's effect manually. Jokers cannot be used in the last game. The available jokers per gameshow are configured in **Admin → Config**. See [specs/jokers.md](./specs/jokers.md) for the full design.

---

### 6. Background Music

A music panel is available on the right edge of the screen. Click the tab to open it.

![Music Panel](./docs/screenshots/music-panel.png)

From here you can play/pause, skip tracks, and adjust volume. Music crossfades smoothly between tracks (3-second fade).

---

### 7. End of the Gameshow

After all games are complete, the **Summary Screen** appears with the winner and a confetti animation.

![Summary Screen](./docs/screenshots/summary-screen.png)

---

## Admin & Setup

For instructions on **installing the app**, **creating your own gameshow**, adding questions, and uploading media, see the **[Admin Guide](./docs/admin-guide.md)**.

**Quick start:**

```bash
npm install
npm start
```

Open `http://localhost:3000` — admin panel at `http://localhost:3000/admin`.

---

## Developer Docs

- [AGENTS.md](./AGENTS.md) — AI development conventions and spec-driven workflow
- [specs/](./specs/) — Feature specifications (including [admin-backend.md](./specs/admin-backend.md) for the `/admin` CMS)
- [specs/api/](./specs/api/) — Formal API contracts (OpenAPI + AsyncAPI). Replace any PWA (show / admin / gamemaster) by implementing the contract for that zone.
- [docs/replace-frontend.md](./docs/replace-frontend.md) / [replace-admin.md](./docs/replace-admin.md) / [replace-gamemaster.md](./docs/replace-gamemaster.md) — Per-zone drop-in replacement guides
