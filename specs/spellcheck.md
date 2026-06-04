# Spec: Spelling & Grammar Check ("Lektorat")

## Goal
Let the author check every German prose field in a game (or the whole show) for spelling
**and** grammar mistakes, fix them in place, and permanently allow false positives — with a
global on/off switch that is **off by default**.

## Acceptance criteria
- [x] A new **Lektorat** tab exists in the admin. It hosts a **master on/off switch**; the
      whole feature is **off by default** (fresh install, missing config file → off).
- [x] While the master switch is **off**, no spell-check UI appears anywhere: no per-game
      button, no inline underlines, no scanning. The app behaves exactly as before.
- [x] When **on**, the Lektorat tab can scan all games of the active gameshow (option to scan
      every game) and shows a report grouped by game → instance → question/field, with a
      progress indicator while scanning.
- [x] The game editor shows a "Rechtschreibung prüfen" toggle (only when the feature is on)
      that checks the currently-open game and shows the same report.
- [x] Each reported issue offers: **Übernehmen** (apply a suggestion → edits the field and
      auto-saves), **eigene Korrektur** (a free-text input, pre-filled with the flagged word, to
      type and apply a correction when none of the suggestions fit), **Wort erlauben** (adds the
      word to a permanent allowlist; it never re-flags anywhere), **Ignorieren** (suppresses that
      specific grammar match by fingerprint). Both the report panel and the inline popover offer
      the free-text input.
- [x] **Names are not flagged.** A global **"Namen nicht prüfen"** toggle (default **on**) skips
      likely proper names: a *capitalized* spelling match for which LanguageTool offers **no close
      correction** (edit distance ≤ 1) is suppressed. Genuine typos of real words always come with
      a near suggestion, so they stay flagged; unknown names (people, bands, places, titles) — for
      which the checker has no near dictionary word — are skipped. Capitalization alone is not used
      (German capitalizes every noun); the "no close fix" test is what separates a name from a typo.
      A name that *does* have a near German word (e.g. "Stefani" → "Stefan") stays flagged until the
      author allows/ignores it once — and that suppression is **language-independent**: it follows
      the token, so it survives LanguageTool re-detecting the field's language (see Performance).
- [x] The allowlist + ignored matches are managed on a dedicated **Wörterbuch** subpage (reached
      from the Korrektur tab via "Wörterbuch verwalten"), where words can be **seen, added, edited,
      and deleted** and ignored matches seen/added/deleted. The main scan page stays clean. The
      "Namen nicht prüfen" toggle lives on this subpage.
- [x] Spelling and grammar are both detected via LanguageTool. Each field's language is
      **auto-detected** (`language=auto`, preferring `de-DE`/`en-US`), so English answers
      (song/movie/band names) are checked as English and German text as German — neither is
      flagged as the other. The endpoint is configurable via `LANGUAGETOOL_URL` (default
      `https://api.languagetool.org`) and the language via `LANGUAGETOOL_LANGUAGE` (default `auto`).
- [x] Inline squiggly underlines appear on the editor's prose fields when the feature + the
      per-game toggle are on (red = spelling, blue = grammar/style); clicking a flagged word
      opens a popover with suggestions + a free-text "eigene Korrektur" input + Erlauben/Ignorieren.
      (Bandle's answer/track fields are
      catalog-driven read-only text, so they are covered by the report panel, not inline.)
- [x] **Explanations are always in German.** LanguageTool localizes its `message` to the
      *detected* language of the field (a name misdetected as French/Breton/Italian comes back in
      that language), so the UI never shows that raw message. Instead the displayed explanation is
      derived from the language-independent `issueType`/`categoryId`/`ruleId` tokens
      (`src/utils/spellcheckExplain.ts`). Hovering an issue (report panel + inline popover) or a
      rule fingerprint (Wörterbuch) shows a German explanation of the underlying rule, decoding the
      language of `MORFOLOGIK_RULE_<LL>_<CC>`.
- [x] The allowlist + master switch persist in a repo-root `spellcheck-allowlist.json`
      (plaintext, committed, NOT git-crypt encrypted).
- [x] Every prose field of every game type is checkable; non-prose (filenames, asset paths,
      numbers, hex colors, FAKT/FAKE, flags) is never sent to the checker.
- [x] All new HTTP routes are documented in `specs/api/openapi.yaml` + `inventory.md` +
      `docs/replace-admin.md`; `npm run contracts:lint` passes.

