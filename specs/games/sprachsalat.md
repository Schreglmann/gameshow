# Spec: Sprachsalat (content game on simple-quiz)

## Goal

A `simple-quiz` content game using `questionAudio`: a 10–15 s spoken-audio clip plays; teams identify the **language** (foreign clips: "Welche Sprache ist das?") or the **dialect region** (German-area clips: "Aus welcher Region stammt dieser Dialekt?"). Reveal shows a flag (languages) or a locator map (dialects).

## Authoring rules (hard requirements)

- **No giveaway words.** The audible window must not contain the language/country/region name or an obvious place name. Foreign-language clips from Spoken-Wikipedia recordings use a **mid-recording window** (`questionAudioStart`/`End`) to skip the spoken article title.
- **Every clip needs a human listen-check** before the show — flag words the authoring pass can't hear (known elevated risk in v1: Portuguese "Brasil", Thai "ไทย/Isan", Hungarian place names Miskolc/Sajó).
- Language identity is proven by the source (Commons category "Spoken <Language> Wikipedia"), never assumed.
- Dialect clips come from YouTube dialect showcases/interviews (Wikimedia has almost none): trim a ~15 s passage of continuous dialect speech, convert to Ogg, file starts at 0 (`questionAudioStart: 0, questionAudioEnd: 15`).
- PT-BR vs PT-PT is not distinguished — the answer is simply "Portugiesisch".

## v1 lineup

8 foreign (Finnisch — free example, Türkisch, Griechisch, Japanisch, Portugiesisch, Ungarisch, Thailändisch, Polnisch — all downloaded from Commons, CC) + 6 dialects (Wienerisch, Steirisch, Vorarlbergerisch, Kärntnerisch, Schweizerdeutsch, Plattdeutsch — **audio TODOs**, YouTube-sourced). Isländisch/Koreanisch/Afrikaans were dropped: no clean continuous-speech recordings on Commons.

## Sources

- Foreign audio: Wikimedia Commons "Spoken <Language> Wikipedia" categories (.ogg, CC BY-SA).
- Flags/maps: Commons (`Flag of <Country>.svg`, `<Bundesland> in Austria.svg`, `Switzerland in Europe.svg`, `Low Saxon dialects.png`).
- Dialect clip candidates (YouTube searches documented in the game's asset TODOs): "Wienerisch Dialekt Interview", "steirischer Dialekt", "Vorarlberger Dialekt", "Kärntner Dialekt", "Schweizerdeutsch Mundart", "Plattdeutsch snacken".

## Status

Authored (14 questions); **all 14 audio clips + all reveal images are now on disk** (8 foreign from Commons, 6 dialect 15 s clips from YouTube dialect videos, converted to Ogg/Opus). Every clip still needs the mandatory listen-check: foreign clips for a clean speech window, and **dialect clips especially for a spoken place-name giveaway** (the 15 s windows were chosen blind). Re-trim any clip that names its region.
