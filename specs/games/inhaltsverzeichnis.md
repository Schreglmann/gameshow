# Spec: Inhaltsverzeichnis (content game on four-statements)

## Goal

A `four-statements` content game: a German Wikipedia article is guessed from its table of contents. Each question shows up to four real section headings of the article on `de.wikipedia.org`, one per host click; the reveal is the article title.

## Authoring rules (hard requirements)

- **Every heading is REAL and verbatim.** A statement is 1–3 section or subsection headings copied character for character from the article's table of contents, joined with ` · `. Never shorten, reword or translate a heading.
- **No heading may contain the article title or an obvious part of it** (no `Lugner City` for Richard Lugner, no `Kraken-Orakel` for `Paul (Krake)`, no `Barbie-Pink` for Barbie).
- Skip the boilerplate headings (`Literatur`, `Weblinks`, `Einzelnachweise`, `Siehe auch`).
- Statement order: most generic first, most telling last. The first statement is nearly useless alone; the fourth lets most players answer.
- `answer` is the article title as Wikipedia writes it. `gmInfo` holds the article URL and the date the headings were read.
- Question 0 is the example and the easiest article. Mix topics (people, events, products, food, TV, animals). No Harry Potter.

## Source provenance (v1)

- All headings were read on 2026-11-27 from the MediaWiki API: `https://de.wikipedia.org/w/api.php?action=parse&page=<Titel>&prop=sections&format=json`, field `line`.
- After writing the file, a script fetched each of the 13 tables of contents again and compared every heading of every statement with the API result. All matched.
- The API rate-limits unauthenticated clients (`You are making too many requests`). A pause of about 5 seconds between requests avoids it.
- Wikipedia headings change. Before reusing the game much later, run the same comparison again and replace headings that no longer exist.

## UI / data

- Plain `four-statements`; no code changes. No `answerImage`.
- Rules: the Archetype X "Four-statements" block from [../rules-standard.md](../rules-standard.md), with the task line of this game.
- `randomizeQuestions: true`; the example stays first.

## Out of scope

- Rendering the statements as a Wikipedia-style table of contents.
- Fetching headings at runtime; they are static text in the game file.