## Performance
- **Auto pass-1, then en-US over flagged TOKENS only:** with `language=auto`, (1) one batched `auto`
  pass over all fields — cheap because LanguageTool detects the dominant language once (German for a
  German show) and checks the batch efficiently; this is the German truth for German fields, while
  English content (answers, embedded titles) comes back with German spelling matches whose flagged
  tokens are really valid English words. Then (2) collect every **distinct token** pass-1 flagged as
  a misspelling and re-check just those **tokens** (not the full fields) in `en-US`: a real German
  typo is foreign to English too, so en-US flags it → **keep**; an English word ("love", "Knight")
  is valid English, so en-US does **not** flag it → **drop**. This strips English false-positives
  (whole English answers *and* English words embedded in a German sentence — the previous ratio-gated
  per-field pass missed the embedded case) while keeping every genuine German typo. Running `en-US`
  over the *whole* (German) show is deliberately avoided — the English speller flags every German
  word and is very slow; checking only the handful of flagged tokens is cheap. Each German `/check`
  has a large *fixed* cost and the server **serializes** them (concurrency hurts), so wall-clock is
  driven by request COUNT — a self-hosted/local instance packs much bigger chunks (no public 20 KB
  cap) and the **whole-show scan batches every game's fields into one `/check`** (keys namespaced by
  file+instance), so a full local scan is a couple of requests instead of one round-trip per game.
- **Language-independent spelling suppression:** spelling-match rule ids are language-dependent
  (`GERMAN_SPELLER_RULE` when a field reads as German, `MORFOLOGIK_RULE_IT_IT` when auto-detected as
  Italian, `HUNSPELL_RULE` elsewhere). Because the ignore fingerprint embeds the rule id, a name the
  author ignored while a field was detected as one language would re-appear once detection flipped to
  another. So a spelling match is suppressed when its **token** matches an allowed word **or the
  token of any spelling-type ignored fingerprint** — the suppression follows the word, not the
  volatile rule id. (Grammar matches are still matched by exact fingerprint.)
- **Response cache (persistent):** per-field results are cached (keyed by language + text), so
  re-scans and re-checks after editing one field reuse prior responses — a repeat scan of
  unchanged content makes **no** API calls. The cache is **persisted to a gitignored sidecar**
  `.spellcheck-cache.json` (atomic tmp-write + rename, debounced) and reloaded on startup, so it
  **survives server restarts** (including `tsx watch` reloads in dev): once content has been
  scanned, scanning it again after a restart is instant. Disabled under vitest (never touches
  disk in tests). The allowlist is applied at read time, so allowing a word takes effect against
  cached results without re-fetching.
- **Concurrent requests + sliding-window rate limiter:** requests run concurrently (default 6
  in-flight). On the public API a global **sliding-window** limiter keeps a log of the last
  minute's requests and only makes a caller wait once the window is actually full (~18 req /
  ~70 KB per minute, leaving headroom under the public API's ~20 req / ~75 KB cap). So a normal
  show fires its handful of requests in one burst and completes in a few seconds — **no** fixed
  per-request delay. Only large shows / rapid re-scans get throttled, and only after the burst.
  A self-hosted `LANGUAGETOOL_URL` is never throttled.
- **Visible throttling:** while a scan is running the UI polls `GET /api/backend/spellcheck/
  rate-status` once a second and shows a banner ("Ratenlimit erreicht – warte ~N s") whenever
  requests are parked, so the user knows the scan is waiting on the rate limit rather than stuck.
- Against the free public API a first scan of very large, proper-noun-heavy shows can still be
  bounded by the per-minute cap (every flagged field is a re-check). The persistent cache makes
  every subsequent scan instant, but the **only** way to guarantee a fast first scan is to
  self-host LanguageTool — there is no per-minute limit, so all requests run concurrently:
  ```bash
  docker run -d --name languagetool -p 8010:8010 erikvl87/languagetool
  # then start the gameshow server with:
  LANGUAGETOOL_URL=http://localhost:8010
  ```
  With a self-hosted endpoint the rate limiter is bypassed entirely and a whole show checks in
  a few seconds even cold.

## State / data changes
- **New sidecar file** `spellcheck-allowlist.json` at repo root:
  `{ version: 1, enabled: boolean, skipNames: boolean, allowedWords: string[], ignoredMatches: string[] }`.
  `enabled` defaults to `false`; `skipNames` defaults to `true` (legacy files without the field
  read as `true`). `ignoredMatches` holds match fingerprints.
- **New cache sidecar** `.spellcheck-cache.json` at repo root (gitignored, ephemeral):
  `{ version: 2, entries: [key, matches][] }`. Persists the in-memory response cache so it
  survives restarts. Not committed; safe to delete (rebuilt on next scan). The `version` is bumped
  whenever the `auto` algorithm changes (so stale verdicts are discarded) — `2` is the
  token-level-en-US reconciliation.
