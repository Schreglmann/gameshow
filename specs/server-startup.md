# Spec: Server startup scheduling

## Goal
Keep the server responsive to the very first page load after a cold start by not letting heavy background maintenance compete with page serving for Node's libuv fs threadpool.

## Background — the bug this fixes
On a production cold start with the NAS mounted, the `app.listen` callback fired several heavy NAS-walking maintenance tasks as fire-and-forget, all at once:

- `startupSync()` — `Promise.all` of `collectFileMetadata(LOCAL)` + `collectFileMetadata(NAS)` + `collectTrashedRelPaths(LOCAL)` (walks the **entire NAS asset tree** with `readdir`+`stat`).
- `cleanupStaleTranscodeFiles()` — recurses the **NAS** `videos/` tree.
- `purgeStaleNasTrash()` — walks **NAS** trash.
- `backfillYoutubeAudioCovers()` + `purgeStaleTrash()`.

Each walk is internally sequential, but run concurrently *across tasks* they put 6–8 slow **network-NAS** `stat`/`readdir` calls in flight at once. Node's libuv fs threadpool defaults to **4 threads**, and `express.static`/`sendFile` (serving the SPA shell) plus `loadConfig` reads use that **same** pool. The NAS ops occupied all threads for their full network latency, so local page-serving fs ops queued behind them — the first page load of **both** the show frontend and the admin hung for minutes. The `getaddrinfo` inside the LanguageTool health probe queued too, so `[language-tool] reusing running local container …` (the last startup log line) only printed once the walk drained — which is exactly when responsiveness returned, making that log a misleading "finish marker."

## Acceptance criteria
- [ ] `detectLtDockerOnStartup()` runs **before** the deferred NAS maintenance, so a warm local LanguageTool container is routed within ~1–2 s of boot (not minutes).
- [ ] The heavy NAS-walking tasks — `cleanupStaleTranscodeFiles`, `purgeStaleTrash`, `purgeStaleNasTrash`, `backfillYoutubeAudioCovers`, `startupSync` — are deferred `STARTUP_MAINTENANCE_DELAY_MS` (5 s) past `app.listen` and run **sequentially** (each `await`ed before the next) via `runStartupMaintenance()`, instead of fire-and-forget all at once.
- [ ] With the NAS mounted, the first request to `/show` and `/admin` is served within ~1–2 s of the `Server is running` log — it is not blocked behind the NAS walk.
- [ ] `UV_THREADPOOL_SIZE` is raised to **32** for the server process (set in the environment before any libuv use, via the `start` and `dev:server` npm scripts) so concurrent fs work cannot starve page-serving fs ops.
- [ ] Background sync still runs and completes; the Layer 1–3 deletion-safety guards in [sync-bidirectional.md](sync-bidirectional.md) are unchanged (this change only reschedules *when* `startupSync` runs, never *what* it does).
- [ ] Each maintenance step logs its duration (`[startup-maint] <step> done in <ms>ms`) so a slow phase is visible on the next cold start.

## State / data changes
- No changes to `AppState`, `localStorage`, or any HTTP/WS API → no OpenAPI/AsyncAPI changes.
- New environment variable consumed by the process: `UV_THREADPOOL_SIZE=32`, set in [package.json](../package.json) `start` + `dev:server` scripts via `cross-env`.
- New internal helper in [server/index.ts](../server/index.ts): `runStartupMaintenance()` + `STARTUP_MAINTENANCE_DELAY_MS`. Not exported, no behavioural contract beyond ordering.

## Why the threadpool size must be set in the environment, not in JS
`process.env.UV_THREADPOOL_SIZE` is read when the pool is first used (first `fs`/`dns`/`crypto` op). Under ESM, imported modules' top-level code (e.g. the synchronous cache loaders in `server/index.ts`) runs before the entry body, so assigning it mid-module is too late. Setting it in the launch command guarantees it is in place before any JS runs.

## Out of scope
- The NAS sync algorithm and its deletion-safety layers — owned by [sync-bidirectional.md](sync-bidirectional.md). This spec only governs *scheduling* of the startup tasks.
- Periodic rescan cadence (`periodicRescan`) — unchanged.
- Per-request performance, caching, or the `pruneUnusedCaches` 30 s deferral (already present, unchanged).
- Dynamically resizing the threadpool at runtime.
