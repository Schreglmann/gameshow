# NAS Sync configuration (admin-editable base path + on/off toggle)

**Status:** ✅ Implemented

## Context

The NAS mount path used by bidirectional sync was hardcoded as
`NAS_BASE = '/Volumes/Georg/Gameshow/Assets'` in [server/asset-paths.ts](../server/asset-paths.ts) —
a compile-time constant consumed at ~40 sites (server + CLI tools). There was no way to point the app
at a different NAS, and no way to turn sync off without unmounting the share.

This feature makes the NAS base path and an enable/disable switch editable from the admin **System
tab**, persisted server-side, while keeping the previous hardcoded value as the default so the
existing NAS keeps working with zero action. It builds directly on
[sync-bidirectional.md](sync-bidirectional.md) and [nas-freeze-resilience.md](nas-freeze-resilience.md);
read those first.

## Design

Mirrors the existing editable-setting pattern (background-encoding cache mode, backed by
[server/encoding-prefs.ts](../server/encoding-prefs.ts)): a JSON sidecar + `get*/set*` module,
`GET`/`PUT` routes, `backendApi` wrappers, and an optimistic-update control in `SystemTab`.

- **Persistence:** `nas-sync-prefs.json` at repo root (`process.cwd()`), atomic write (tmp + rename),
  in-memory cache. Managed by [server/nas-sync-prefs.ts](../server/nas-sync-prefs.ts).
  Shape: `{ basePath: string; enabled: boolean }`.
  Default: `{ basePath: '/Volumes/Georg/Gameshow/Assets', enabled: true }` — with no sidecar present,
  behaviour is identical to before this feature. The sidecar is **gitignored** (machine-specific, like
  `theme-settings.json`): each install keeps its own NAS path uncommitted, and the default keeps the
  original NAS working out of the box.
- **`NAS_BASE`** in `asset-paths.ts` is resolved from the sidecar **once at module load**. All existing
  consumers keep reading the same constant, so the path change is picked up **after a server restart**.
  This is deliberate: the sync safety layers (loss-ratio veto, bulk-delete cap) and the
  `.sync-state.json` files are tied to one stable NAS identity — re-targeting a running sync mid-flight
  would split operations across two mounts. Restart-to-apply is the safe boundary.
- **`enabled`** is read **live** (`getNasSyncEnabled()`) at each sync trigger, so toggling it takes
  effect without a restart. It gates sync *write/propagation* only; NAS *reads* (e.g. random-frame
  prerender) are unaffected.

### Gating points (write/propagation only)

`getNasSyncEnabled()` gates, in [server/index.ts](../server/index.ts):
- `queueNasSync()` — DAM ops don't enqueue NAS work when disabled
- `startupSync()` entry
- `periodicRescan()` entry
- the 30 s queue-retry `setInterval`
- `debouncedSaveSyncState()`

`isNasMounted()` / `isNasReachable()` and all NAS-read paths are **not** gated by the toggle.

## API

Both routes are admin-zone, added next to `/api/backend/cache-mode`.

| Method | Route | Body | Response |
|--------|-------|------|----------|
| `GET` | `/api/backend/nas-sync-config` | — | `NasSyncConfig` |
| `PUT` | `/api/backend/nas-sync-config` | `{ basePath?: string, enabled?: boolean }` | `NasSyncConfig` (400 on invalid) |

```ts
interface NasSyncConfig {
  basePath: string;        // persisted, configured path
  enabled: boolean;        // persisted, live
  activeBasePath: string;  // NAS_BASE resolved at boot (currently in effect)
  restartRequired: boolean; // basePath !== activeBasePath → restart needed to apply
}
```

**Validation (PUT):** `basePath`, if present, is trimmed and must be a non-empty absolute path
(`path.isAbsolute`); otherwise `400`. `enabled`, if present, must be a boolean; otherwise `400`. A
wrong-but-absolute path is accepted — it simply makes the NAS show "nicht erreichbar" and sync stays
idle (the app keeps working from `local-assets/`).

## UI (System tab → NAS-Synchronisation card)

- **NAS-Sync aktiviert** toggle (`be-toggle`) — applies live.
- **NAS-Pfad** text input + **Durchsuchen…** button. The button opens `NasPathBrowser`, a
  directory-only file explorer reusing the video-reference browse endpoints
  (`GET /api/backend/assets/videos/reference-roots` + `reference-browse`). Picking a folder fills the
  textbox. The textbox is the manual entry / fallback for paths outside the browsable roots
  (macOS: `/Volumes` + Home) or an unmounted NAS.
- **Speichern** persists via `PUT`. Optimistic update with rollback on error (mirrors cache-mode).
- When `restartRequired` is true, a hint is shown: *"Neustart erforderlich, damit der neue Pfad
  übernommen wird."*

## Acceptance criteria

- [x] With no `nas-sync-prefs.json`, `NAS_BASE` resolves to `/Volumes/Georg/Gameshow/Assets` and sync
  behaves exactly as before.
- [x] Editing the path in the System tab persists to `nas-sync-prefs.json` (atomic write) and shows a
  restart-required hint until the server restarts.
- [x] After restart, the new path is in effect (`activeBasePath === basePath`, hint gone).
- [x] Toggling **NAS-Sync aktiviert** off stops all sync triggers live (no enqueue, no startup/rescan,
  no state writes); NAS reads still work. Toggling on resumes.
- [x] `PUT` rejects a relative/empty path and a non-boolean `enabled` with `400`.
- [x] A bad absolute path never bricks the app — NAS shows unreachable, local serving continues.
- [x] The directory explorer opens at `/Volumes` (or Home), navigates folders, and returns the picked
  folder path.
- [x] Contract docs (`openapi.yaml`, `inventory.md`, `docs/replace-admin.md`) list both routes.

## Files

- [server/nas-sync-prefs.ts](../server/nas-sync-prefs.ts) — sidecar module
- [server/asset-paths.ts](../server/asset-paths.ts) — resolves `NAS_BASE` from the sidecar
- [server/index.ts](../server/index.ts) — `enabled` gating + `GET`/`PUT /api/backend/nas-sync-config`
- [src/services/backendApi.ts](../src/services/backendApi.ts) — `NasSyncConfig` + wrappers
- [src/components/backend/NasPathBrowser.tsx](../src/components/backend/NasPathBrowser.tsx) — folder explorer
- [src/components/backend/SystemTab.tsx](../src/components/backend/SystemTab.tsx) — controls
- [tests/unit/services/nas-sync-prefs.test.ts](../tests/unit/services/nas-sync-prefs.test.ts)
