# Spec: Harry Potter spells archive generator

## Goal

Populate `games/harry-potter-spells.json` → `instances.archive.questions` with one
`VideoGuessQuestion` per spoken spell across the 8 Harry Potter movies (BluRay 4K German
dub edition). The operator then promotes hand-picked entries from `archive` into `v1`
(the curated playlist) for live shows, refining markers in the existing video-guess
marker editor.

## Acceptance criteria

- [x] One CLI script: `npm run generate:hp-spells` (no flag = all 8 movies, `--movie N`
  = single-movie surgical regen, `--dry-run` = report only, `--verbose` = include
  low-confidence in stdout).
- [x] Reads cached Whisper transcripts produced by the admin Whisper transcription feature
  (see [whisper-transcription.md](whisper-transcription.md)). Tries English first
  (recommended ASR track), falls back to German.
- [x] Fuzzy-matches each transcript against `scripts/hp-spells-dictionary.json` (~90
  canonical spells with Whisper alias variants). Sliding window of 1-4 tokens, Levenshtein
  similarity ≥ 0.80 high-confidence, 0.70-0.80 flagged for review.
- [x] Deduplicates same-spell matches within a 10-second window (Whisper sometimes lists
  the same word twice across overlapping segments).
- [x] Emits entries with the existing `VideoGuessQuestion` shape (no type changes):
  ```json
  { "answer": "Wingardium Leviosa", "video": "/videos/Harry Potter und der Stein der Weisen.m4v",
    "audioTrack": 0, "videoStart": 4849.85, "videoQuestionEnd": 4853.55, "videoAnswerEnd": 4859.27 }
  ```
- [x] `answer` = canonical spell name (e.g. "Wingardium Leviosa") regardless of how it
  was pronounced in the dialogue.
- [x] `audioTrack: 0` always — first audio stream = German dub for all 8 movies.
- [x] Timestamp policy: `videoStart = max(0, wordStart - 4.0)`,
  `videoQuestionEnd = wordStart - 0.3` (pause safely before the spell is spoken),
  `videoAnswerEnd = wordEnd + 3.0` (cover the visual effect).
- [x] `instances.v1` is preserved exactly. Only `instances.archive.questions` is replaced.
- [x] `--movie N` replaces only that movie's entries in archive — manual refinements of
  other movies survive.
- [x] Movies without a cached transcript contribute **no entries**. The archive only
  contains questions for movies whose Whisper transcript is on disk — empty sections are
  preferred over disabled placeholder noise.
- [x] When a spell entry has a `germanName` field, the emitted `answer` is
  `"<canonical> / <germanName>"` so the host can recognise either the Latin spell name
  or its German rendering. Most HP spells stay Latin in the dub; only a handful need
  this. Defaults to the canonical name alone when omitted.
- [x] Trailing newline on the written JSON (AGENTS.md §7).
- [x] Low-confidence matches (similarity 0.70-0.80) are included in the archive with
  `disabled: true` so the operator can spot-check them in the admin UI but they never
  accidentally fire in the live show. High-confidence matches (≥ 0.80) are enabled.
  Low-confidence matches are additionally logged to `scripts/hp-spells-review.log`.
- [x] CLI shows a live progress bar per movie (words scanned / total, ETA) because the
  Levenshtein scan takes 1-2 minutes per 2.5h movie — a silent run felt broken. Also prints
  per-step timings (parse, flatten, match) and a final cross-movie summary table. Falls back
  to periodic (~10 %) progress lines when stdout is not a TTY so CI logs stay readable.

## State / data changes

- **Modified:** [games/harry-potter-spells.json](../games/harry-potter-spells.json) →
  `instances.archive.questions`. Sort order: `(movie chronological index, videoStart)`.
- **Created:** [scripts/hp-spells-dictionary.json](../scripts/hp-spells-dictionary.json) —
  canonical spell list with aliases.
- **Created:** [scripts/hp-spells-review.log](../scripts/hp-spells-review.log) — written
  on each run, lists all matches with confidence < 0.80.
- **No new types.** `VideoGuessQuestion` already supports the emitted fields.

## Out of scope

- **Frame-perfect markers** on archive entries. Whisper word timestamps drift ±0.5-1s; the
  generator deliberately uses generous buffers so the show never spoils the answer
  prematurely. Entries promoted to `v1` are refined manually in the admin marker editor.
- **Non-verbal spells** (wand gesture only). ASR cannot detect them.
- **Auto-promoting entries to `v1`.** Manual curation only — the operator picks the best
  examples per show.
- **Transcription itself.** That's the per-video admin feature
  ([whisper-transcription.md](whisper-transcription.md)).

## Verification

1. Use the admin to transcribe one short HP movie (or a test clip).
2. `npm run generate:hp-spells -- --dry-run` — reports counts.
3. `npm run generate:hp-spells` — writes the file.
4. `npm run validate` — schema check passes.
5. `npm test` — all unit tests pass (matcher tests live in
   [tests/unit/services/whisper-match.test.ts](../tests/unit/services/whisper-match.test.ts)).
6. Open `/admin` → games → harry-potter-spells → archive, spot-check 10 entries in the
   marker editor.
