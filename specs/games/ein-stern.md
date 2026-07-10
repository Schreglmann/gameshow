# Spec: Ein Stern. Würde nicht wiederkommen. (content game on simple-quiz)

## Goal

A `simple-quiz` content game: the host reads a real 1-star review of a world-famous attraction; both teams write down which attraction is being trashed. The reveal shows the landmark photo.

## Authoring rules (hard requirements)

- **Every review must be REAL — never invented, never embellished.** Each question carries a `source` field (extra per-question field, tolerated by the validator and server) with the URL of the original review (TripAdvisor permalink) or the reputable roundup that quotes it verbatim.
- **English originals stay English.** Do not translate; preserve typos (`[sic]` wording like "a wast of time" is part of the joke).
- **Redact giveaways:** where the review names the landmark, replace the name with `[…]`.
- Reviews that circulate online but are likely satire/jokes (e.g. the "couldn't see it from space, I was lied to" Great Wall review) are **excluded** — only use quotes traceable to a real review platform or a reputable secondary source.
- Question order: ascending difficulty (iconic first, vague last). First question is the free example.

## Source provenance (v1)

- 7 quotes verified directly on TripAdvisor permalinks (Grand Canyon, Eiffelturm, Kolosseum, Chinesische Mauer/Mutianyu, Stonehenge, Mona Lisa/Louvre, Manneken Pis).
- Remaining quotes verified verbatim in fetched roundups: RoughMaps, parksexpert.com, The Sun (Loch Ness), Time Out Sydney (Bondi), NPR/Subpar Parks.
- TripAdvisor intermittently blocks automated fetches (HTTP 403); the permalinks open fine in a normal browser if re-verification is ever needed.

## UI / data

- Plain `simple-quiz`; no code changes. `answerImage` on every question (Wikimedia Commons landmark photos under `local-assets/images/Ein Stern/`).
- Rules: Archetype A + `rulesPreset: simultaneous-written`.

## Out of scope

- Google-Maps-style screenshot rendering of the reviews (host reads them aloud; text on screen suffices).
- Auto-refreshing content: reviews are static quotes; no pre-show re-verification needed.
