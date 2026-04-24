# Spec: Cover oder Original

## Goal
A music-recognition game where a song clip is played and teams have to guess whether it is the **Cover** or the **Original** version of the song. Uses the existing `simple-quiz` game type — no new component or type is needed.

## Acceptance criteria
- [x] Game type is `simple-quiz`; all 50 questions carry a `questionAudio` + `questionImage`
- [x] Every **cover** question additionally carries an `answerAudio` + `answerImage` + `replaceImage: true`, so on reveal the image swaps to the original's cover and the original's audio plays. The answer text names the original artist + year
- [x] Every **original** question reveals `"Original"` as the answer, has no `answerAudio`, and keeps `questionImage` visible on reveal
- [x] Every question's text is formatted `"<Song> – <Artist> (<Year>)"` so the release year is visible up-front
- [x] Mix is 26 covers + 24 originals, weighted toward covers whose original is obscure and originals that plausibly sound like covers
- [x] Rules follow Archetype B (Gleichzeitiges Raten) from [specs/rules-standard.md](../rules-standard.md)
- [x] Game passes `npm run validate`

## State / data changes
- No `AppState` changes
- No new types — uses existing `SimpleQuizConfig` / `SimpleQuizQuestion` (`src/types/config.ts`)
- No new API endpoints
- Audio files live under `/audio/Cover oder Original/` and are fetched via the existing asset pipeline

## UI behaviour
- Renders through `SimpleQuiz.tsx` exactly like every other simple-quiz with audio + image
- `questionAudio` auto-plays on question reveal; `questionImage` is shown alongside (YouTube thumbnail of the playing track)
- On answer reveal for covers, the image is **replaced** (`replaceImage: true`) by `answerImage` (the original's cover art) and `answerAudio` plays
- On answer reveal for originals, the question image stays visible; no answer audio plays
- Team raising hand first gets to call "Cover" or "Original" (Archetype B)

## Content rules
- Covers: question text is `"<Title> – <Covering artist> (<Year>)"`; answer text is `"Cover – Original: <Original artist> (<Year>)"`
- Originals: question text is `"<Title> – <Artist> (<Year>)"`; answer text is simply `"Original"`
- All player-facing text in **German**
- Images live under `/images/Audio-Covers/` (proper album art fetched via the iTunes/MusicBrainz cover downloader at `POST /api/backend/audio-cover-fetch`, not the YouTube thumbnails)

## Out of scope
- Any game-engine changes (simple-quiz already supports both audio fields)
- Per-question images or timers — audio-only by design
- Automated verification that an audio file is in fact "the original" — content accuracy is the author's responsibility