- **No `AppState` change** — this is admin-only CMS state, not gameshow runtime state.
- **New env vars** `LANGUAGETOOL_URL` (default `https://api.languagetool.org`) and
  `LANGUAGETOOL_LANGUAGE` (default `auto` — per-field language detection). Each field is
  checked in its own request so auto-detection is per field (no cross-field batching).
- **New API endpoints** (admin zone, all under `/api/backend/spellcheck`):
  - `POST /check` — `{ segments: { key, text }[] }` → `{ results: { key, matches }[] }`
    (allowlist-filtered, offsets local to each segment).
  - `GET /allowlist` → the full config object.
  - `POST /set-enabled` — `{ enabled: boolean }` → updated config.
  - `POST /set-skip-names` — `{ enabled: boolean }` → updated config (the "Namen nicht prüfen" toggle).
  - `POST /allow-word` `{ word }`, `POST /remove-word` `{ word }` → updated config.
  - `POST /ignore-match` `{ fingerprint }`, `POST /remove-ignore` `{ fingerprint }` → updated config.
  - `GET /health` → `{ ok, url, reason? }`.
  - `GET /rate-status` → `{ throttling, waiting, retryAfterMs, windowCount, windowMax }` (live
    rate-limiter state; the scan UI polls this to show a "waiting on rate limit" banner).
- **Fingerprint contract:** `` `${ruleId}::${matched.normalize('NFC').toLowerCase().trim()}` ``.
  Shared between server and client so "is this match ignored?" agrees byte-for-byte.

## UI behaviour
- **Lektorat tab** (`LektoratTab`): master switch at top (off by default). When on: a
  "Spiele prüfen" / "Alle Spiele prüfen" action runs the scan, a **two-phase progress line**, the
  grouped report, and a **"Wörterbuch verwalten"** button (with a count) that opens the dictionary
  subpage. The progress line reports each phase honestly so the displayed state is always accurate:
  **Phase 1 "Lade Spiele · N / M"** — a real fraction counting up as each game file is fetched (fast,
  no LanguageTool calls) — then **Phase 2 "Prüfe Rechtschreibung · N Textfelder"** with an
  **indeterminate animated bar**. The whole show is checked in ~1 batched `/check` request, so there
  is no honest per-field sub-progress to count (splitting into smaller batches just to move a number
  would mean more requests, and the local container serializes them → slower); the scope ("N
  Textfelder") plus the animated bar shows it is actively working rather than a stuck "0 / N". The
  main scan page no longer renders the allowed/ignored lists inline.
- **Wörterbuch subpage** (`SpellcheckDictionary`): reached from the tab via "Wörterbuch
  verwalten" (in-tab view switch, back button to return). Hosts the **"Namen nicht prüfen"**
  toggle and two managed lists — **Erlaubte Wörter** (add via input, inline edit/rename, delete)
  and **Ignorierte Hinweise** (add by pasting a fingerprint, delete; the matched word is shown
  prominently with the rule id as a hint). Hovering a rule id shows a German explanation of it
  (`ruleExplanationDe`), e.g. `MORFOLOGIK_RULE_IT_IT` → "Rechtschreibprüfung (Italienisch): …".
- **Game editor** (`GameEditor`): a header toggle (shown only when the feature is on) reveals
  inline underlines + a per-game report panel for the current instance. Applying a fix flows
  through `setData`/`updateInstance` so the existing 800 ms auto-save persists it.
- **Report panel** (`SpellCheckPanel`): issue cards with label ("Frage 4 · Antwort"), the
  flagged text in context (red/blue), an **always-German** explanation of the issue (hover =
  German rule explanation; LanguageTool's own localized message is never shown), the
  suggestion/allow/ignore actions, and a free-text "eigene Korrektur" input (pre-filled with the
  flagged word) + Übernehmen. Empty state: "Keine Auffälligkeiten gefunden."
- **Inline field** (`SpellField`): drop-in replacement for the prose `<input>`/`<textarea>`;
  renders identically to a plain input when the feature is off or the field has no matches. Its
  fix popover shows the same always-German explanation + German rule hover as the report panel.
- **Edge cases:** LanguageTool unreachable / rate-limited → the report shows a clear error and
  the rest of the admin is unaffected. Empty/whitespace fields are skipped. Multi-instance
  games: base `title`/`rules` checked once; per-instance overrides + questions checked per
  instance. Quizjagd is read in its flat on-disk shape.

## Out of scope
- Languages other than German + English (auto-detected).
- Auto-fixing without user confirmation; bulk "fix all".
- Style/picky-level rules (LanguageTool `level=default` only) — may be added later.
- Checking config.json gameshow names or asset metadata (only `games/*.json` prose).
