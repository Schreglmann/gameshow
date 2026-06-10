# Codebase Improvement Report

_Generated: 2026-06-10 · Method: three parallel exploration passes (server, frontend, tests/tooling/docs) followed by manual verification of every finding listed here. Every file:line reference below was opened or grepped directly — claims that did not survive verification were dropped._

**Severity:** 🔴 high · 🟠 medium · 🟡 low — **Effort:** S (< 1 h) · M (half day) · L (multi-day)

> **Environment constraint:** `config.json` and `games/*.json` are git-crypt encrypted. Remote (cloud) sessions cannot read or edit them, so BUGS.md findings that live in game/config *content* (broken `gameOrder` entries, English titles, the "Zaubersprücher" typo) can only be fixed from a machine with the git-crypt key. They are listed here for completeness but marked **content-fix (local only)**.

---

## Implementation status — 2026-06-10

Implemented on this branch:

- **0.1** Visible "Spiel überspringen →" button on the failed-game screen; BUGS.md status table updated
- **0.2** Verified already resolved in code: BetQuiz accepts 0-bets (`betNum >= 0`), FinalQuiz has no bet cap — no change needed
- **1.1–1.6** CI workflow (`.github/workflows/ci.yml`), ESLint adopted (`eslint.config.js`, lint green; react-hooks v7 compiler rules deferred, `no-explicit-any` off — both documented in the config), `typecheck` + `lint` scripts, ffprobe-static deps/devDeps swap, unused `ffmpeg` removed, pre-commit hook extended. All ~30 pre-existing lint errors fixed (dead code removed, incl. the never-rendered `AudioGuessInfo` component; `SystemTab` now displays segment-warming progress instead of dead state writes)
- **2.1** Poster-auto + system-status failures now logged; duplicated poster block extracted into `autoFetchPosterInBackground()`
- **2.2** 4 GiB single-shot upload cap (`limits.fileSize`); MIME allowlist left to the existing downstream extension checks
- **2.4** Warm-path sync fs converted to async (random-frame cache write, theme settings, bandle catalog); `whisper-jobs.ts` left as-is (job context, not request context)
- **2.5** `withConfigWriteLock()` serializes all config.json writers (cascade cleanup, game rename, config save, examples)
- **2.7** NAS queue growth warning (no drop — ops must not be lost)
- **3.1** All `api.ts` wrappers throw `HttpError`
- **3.2** `fadeAudio` extracted to `src/utils/fadeAudio.ts`
- **3.4** GM-zone localStorage exception documented in AGENTS.md (§3 + §8)
- **3.5** Canvas contexts null-guarded in ImageGuess (all 7 assertions removed)
- **3.6** Hardcoded px margins → `clamp()`
- **3.7** Content-based list keys (`${text}-${i}`) on reveal lists
- **4.2** `tests/unit/games/BaseGameWrapper.test.tsx` added (6 tests: phase walk, back-nav, award flows, skip-points paths)
- **4.3** `noUncheckedIndexedAccess` enabled for **both** tsconfigs — all 190 server errors and all 309 client errors fixed (guards where undefined is plausible, assertions only with airtight adjacent invariants, no behavior changes, no rules-of-hooks violations; full suite stays green throughout)
- **4.4** QUICK_START.md type count fixed; BUGS.md re-verified with dated status section
- **4.5** OpenAPI license `url` added
- Bonus: the two content-dependent test files now skip git-crypt-encrypted game files, so `npm test` is green on locked checkouts (CI, remote sessions)

Deferred (with reasons):

- **2.3** server/index.ts split — incremental, route-by-route as routes are touched (big-bang too risky)
- **2.6** Centralized path-gate helper — audit-level change across many routes; `isSafePath()` itself verified solid
- **3.3** `useGameAudio()` extraction / component splitting — needs visual + live verification not possible against encrypted content
- **4.1** 129 e2e stubs — needs a runnable show with real (decrypted) content
- BUGS.md #5 (1280×800 overflow layout) — CSS rework requiring screenshot verification at all breakpoints with real game content

---

## Priority 0 — Known live-show bugs (BUGS.md backlog)

[BUGS.md](BUGS.md) is a detailed frontend test sweep from 2026-05-18 with 12 findings. As of this analysis they are still open, with one partial exception. Rather than duplicate it, this section gives the current status of each and flags what changed since.

