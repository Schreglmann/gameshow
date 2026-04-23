# Admin Guide — Creating Your Own Gameshow

This guide explains how to **set up the app** and **create your own gameshow** using the Admin Panel.

---

## Table of Contents

1. [Setup & Installation](#1-setup--installation)
2. [Opening the Admin Panel](#2-opening-the-admin-panel)
3. [Creating a Gameshow](#3-creating-a-gameshow)
4. [Creating & Editing Games](#4-creating--editing-games)
   - [Simple Quiz](#simple-quiz)
   - [Bet Quiz (Einsatzquiz)](#bet-quiz)
   - [Guessing Game](#guessing-game)
   - [Q1](#q1)
   - [Four Statements](#four-statements)
   - [Fact or Fake](#fact-or-fake)
   - [Audio Guess](#audio-guess)
   - [Quizjagd](#quizjagd)
   - [Final Quiz](#final-quiz)
   - [Video Guess](#video-guess)
   - [Bandle](#bandle)
   - [Image Guess](#image-guess)
   - [Color Guess](#color-guess)
5. [Uploading Media (Images & Audio)](#5-uploading-media-images--audio)
6. [Global Settings](#6-global-settings)
7. [Managing a Live Session](#7-managing-a-live-session)
8. [Running the Gameshow](#8-running-the-gameshow)

---

## 1. Setup & Installation

### Requirements

- [Node.js](https://nodejs.org/) (v18 or later)
- A terminal

### Steps

**1. Install dependencies**

```bash
npm install
```

**2. Start the server**

```bash
npm start
```

**3. Open the app**

```
http://localhost:3000
```

The app is now running. Open it on the computer that will display the game (e.g. connected to a projector or TV).

---

## 2. Opening the Admin Panel

Go to:

```
http://localhost:3000/admin
```

This opens the Admin Panel. It has **four tabs**:

| Tab | Purpose |
|-----|---------|
| **Session** | Manage team names and points during a live session |
| **Games** | Create and edit game files |
| **Config** | Create gameshows and set the active one |
| **Assets** | Upload images and audio files |

![Admin Panel Overview](./screenshots/admin-overview.png)
> *Add screenshot: `docs/screenshots/admin-overview.png` — the admin panel with all four tabs visible*

> **Tip:** The Admin Panel never interrupts the game. You can switch between `/` and `/admin` freely at any time.

---

## 3. Creating a Gameshow

A **gameshow** is a named collection of games played in order.

### Step 1 — Go to the Config tab

![Config Tab](./screenshots/admin-config.png)
> *Add screenshot: `docs/screenshots/admin-config.png` — the Config tab*

### Step 2 — Add a new gameshow

Click **"Add new gameshow"**. A new card appears.

![New Gameshow Card](./screenshots/admin-config-new-gameshow.png)
> *Add screenshot: `docs/screenshots/admin-config-new-gameshow.png` — a new gameshow card being edited*

- Enter a **name** for your gameshow (e.g. *"Weihnachtsparty 2024"*)
- Click **"Set as active"** to make it the one that runs when players open the app

### Step 3 — Add games to the gameshow

In the **Game Order** section of your gameshow card:

1. Click **"Add game"**
2. Select a game from the dropdown
3. Drag to reorder, or click the trash icon to remove

![Game Order](./screenshots/admin-config-game-order.png)
> *Add screenshot: `docs/screenshots/admin-config-game-order.png` — the game order list with add/remove/reorder controls*

Changes save automatically.

---

## 4. Creating & Editing Games

Go to the **Games tab**.

![Games Tab](./screenshots/admin-games.png)
> *Add screenshot: `docs/screenshots/admin-games.png` — the games list with search and game type badges*

### Creating a new game

Click **"New game"**. A dialog appears:

![New Game Dialog](./screenshots/admin-games-new.png)
> *Add screenshot: `docs/screenshots/admin-games-new.png` — the new game dialog with filename and type fields*

1. Enter a **filename** (e.g. `wissensquiz`)
2. Choose a **game type**
3. Click **Create**

The editor opens automatically.

---

### Simple Quiz

A standard question-and-answer game.

![Simple Quiz Editor](./screenshots/admin-games-simple-quiz.png)
> *Add screenshot: `docs/screenshots/admin-games-simple-quiz.png` — the simple quiz question editor*

**Each question has:**
- **Question text** — what is shown to the players
- **Answer** — revealed when the host clicks
- **Timer** *(optional)* — countdown timer in seconds
- **Question Image** *(optional)* — shown with the question
- **Answer Image** *(optional)* — shown when the answer is revealed
- **Question Audio** *(optional)* — plays with the question
- **Answer Audio** *(optional)* — plays with the answer
- **Answer List** *(optional)* — show multiple answers (e.g. "Name 5 countries")

To add a question: click **"Add question"** at the bottom of the list.
To reorder: use the **↑ ↓** arrows.
To delete: click the **trash icon**.

---

### Bet Quiz

Also called *Einsatzquiz*. Same question editor as **Simple Quiz** with one extra required field: **Kategorie** (the topic shown before each question). During play, both teams secretly bet a portion of their current points on the question; the gamemaster picks the winning team and enters the bet on the gamemaster panel. Correct = +bet, wrong = −bet. The bet is hard-capped at the team's current points.

---

### Guessing Game

Teams guess a number. The closest team wins.

**Each question has:**
- **Question text** — e.g. *"How tall is the Eiffel Tower in meters?"*
- **Answer** — the correct number (e.g. `330`)
- **Answer Image** *(optional)*

---

### Q1

Four statements are shown. Three are true, one is false. Teams identify the false one. (Previously named "four-statements".)

**Each question has:**
- **Topic/Question** — the subject (e.g. *"About elephants"*)
- **3 true statements**
- **1 false statement**
- **Explanation** *(optional)* — shown after the answer is revealed

---

### Four Statements

Up to four clue-statements about a target concept. Revealed one at a time; host reveals the answer after the last clue.

**Each question has:**
- **Topic** — prompt shown at the top
- **1–4 statements** (clues)
- **Answer text** *(optional if answerImage set)*
- **Answer image** *(optional if answer set)* — picked from DAM

---

### Fact or Fake

A single statement is shown. Teams vote: true or false?

**Each question has:**
- **Statement** — e.g. *"A group of flamingos is called a flamboyance"*
- **Answer toggle** — set to **Fakt** or **Fake**
- **Explanation** *(optional)*

---

### Audio Guess

Teams identify a song or artist from an audio clip. Questions are based on **audio files** in the Assets tab — there is no question editor for this game type.

![Audio Guess Info](./screenshots/admin-games-audio-guess.png)
> *Add screenshot: `docs/screenshots/admin-games-audio-guess.png` — the audio-guess info panel pointing to the Assets tab*

To set up an Audio Guess game:

1. Go to the **Assets tab**
2. Open the **Audio-Guess** category
3. Create a folder for each question. **The folder name is the answer** shown to players.
4. Upload the audio file(s) into that folder.
5. Prefix a folder with `Beispiel_` to mark it as an example question (shown before the real game)

```
audio-guess/
├── Beispiel_Bohemian Rhapsody/    ← example question
│   └── clip.mp3
├── Hotel California/              ← real question
│   └── clip.mp3
└── Africa - Toto/
    └── clip.mp3
```

---

### Quizjagd

Teams take turns choosing a difficulty (3, 5, or 7 points) and answering questions.

**Settings:**
- **Questions per team** — how many turns each team gets

**Each question has:**
- **Question text**
- **Answer**
- **Difficulty** — 3 (easy), 5 (medium), or 7 (hard)
- **Is Example** toggle — marks the question as a practice round

---

### Final Quiz

A fast buzzer round. The host taps the team that buzzed in first.

**Each question has:**
- **Question text**
- **Answer**
- **Answer Image** *(optional)*

---

### Video Guess

A short video clip plays; teams identify the movie, show, or scene. Videos are transcoded on the fly and cached locally, so playback during the show never waits on encoding.

**Each question has:**
- **Video file** (picked from the Videos asset category)
- **Answer**
- Optional: start/end markers, subtitle language/track

See [GAME_TYPES.md](../GAME_TYPES.md) for the full field reference.

---

### Bandle

A song plays in progressively longer intros (Bandle-style). Earlier guesses score more points; the host picks the winning team.

**Each question has:**
- **Tracks** (list of audio snippets revealed in order)
- **Title / artist** as the expected answer

See [GAME_TYPES.md](../GAME_TYPES.md) for the full field reference.

---

### Image Guess

An image is revealed progressively (e.g. pixelated, blurred, or cropped). Teams guess the subject; the host reveals the full image and awards points.

**Each question has:**
- **Image file** (picked from the Images asset category)
- **Answer**
- Optional reveal settings

See [GAME_TYPES.md](../GAME_TYPES.md) for the full field reference.

---

### Color Guess

Teams see only a pie chart of the dominant colors of a photo or logo (PNG/JPG/SVG) and guess what it shows. On reveal, the host shows the original image next to the chart. Colors are extracted automatically on the server when the image is uploaded — authors only provide the image and the answer.

**Each question has:**
- **Image file** (picked from the Images asset category — `.png`, `.jpg`, `.jpeg`, `.webp`, or `.svg`)
- **Answer**

See [GAME_TYPES.md](../GAME_TYPES.md) for the full field reference and [specs/games/colorguess.md](../specs/games/colorguess.md) for behaviour details.

---

### Multi-Instance Games

Any game type can have **multiple instances** — separate question sets that share one game file. This is useful when you want to reuse the same game format across different gameshows.

![Multi-Instance Tabs](./screenshots/admin-games-instances.png)
> *Add screenshot: `docs/screenshots/admin-games-instances.png` — the tab bar showing multiple instances (v1, v2, etc.)*

To add an instance: click **"+"** in the tab bar.
To rename: double-click the active tab.
To reference in a gameshow: use `gamename/instancename` (e.g. `wissensquiz/v2`).

---

## 5. Uploading Media (Images & Audio)

Go to the **Assets tab**.

![Assets Tab](./screenshots/admin-assets.png)
> *Add screenshot: `docs/screenshots/admin-assets.png` — the assets tab with the four category tabs (Bilder, Audio, Audio-Guess, Hintergrundmusik)*

There are four categories:

| Category | Contents |
|----------|----------|
| **Bilder** | Images used in questions |
| **Audio** | Audio clips used in questions |
| **Audio-Guess** | Audio clips for the Audio Guess game type |
| **Hintergrundmusik** | Background music tracks |

### Uploading files

Drag and drop files onto the upload zone, or click to open a file picker.

![Upload Zone](./screenshots/admin-assets-upload.png)
> *Add screenshot: `docs/screenshots/admin-assets-upload.png` — the drag-and-drop upload zone*

### Organizing with folders

Click **"New folder"** to create a subfolder. Drag files between folders to move them.

> **Note:** When you move a file, all game files that reference it are updated automatically.

### Merging duplicate assets

If the same media was uploaded twice under different filenames (e.g. `in-the-end-linkin-park.jpg` and `in-the-end.jpg`), you can merge them into one:

1. Open the asset preview (click an image, audio, or video card).
2. Click **⇆ Zusammenführen** in the modal header.
3. Pick the second asset in the picker — all folders of the current category are searchable.
4. Compare the two assets side-by-side, choose which file to **keep**, and confirm.

The kept file stays; the other is deleted. Every game that referenced the deleted file is rewritten to point at the kept file. For image merges, a small alias note is written so the auto-cover/poster downloaders won't re-create the deleted filename the next time they run. When merging audio or video files that each have an auto-generated cover, the matching covers are merged in the same step.

### Using images in questions

In the Simple Quiz editor, click the image field and pick an uploaded image from the asset browser.

![Image Picker](./screenshots/admin-assets-image-picker.png)
> *Add screenshot: `docs/screenshots/admin-assets-image-picker.png` — the image picker lightbox*

### Background music

Upload audio files to **Hintergrundmusik**. They play continuously during the gameshow with 3-second crossfades between tracks.

---

## 6. Global Settings

Go to the **Config tab** and scroll to the top.

![Global Settings](./screenshots/admin-config-settings.png)
> *Add screenshot: `docs/screenshots/admin-config-settings.png` — the global settings section with toggles*

| Setting | What it does |
|---------|-------------|
| **Point system enabled** | Show/hide team scores in the header and the points-awarding screen |
| **Team randomization enabled** | Show/hide the home screen where players enter their names |

### Global rules

Add rules that are shown to all players before the first game. Click **"Add rule"** to add a rule line.

![Global Rules](./screenshots/admin-config-rules.png)
> *Add screenshot: `docs/screenshots/admin-config-rules.png` — the global rules editor*

---

## 7. Managing a Live Session

Go to the **Session tab** during a live game.

![Session Tab](./screenshots/admin-session.png)
> *Add screenshot: `docs/screenshots/admin-session.png` — the session tab with team name fields and point inputs*

From here you can:
- **Edit team names** — change the player list for each team
- **Edit points directly** — correct a mistake by entering the right number
- **Reset points** — set both teams back to 0
- **Clear session data** — wipe all stored data (requires double confirmation)

---

## 8. Running the Gameshow

### Before the event

1. Set up your gameshow in the **Config tab**
2. Create all your games in the **Games tab**
3. Upload all media in the **Assets tab**
4. Add background music if desired
5. Validate: open the app at `http://localhost:3000` and click through a test run

### During the event

1. Open `http://localhost:3000` on the display (projector/TV)
2. Open `http://localhost:3000/admin` on your host device (tablet/laptop)
3. Players enter their names on the home screen
4. Navigate with **arrow keys** or by **clicking**
5. After each game, award points to the winning team
6. The app ends automatically on the summary screen

### Tips

- The admin panel never interrupts the game — you can check or correct things at any time
- Points can be manually corrected in the **Session tab** if you make a mistake
- Use **keyboard shortcuts** (`→` to advance, `←` to go back) for smooth presenting

---

*For player instructions, see the [User Guide](./user-guide.md).*
