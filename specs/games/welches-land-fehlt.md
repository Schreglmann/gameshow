# Spec: Welches Land fehlt? (content game on simple-quiz, generated maps)

## Goal

A `simple-quiz` content game: the map of a world region is shown with one country left out, and the teams write down which country is missing. The reveal swaps in the same map with the missing country highlighted and labelled.

## Acceptance criteria

- [x] `scripts/generate-welches-land-fehlt-maps.ts` writes two SVGs per item to `local-assets/images/Karten/Welches-Land-fehlt/`: `<slug>.svg` (question) and `<slug>-loesung.svg` (answer).
- [x] Both SVGs of an item have identical geometry, so `replaceImage: true` makes the country appear in place.
- [x] On the question map nothing is drawn where the country was: it has the water colour, and the neighbours keep their own outlines. The map carries no labels and no caption.
- [x] Only countries with a sea coast are used, so the hole runs into the water and its outline stays open (see Authoring rules).
- [x] On the answer map the country is filled in the highlight colour and labelled with its German name.
- [x] Every map of a region uses the same fixed view (`VIEWS` in the script: Europe, South America, Central America, Africa, Middle East, South Asia, East Asia, South-East Asia, Oceania), widened to the canvas aspect ratio.
- [x] An item can hide further features with `alsoOmit` where Natural Earth splits a country (Somalia + Somaliland). They are filled on the answer map; the label sits in the main feature.
- [x] Each country is one path carrying fill and outline, and points closer than 1 px to the previous one are dropped: 84 maps take 24 MB instead of 55 MB.
- [x] A run deletes the SVGs of countries that are no longer in `items`.
- [x] `games/welches-land-fehlt.json` has the example plus 12 questions in `v1`, 10 of them outside Europe; the other 29 generated countries are parked in `archive`.

## State / data changes

- No `AppState` changes, no type changes, no API changes.
- `scripts/lib/country-map.ts` — projection, clipping, path and label helpers, taken from `scripts/generate-laendergrenzen-maps.ts`. The older map scripts keep their own copies and are not refactored.
- The script writes images only. `items` in the script and the questions in the game file are edited together by hand.

## UI behaviour

- Plain `simple-quiz`: `questionImage` + `answerImage` + `replaceImage: true`, the pattern of `games/harry-potter-wer-fehlt.json`.
- Rules: task line + `rulesPreset: simultaneous-written` (Archetype A).

## Authoring rules

- **Do not use landlocked countries** (Switzerland, Austria, Czechia, Hungary, Bolivia, Mongolia, …). The neighbours' borders draw the complete outline of the hole, and the question turns into recognising a shape. A country with a coast leaves a gap that opens to the sea.
- Prefer countries outside Europe; a hole in Europe is found at a glance. Island countries (Madagascar, Japan, New Zealand, Cuba) leave no trace at all and are the hardest.
- Do not use microstates (Vatican, Monaco, San Marino, Liechtenstein, Andorra, Malta): at this scale they are a few pixels wide.
- Do not use Russia: Kaliningrad is part of the same Natural Earth feature and would vanish with it.
- The data source is Natural Earth 50m admin-0 (public domain), downloaded on first run and cached in `$TMPDIR`. Kosovo and Northern Cyprus are separate features there and are drawn as such.

## Out of scope

- Writing or updating the game JSON from the script.
- A projection other than the equirectangular one of the existing map scripts (high latitudes are stretched horizontally).
- Inset magnifiers for small countries.