| # | Severity | Finding | Status today | Fixable remotely? |
|---|----------|---------|--------------|-------------------|
| 1 | blocker | 6 `gameOrder` entries reference `<game>/archive` → 404 | Open | ❌ content-fix (local only) |
| 2 | blocker | Failed game load has no skip-forward affordance | **Partially fixed** — see below | ✅ |
| 3 | major | 4 game titles are English | Open | ❌ content-fix (local only) |
| 4 | major | "Zaubersprücher" → "Zaubersprüche" | Open | ❌ content-fix (local only) |
| 5 | major | Q1 / four-statements / final-quiz / colorguess answer view overflows 1280×800 | Open | ✅ CSS |
| 6 | major | bet-quiz + final-quiz unplayable as first game (0 points → all bets rejected) | Open | ✅ |
| 7 | minor | `GET /show/favicon.svg` 404 on every page load | Open | ✅ |
| 8 | minor | FinalQuiz bet-input placeholder truncated ([FinalQuiz.tsx:221](src/components/games/FinalQuiz.tsx#L221)) | Open | ✅ |
| 9–12 | minor/cosmetic | Loan-word labels, missing HP theme override, 1920px under-use, video-cache warning | Open | mixed |

### 0.1 — BUGS.md #2 is partially fixed; the doc is stale 🟠 S

The error screen ([src/components/screens/GameScreen.tsx:150-205](src/components/screens/GameScreen.tsx#L150-L205)) now wires `useKeyboardNavigation` (ArrowRight skips to `index + 1`) **and** gamemaster nav controls — BUGS.md's claim that "ArrowRight does nothing" is outdated. What's still missing is a **visible on-screen button** ("Spiel überspringen →") for anyone not at a keyboard/GM device. Two actions:

1. Add the visible skip button to the error card (S).
2. Update BUGS.md #2 to reflect the partial fix so the next sweep doesn't re-litigate it (S).

### 0.2 — Bet-validation hard wall (BUGS.md #6) 🔴 M

Still the most player-visible open bug that is fixable in code: when both teams have 0 points, [BetQuiz.tsx](src/components/games/BetQuiz.tsx) and [FinalQuiz.tsx](src/components/games/FinalQuiz.tsx) reject every bet and the show cannot advance. Allow a bet of 0 (skip), or add a host-only override. Decide the rule with the show host, then update [specs/games/bet-quiz.md](specs/games/bet-quiz.md) + [specs/games/final-quiz.md](specs/games/final-quiz.md) in the same change (per AGENTS.md spec discipline).

---

## Priority 1 — Tooling & CI

### 1.1 — No CI workflow at all 🔴 S–M

`.github/workflows/` does not exist. The only automated gate is [.githooks/pre-commit](.githooks/pre-commit), which runs `npm test` locally and is opt-in (hooks must be activated per clone). Add a workflow running `npm test` + `npm run validate` *(skips gracefully on encrypted config)* + `npm run contracts:lint` on every push/PR. This is the single cheapest way to stop regressions reaching the branch.

### 1.2 — ESLint is referenced but does not exist 🔴 S

`src/` contains **48 `eslint-disable` comments across 20 files** (e.g. [SimpleQuiz.tsx](src/components/games/SimpleQuiz.tsx), [GameEditor.tsx](src/components/backend/GameEditor.tsx) with 9), yet there is **no ESLint config anywhere** (no `.eslintrc*`, no `eslint.config.*`) and no `lint` script in [package.json](package.json). The disable-comments are vestigial — nothing ever runs them. Either adopt `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks` (the disables suggest the code was once linted and mostly conforms), or delete the dead comments. Recommended: adopt — `react-hooks/exhaustive-deps` is exactly the class of bug this codebase's audio/effect-heavy components are prone to.

### 1.3 — No `typecheck` script 🟠 S

Type-checking only happens inside `npm run build` (`tsc -b && tsc -p tsconfig.server.json`). Vitest does not type-check, so a PR can pass `npm test` with type errors. Add `"typecheck": "tsc -b && tsc -p tsconfig.server.json --noEmit"` and run it in CI + pre-commit.

### 1.4 — `ffprobe-static` and its types are swapped between deps/devDeps 🔴 S

[package.json](package.json): `@types/ffprobe-static` sits in `dependencies` (line 47) while **`ffprobe-static` itself sits in `devDependencies`** (line 83) — but the server imports it at runtime ([server/index.ts:742](server/index.ts#L742)). A production install (`npm install --omit=dev` + `npm start`) crashes on the missing module. Swap them.

### 1.5 — Unused `ffmpeg@^0.0.4` dependency 🟡 S

Nothing imports the `ffmpeg` package (verified by grep — only `fluent-ffmpeg` / `ffmpeg-static` are used). `ffmpeg@0.0.4` is an ancient, unmaintained package; remove it.

### 1.6 — Pre-commit hook is test-only 🟡 S

[.githooks/pre-commit](.githooks/pre-commit) runs `npm test` only. Once 1.2/1.3 exist, add `typecheck` + `contracts:lint` (both fast) so contract drift is caught before commit, as AGENTS.md §2a demands.

---

## Priority 2 — Server hardening

### 2.1 — Silently swallowed background failures 🟠 S–M

24 bare `.catch(() => {})` in [server/index.ts](server/index.ts) (28 across `server/`). Most are legitimate tmp-file cleanup guards (`unlink`/`rm` of temp paths) and fine as-is. The meaningful ones:

- **Auto-poster fetch after video upload** — [server/index.ts:5422-5430](server/index.ts#L5422-L5430) and its near-identical duplicate in the chunk-upload route at [5610-5618](server/index.ts#L5610-L5618). A failed poster fetch is completely invisible. Add a `console.warn('[poster-auto] …')` in the catch.
- **System-status broadcast** — [server/index.ts:580](server/index.ts#L580): if `buildSystemStatusPayload()` throws, the WS broadcast silently never happens.

Note the codebase already moved in this direction once: the comment at [server/index.ts:1756-1757](server/index.ts#L1756-L1757) documents a previous `.catch(() => {})` that swallowed real NAS errors and was deliberately fixed. Finishing the job is consistent with that decision. The two duplicated ~20-line poster blocks should also be extracted into one helper (S).

### 2.2 — Uploads have no MIME filter and no size limit 🟠 S

[server/index.ts:710](server/index.ts#L710): `multer({ dest: os.tmpdir() })` — no `fileFilter`, no `limits`. Extension checks happen downstream, but a multi-GB upload is accepted into tmp before any check runs. On a trusted LAN this is low-risk, but a `limits: { fileSize }` cap plus an extension/MIME allowlist per category is one line each and protects the host's disk during a live event.

### 2.3 — `server/index.ts` is an 8,298-line monolith 🟠 L

112 route handlers in one file. Natural seams already visible in the code's own section comments: assets (upload/rename/copy/trash), games CRUD, config/theme, video pipeline (probe/HDR/segment caches), audio covers, spellcheck, NAS sync, system status. Extract incrementally — e.g. one Express `Router` per zone, starting with the most self-contained (spellcheck routes already mostly live in `server/spellcheck.ts`). Do this opportunistically (move a route's handlers when you next touch them) rather than big-bang; AGENTS.md's contract-doc discipline (`specs/api/openapi.yaml`) makes moves safe to verify with `npm run contracts:lint` + `npm run test:contracts`.

### 2.4 — Residual sync fs calls in warm paths 🟡 M

13 `readFileSync`/`writeFileSync` in [server/index.ts](server/index.ts). Startup cache loads (probe/HDR/duration caches, lines 186–777) are acceptable. The ones worth migrating to async: frame-cache write at [2985](server/index.ts#L2985) (inside the random-frame request path), theme-settings read/write at [3199](server/index.ts#L3199)/[3212](server/index.ts#L3212), and the per-file catalog reads in a loop at [3695](server/index.ts#L3695). `server/whisper-jobs.ts` is the heaviest sync-fs user (~21 calls) but runs in job context, not request context — lower priority.

### 2.5 — Concurrent config writers are not serialized 🟡 S

`cascadeGameOrderCleanup()` ([server/index.ts:3031-3059](server/index.ts#L3031-L3059)) is **better than it looks from afar**: it already writes atomically (tmp + rename), refuses to overwrite an encrypted or unparseable config, and preserves indentation. The only residual gap is that two concurrent config-mutating requests (e.g. a game delete racing an admin config save) each do their own read-modify-write — last writer wins. A simple module-level promise-chain mutex around config writes closes it. Low likelihood (single admin in practice), low cost.

### 2.6 — `isSafePath()` is solid but should be the *only* path gate 🟡 S

[server/index.ts:731-734](server/index.ts#L731-L734) correctly rejects null bytes, absolute paths, and `..`/`.`/empty segments. The improvement is not the function but its *application*: it relies on every route remembering to call it. Consider centralizing — a helper that joins + `path.resolve`s and verifies the result is inside the asset root (defense-in-depth), used by all file-touching routes.

### 2.7 — NAS sync queue is unbounded 🟡 S

[server/index.ts:1541](server/index.ts#L1541)+: `nasSyncQueue` has no size cap. Failure handling is decent (persistent failures are shifted out rather than blocking, [1808](server/index.ts#L1808)), and ops are bounded by admin actions in practice, so this is minor — but a cap + warning log when the NAS is offline for a long session would prevent surprise memory growth.

---

## Priority 3 — Frontend cleanup

### 3.1 — `api.ts` error handling is inconsistent 🟠 S

[src/services/api.ts](src/services/api.ts) defines `HttpError` (status-carrying) but only `fetchGameData` uses it (line 23). `fetchSettings` (17), `fetchBackgroundMusic` (30), `fetchTheme` (41), `saveTheme` (51) all throw plain `Error`, so callers cannot branch on status. Make every wrapper throw `HttpError`. Pure widening (HttpError extends Error) — existing catch sites keep working.

### 3.2 — Duplicated `fadeAudio` 🟡 S

Verbatim duplicate in [SimpleQuiz.tsx:40](src/components/games/SimpleQuiz.tsx#L40) and [BetQuiz.tsx:34](src/components/games/BetQuiz.tsx#L34). Extract to `src/utils/fadeAudio.ts`, next to the existing audio utilities (`safePlay.ts` already lives there — follow that pattern).

### 3.3 — Game components have grown past comfortable size 🟠 L

Verified line counts: [BetQuiz.tsx](src/components/games/BetQuiz.tsx) 708 · [Bandle.tsx](src/components/games/Bandle.tsx) 660 · [ImageGuess.tsx](src/components/games/ImageGuess.tsx) 633 · [SimpleQuiz.tsx](src/components/games/SimpleQuiz.tsx) 618 · [WerKenntMehr.tsx](src/components/games/WerKenntMehr.tsx) 545 · [VideoGuess.tsx](src/components/games/VideoGuess.tsx) 482. The repeated ~150-line audio setup/teardown in SimpleQuiz/BetQuiz and the per-game gamemaster-control wiring are the two extraction candidates with the best payoff: a `useGameAudio()` hook and composable control-builder helpers would shrink the top files by ~30% and make the next game type cheaper to add. Do this opportunistically per file, with `npm run test:related` after each.

### 3.4 — GM-zone localStorage access vs the stated convention 🟡 S–M

AGENTS.md §7 says "never write directly to localStorage from a component", with `GameContext`'s reducer as the sanctioned writer. The gamemaster zone deliberately deviates: [useGamemasterSync.ts:16-29](src/hooks/useGamemasterSync.ts#L16-L29) and [GamemasterScreen.tsx:13-84](src/components/screens/GamemasterScreen.tsx#L13-L84) persist GM UI flags (lock, answer visibility) directly. The code is careful (try/catch fallbacks, deliberate seeding), so this is a *documentation* problem more than a code problem: either codify the exception in AGENTS.md ("GM-zone UI flags may use localStorage via these two modules") or wrap them in a small `UiStateContext`. Pick one — today every new contributor (human or AI) hits the contradiction.

### 3.5 — Seven `getContext('2d')!` non-null assertions 🟡 S

[ImageGuess.tsx](src/components/games/ImageGuess.tsx) — 7 occurrences. Guard once and reuse the context, instead of asserting at every call site.

### 3.6 — Hardcoded px in inline styles 🟡 S

Verified spots: [FourStatements.tsx:186-187,213](src/components/games/FourStatements.tsx#L186), [Q1.tsx:174-175](src/components/games/Q1.tsx#L174), [FinalQuiz.tsx:287](src/components/games/FinalQuiz.tsx#L287), [VideoGuess.tsx:431](src/components/games/VideoGuess.tsx#L431). Small margins, so impact is minor, but the project's own rule mandates `clamp()`. Fix together with BUGS.md #5 (the 1280×800 overflow), which touches the same components — and note Q1/FourStatements share an identical copy-pasted style block (another small dedup).

### 3.7 — `key={i}` on reveal lists 🟡 S

[QuizQuestionView.tsx:174](src/components/games/QuizQuestionView.tsx#L174), [Ranking.tsx:254](src/components/games/Ranking.tsx#L254), [Q1.tsx:166](src/components/games/Q1.tsx#L166), [FourStatements.tsx:179](src/components/games/FourStatements.tsx#L179), [WerKenntMehr.tsx:441](src/components/games/WerKenntMehr.tsx#L441), [Bandle.tsx:555](src/components/games/Bandle.tsx#L555), [ColorGuess.tsx:138](src/components/games/ColorGuess.tsx#L138). Lists are static per question, so no live bug — fix opportunistically (use answer text as key) when touching these files; becomes load-bearing if shuffling is ever added.

---

## Priority 4 — Tests, types & docs

### 4.1 — All 15 game-type e2e specs are `test.fixme` stubs 🟠 L

129 `test.fixme`/`test.skip` across 59 files (verified), including **every** spec in `tests/e2e/frontend/games/` and [base-game-wrapper.spec.ts](tests/e2e/frontend/base-game-wrapper.spec.ts). The "grep-for-coverage property" from AGENTS.md §6 holds in letter but not spirit. BUGS.md's manual sweep already wrote the test script — pass B's per-type walkthrough (landing → rules → game → reveal → AwardPoints) is exactly what these stubs should automate. Implement the five most-used types first (simple-quiz, audio-guess, bet-quiz, image-guess, video-guess).

### 4.2 — Integration suite is thin; BaseGameWrapper has no unit test 🟠 M

Only 4 integration test files (`tests/integration/server/`), and no `tests/unit/games/BaseGameWrapper.test.tsx` despite it owning every game's phase transitions. A unit test of landing → rules → game → points → next is high-leverage: it covers all 16 game types' shared shell at once.

### 4.3 — `noUncheckedIndexedAccess` is off 🟡 M

All four tsconfigs have `strict: true` but not `noUncheckedIndexedAccess`. Given how much of this codebase indexes into question arrays (`questions[currentIndex]`), enabling it would surface real off-by-one risks. Expect a sizable but mechanical fix-up; enable per-config starting with `tsconfig.server.json`.

### 4.4 — Doc drift 🟡 S

- [QUICK_START.md:76](QUICK_START.md#L76) says "all 14 types" — there are **16** in the `GameType` union ([src/types/config.ts:3-19](src/types/config.ts#L3-L19)).
- BUGS.md header still says "14 game types" and finding #2 is stale (see 0.1).
- Verified *non*-issue: `specs/games/cover-oder-original.md` looked like an orphan spec but is a content spec on top of `simple-quiz` — no action needed.

### 4.5 — OpenAPI lint nits 🟡 S

[specs/api/openapi.yaml:29-30](specs/api/openapi.yaml#L29): `license: { name: Private }` lacks the `identifier`/`url` redocly wants. Cosmetic; fix next time the contract is touched.

### 4.6 — `WIP` commit in history 🟡 info

Commit `1206f60 "WIP"` (D&D dungeon-background generator work) sits two commits behind HEAD on the main line. Nothing actionable remotely — flagging so the work either gets finished or the leftover scripts (`scripts/generate-dungeon-scene.cjs`, `dragon-traced.json`) get adopted/removed deliberately.

---

## If you only do five things

1. **CI workflow + `typecheck` script** (1.1, 1.3) — cheapest permanent regression guard. _S_
2. **Swap `ffprobe-static` deps/devDeps** (1.4) — production install is broken today. _S_
3. **Fix the bet-validation hard wall** (0.2) — the worst remaining live-show failure that code can fix. _M_
4. **Visible skip button on the failed-game screen** (0.1) — closes the last gap on a blocker. _S_
5. **Adopt ESLint with `react-hooks` rules** (1.2) — the 48 stranded `eslint-disable` comments show the codebase is already 95% conformant; the remaining 5% is where the bugs live. _M_

Plus, from a machine with the git-crypt key: clean up the six `<game>/archive` `gameOrder` entries (BUGS.md #1) — two of the twelve BUGS.md findings disappear with a 5-minute config edit.
