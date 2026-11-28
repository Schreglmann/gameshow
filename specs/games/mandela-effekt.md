# Spec: Mandela-Effekt (content game on simple-quiz)

## Goal

A `simple-quiz` content game about everyday things everybody has seen a thousand times but does not remember exactly: coins, banknotes, logos, cartoon characters, keyboards. Each question names the thing and offers two versions of one visual detail in text; both teams write down which one is real.

## Authoring rules (hard requirements)

- **`v1` asks only for everyday visual details.** Nobody needs to know anything; the detail is merely fuzzy in memory. Quotes, plots and spellings are knowledge questions and live in `archive`, together with every other verified question that is not in `v1`.
- **Every claim is verified from a reliable source**: the owner's own site (ECB, brand site, trademark register), Wikipedia or Wikimedia Commons, the original record, or the Prasad & Bainbridge 2022 study "The Visual Mandela Effect". A list article that repeats other list articles is not a source.
- A design that differs by country or changed recently, so that both versions are defensible, stays out. So does a question whose wrong version nobody would plausibly remember.
- The question names the thing and both versions neutrally ("X: A oder B?"). Wording and order must not signal the real one; the real version comes first in about half of the questions.
- The answer starts with the real version, then ` – ` and one short explanation. The explanation states only what the source states.
- For film and TV quotes shown in German, verify the wording of the German dub, not only the English original.
- No `info` field, no images. `gmInfo` holds the source.
- Question 0 is the example: the Monopoly man, the best-known case from the study.

## Source provenance

- `v1` (example + 12) and the 20 new `archive` questions were checked on 2026-11-27 against pages fetched that day; `gmInfo` lists the page per question. The 9 older `archive` questions were checked the same day in the first version of this game.
- `v1`: Monopoly man, Pikachu, C-3PO and VW logo come from the study's material (cited from the authors' PsyArXiv preprint, because the journal version is behind a paywall). 1-euro coin and 10-euro note are sourced from the ECB, the Nutella wordmark from the colour claim in the Canadian trademark register. Olympic rings, Google wordmark, calculator keys, keyboard bumps and Mickey Mouse rest on Wikipedia or a Commons file description only.
- **Checked on the image, not on a text description** (marked "am Bild geprüft" in `gmInfo`): Apple logo (`v1`), WhatsApp logo, Red Bull logo, the position of the gap in the Wikipedia globe, the red ground of the LEGO logo, the Austrian "Vorrang geben" sign. For each, the Commons or Wikipedia file page identifies the image as the logo or sign in question; no page that could be fetched describes the detail in words.
- In `archive`, not documented under the name "Mandela effect" but well-sourced common misrememberings: Derrick, Apollo 13, Froschkönig, Zauberlehrling, Sisi, "Mensch ärgere Dich nicht", Wickie.
- Wordings kept narrow on purpose: C-3PO says "part of his right leg" (the study only says "silver leg"); the Monopoly answer describes the classic figure, because en.wikipedia notes later depictions with a monocle made after the false memory spread; Super Mario says "im heutigen Design", because in "Donkey Kong" (1981) the colours were the other way round; Pumuckl says "in der Fernsehserie", because other productions dress him differently; Obelix says "für gewöhnlich", because one album gives him other trousers; the keyboard answer follows a source that says "almost every newer keyboard".
- Dropped in this revision: pedestrian traffic light, red at the top or the bottom (the only source is about traffic lights in general, and red at the bottom is not a plausible false memory).
- Dropped earlier: Casablanca (sources disagree on the 1952 dub), Queen "We Are the Champions" (no reliable source for the studio ending), Mona Lisa (no reliable source), Forrest Gump and Snow White (no verifiable German angle), KitKat (the brand statement is only quoted second-hand).
- Sites that refused automated fetches: Snopes (HTTP 402), Britannica, kitkat.com, olympics.com (timeout), trademarks.justia.com (HTTP 403).

## UI / data

- Plain `simple-quiz`; no code changes.
- Rules: Archetype A + `rulesPreset: simultaneous-written`; only the task line is stored in `rules`.

## Out of scope

- Showing the two versions as images side by side.
- A two-button answer UI; teams write the answer down.
