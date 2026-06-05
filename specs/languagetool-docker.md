# Spec: Admin-managed local LanguageTool (Docker)

## Goal
Let the author start/stop a local LanguageTool Docker container directly from the admin
**Korrektur** tab, and have the spellchecker automatically use it while it runs — so a whole-show
scan is fast even cold (the per-minute rate limit only applies to the free public API). See
[spellcheck.md](spellcheck.md) for the checker itself.

## Acceptance criteria
- [ ] The Korrektur tab shows a **LanguageTool-Server** section (only when the spellcheck feature
      is enabled) with a status pill and **Start** / **Stop** buttons.
- [ ] **Start** pulls the image if missing, then runs/starts the container, then waits until it is
      healthy. The button reflects the live phase: `pulling` → `starting` → `running` (and `error`
      with a message on failure). The image pull (~500 MB, one-time) shows a **progress bar**
      (`progress` 0–100, derived from completed/total layers of streamed `docker pull` output) and
      does not block the UI.
- [ ] **Cancel** — while pulling or starting, a **Abbrechen** button aborts the operation (kills the
      `docker pull`, stops any container it had started) and returns to idle.
- [ ] **Stop** stops the container (kept, not removed, so the next start is instant) and the
      checker falls back to the public API.
- [ ] The Korrektur tab shows **which endpoint the checker actually uses** — an "endpoint pill"
      reading "Prüfung: Lokaler Server" (local container active) / "Prüfung: Öffentliche API
      (Ratenlimit)" / "Prüfung: Eigener Server" (custom `LANGUAGETOOL_URL`) / "nicht erreichbar".
- [ ] While the managed container is **running and healthy**, every spellcheck request is routed to
      it (`http://localhost:8010`); the sliding-window rate limiter is bypassed (it only applies to
      `*.languagetool.org`), so requests run fully concurrently.
- [ ] When the container is stopped/absent, the checker uses `LANGUAGETOOL_URL` / the public API
      exactly as before. The feature is purely additive — nothing changes if Docker is never used.
- [ ] Docker availability is checked up front and **distinguishes "not installed" from "daemon not
      running"** (probe `docker version --format {{.Server.Version}}`: ENOENT → not installed;
      non-zero exit → installed but daemon down). The pill + hint say which, and Start is disabled.
- [ ] On server restart, an already-running managed container is **detected and reused** (routing
      is re-established) without the user clicking Start again. The Korrektur tab also polls the
      status every ~5 s while open, so `getStatus()` re-establishes routing at the local container
      as soon as it is healthy — even if `start()`'s own health-wait had given up. The scan also
      nudges this once at the moment it starts, so a scan always uses the local instance when it is
      running and healthy.
- [ ] All commands are spawned with fixed argument arrays (no user input interpolated) — no shell,
      no injection surface.
- [ ] New routes documented in `specs/api/openapi.yaml` + `inventory.md` + `docs/replace-admin.md`;
      `npm run contracts:lint` passes.

## Cold-start handling
A freshly-started (or just-detected) container loads its language models on the first `/check` per
language — slow enough (tens of seconds) that, under a concurrent whole-show scan, requests stall and
a few fail transiently. Mitigations:
- **Warm-up on first routing:** whenever local routing is (re)established — explicit `start()`,
  `getStatus()`, or `detectOnStartup()` — the models are pre-loaded once (German + English). On an
  explicit start this is awaited (phase shows "Sprachmodelle werden geladen…"); on detect/reuse it
  runs in the background.
- **Transient-failure retries (server/spellcheck.ts):** each `/check` retries up to 3× with backoff
  on `unreachable` / 5xx (NOT on 429), so a cold-load hiccup never surfaces as "nicht erreichbar".
- **Longer local timeout:** a non-public endpoint gets a 60 s request timeout (vs 20 s public).
- **Global concurrency cap (8):** even unthrottled (local), a scan never fires dozens of concurrent
  checks at a cold container.

## State / data changes
- **No `AppState` change** (admin-only CMS state). **No persisted file** — the Docker daemon is the
  source of truth for container state; the server queries it.
- **New module** `server/languagetool-docker.ts`:
  - Constants: container `gameshow-languagetool`, image `erikvl87/languagetool`, host+container port
    `8010`, local URL `http://localhost:8010`, restart policy `unless-stopped` (survives a daemon
    restart during an event; an explicit Stop keeps it stopped).
  - In-memory phase state: `idle | pulling | starting | running | stopping | error` + last message.
  - `getStatus()` → `{ dockerAvailable, imagePresent, container: 'running'|'stopped'|'absent',
    healthy, phase, message?, url, active }`. Side effect: if the container is running and healthy,
    it sets the managed routing URL (so opening the tab / polling re-establishes routing).
  - `start()` (non-blocking for the caller; runs pull→run→health in the background, never rejects —
    failures set `phase='error'`).
  - `stop()` (stops the container, clears the managed URL).
  - `detectOnStartup()` — fire-and-forget, non-fatal: re-establish routing if the container is
    already running at server boot.
  - A swappable command runner + `_setDockerRunner()` / `_resetDockerState()` test hooks.
- **Routing hook** in `server/spellcheck.ts`: `setManagedLanguageToolUrl(url | null)`.
  `languageToolUrl()` precedence becomes `opts.url → managedUrl → LANGUAGETOOL_URL → public`.
- **New API endpoints** (admin zone, under `/api/backend/spellcheck/docker`):
  - `GET /status` → `LanguageToolDockerStatus` `{ dockerAvailable, dockerInstalled, imagePresent,
    container, healthy, phase, progress, message, url, active }`.
  - `POST /start` → kicks off start; returns the current status (early phase).
  - `POST /stop` → stops; returns the current status.
  - `POST /cancel` → aborts an in-progress start (pull / boot); returns the current status.

## UI behaviour
- **LektoratTab**: a "LanguageTool-Server" card. Status pill colors: running=success, pulling/
  starting=info (animated), error=warning, docker-unavailable=muted. Start disabled unless Docker is
  available and the container is not already running/pulling/starting. Stop shown only while
  running. While `phase ∈ {pulling, starting, stopping}` the tab polls `GET …/docker/status` every
  ~2 s until it settles. A one-line hint explains the speed benefit + the one-time pull.
- **Edge cases:** Docker missing → disabled + clear note. Port 8010 already in use by a non-managed
  process → start fails with `phase='error'` and the daemon's message. Pull failure (offline) →
  `error`. Health never comes up within the timeout → `error` (container left running for inspection).

## Out of scope
- Tuning container resources (memory/CPU) or pinning a specific image tag (uses the image's default).
- Streaming live `docker pull` layer progress (only a coarse `pulling` phase is shown).
- Managing LanguageTool in a *deployed* environment — that is a chart/sidecar (infra) change, not an
  admin button.
- Auto-starting the container when the spellcheck feature is enabled (always explicit via Start).
