# Spec: Zutatenliste (content game on simple-quiz)

## Goal

A `simple-quiz` content game: the question shows the ingredients of a well-known dish or drink as a recipe would list them; both teams write down what is being cooked.

The first version showed the label text of branded products (Nutella, Coca-Cola, …). It was dropped after review: a list of sugar, palm oil and emulsifiers cannot be guessed, a recipe can.

## Authoring rules (hard requirements)

- **Dishes and drinks everybody at the table knows**: Austrian classics, international standards, a few cocktails. No regional specialities that need explaining.
- The list holds the ingredients of the classic recipe, main ingredient first, without quantities. Six to ten entries.
- **The list must not contain the name of the dish** or a part of it (no "Gulaschfleisch" for Gulasch, no "Spätzle" for Käsespätzle).
- At least one ingredient or side makes the dish unambiguous (Powidl and Mohn for Germknödel, Guanciale and Pecorino for Carbonara). Where two dishes share most of the list on purpose (Palatschinken and Frittatensuppe, Wiener Schnitzel and Cordon bleu), the distinguishing entry is named in `gmInfo`.
- No brand names in the list.
- Austrian kitchen vocabulary: Obers, Topfen, Germ, Marillen, Erdäpfel, Faschiertes, Melanzani, Eidotter, Staubzucker.
- The question holds only the list: no category, no `info` field (it is shown to players).
- `gmInfo` is optional and holds what the host needs to judge an answer: accepted alternatives, the distinguishing ingredient, an unfamiliar word explained.

## Content

- `v1`: example (Wiener Schnitzel) plus 12 — Palatschinken, Spaghetti Carbonara, Tiramisu, Guacamole, Sachertorte, Gulasch, Caesar Salad, Pesto, Mojito, Germknödel, Frittatensuppe, Glühwein.
- `archive`: 16 more.
- The lists are the common classic recipes, written from general knowledge. Recipes vary from kitchen to kitchen; there is no single source to cite.

## UI / data

- Plain `simple-quiz`; no code changes. No images.
- Rules: Archetype A + `rulesPreset: simultaneous-written`; only the task line is stored in `rules`.

## Out of scope

- Quantities and preparation steps.
- Rendering the list as a recipe card.
