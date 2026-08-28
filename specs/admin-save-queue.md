# Spec: Admin save queue (unmount-safe autosave with retry)

## Goal

An edit made in the admin CMS is persisted even if the operator navigates away, closes the tab, or
the server is briefly unreachable — the pending write survives the editing pane's unmount and keeps
retrying until it lands, reported from every tab in the admin's existing bottom-right toast box.

## Background

Admin autosaves are debounced 800 ms. Admin "tabs" are conditionally rendered
([AdminScreen.tsx](../src/components/screens/AdminScreen.tsx) — there is no router), so switching tabs
**unmounts** the pane. Because the debounce timer lived in a `useEffect` whose cleanup runs on
unmount, `clearTimeout` cancelled the pending `PUT`: toggling a setting in the Config tab and clicking
another tab within 800 ms silently discarded the change, with no toast and no warning. The same held
for browser back/forward (`hashchange` drives the same unmount) and for closing the browser tab.

[GameEditor](../src/components/backend/GameEditor.tsx) had already worked around the unmount half with
a local `dirtyRef` + `pagehide`/unmount flush, but had no retry — a failed save showed a 3 s red toast
and was lost, and if the pane was gone, not even the toast.

The fix moves the debounce, the write, the write-serialization and the retry **out of React** into a
module-scope queue. Components only *enqueue*; nothing they do on unmount can cancel a write.

## Acceptance criteria

- [ ] An edit followed by a tab switch within the debounce window is persisted (the reported bug).
- [ ] The same holds for browser back/forward and for closing the game editor.
- [ ] An edit followed by hiding or closing the browser tab is persisted (`visibilitychange` flush;
      `pagehide` keepalive beacon as the last resort).
- [ ] A save that fails for a transient reason retries at 1 s, 2 s, 4 s … capped at 30 s, indefinitely,
      for as long as the admin PWA is open — and lands on its own once the server is back.
- [ ] Coming back online (`online` event) resets the backoff and retries immediately.
- [ ] The newest payload for a key always wins, and two `PUT`s for the same key never overlap.
- [ ] A permanent failure (4xx) stops the automatic retry and surfaces the error with a manual retry.
- [ ] A pane mounted while a save for the same file is still queued or in flight starts from the
      **queued** payload, not from the (stale) disk read.
- [ ] Deleting a game cancels its queued save — a queued write must never resurrect a deleted file.
- [ ] Renaming a game flushes the old key first and aborts the rename if that flush fails.
- [ ] The admin shell reports the queue's state on **every** tab — saved, offline, retrying with a
      countdown, or a permanent error — in the same bottom-right box every other admin toast uses.
- [ ] A save is only announced as in progress once it has been on the wire for 500 ms; a fast one
      shows nothing but the "Gespeichert" flash.
- [ ] Existing cross-tab reconciliation ([live-config-reload.md](live-config-reload.md)) still holds:
      a tab shows no conflict banner for its own writes, and an edit completed *after* its tab
      unmounted raises no banner in — and is not reverted by — the tab that replaced it.

## State / data changes

No `AppState` change, no localStorage change, **no new HTTP route or WebSocket channel**. The queue
reuses `PUT /api/backend/config` and `PUT /api/backend/games/:fileName` verbatim, so
`specs/api/*.yaml` are unaffected. (`navigator.sendBeacon` was rejected precisely because it is
POST-only and would have needed a new alias route; `fetch(..., { keepalive: true })` is the same
request with a client-side flag.)

### New module: [src/services/saveQueue.ts](../src/services/saveQueue.ts)

React-free, module-scope, one entry per key. Keys: `CONFIG_SAVE_KEY` (`'config'`) and
`gameSaveKey(fileName)` (`'game:<fileName>'`).

```ts
enqueueSave<T>(key, payload, saver, opts?: { debounceMs?, beacon? }): void
flushSave(key): Promise<void>   // cancel debounce, run now
flushAll(): Promise<void>
discardSave(key): void          // deleted / renamed away
retryNow(key?): void            // reset backoff, attempt now
markSaved(key, payload): void   // the server wrote it for us — record without a PUT
isRecentSelfWrite(key, json): boolean
newerThanRead<T>(key, since): T | undefined
hasPending(key?): boolean
getStatus(): SaveQueueStatus    // cached snapshot ({ state, unsavedKeys, inFlight, attempts,
                                //   nextRetryAt, lastError, lastSavedAt, offline })
subscribe(fn): () => void
onSaved(fn: (key, json) => void): () => void
```

Per-key entry: `{ payload, saver, seq, savedSeq, timer, retryTimer, inFlight, attempts, blocked, waiters }`.

- **Coalescing** — `enqueueSave` overwrites `payload`, bumps `seq`, restarts the debounce. Newest wins;
  superseded payloads are never sent.
- **Serialization** — one `inFlight` flag per key. The `finally` block re-runs while `savedSeq !== seq`.
- **Retry classification** — retryable: no `status` / `status === 0` (network, offline), `>= 500`,
  `408`, `429`. Anything else sets `blocked` (state `error`, manual retry only). `ApiError`
  ([backendApi.ts](../src/services/backendApi.ts)) carries `.status`.
- **`flushSave`** resolves once the payload that was newest at call time (or newer) is persisted, and
  **rejects** on the first failing attempt after the call — while the entry stays queued and keeps
  retrying. Callers that need a definite answer (instance delete, rename) depend on that.
- **Self-write set** — the ~5 s `recentSelfWrites` TTL set moved here from the two components, because
  a `content-changed` echo must still be recognisable as ours after the writing pane unmounted.
- **`newerThanRead(key, since)`** — the newest payload this tab holds that a disk read *started* at
  `since` may have missed: a queued/in-flight payload, or one persisted after `since`. `undefined`
  means the read is authoritative.
- **Lifecycle listeners**, registered lazily on the first `enqueueSave` (never at import time — the
  module is imported into every test): `visibilitychange → hidden` ⇒ `flushAll()` (a normal fetch, no
  body-size limit); `pagehide` ⇒ `beacon(payload)`; `online` ⇒ `retryNow()`; `beforeunload` ⇒
  `preventDefault()` only while `retrying`/`error`.

`getStatus()` returns a **cached** object, recomputed only inside `emit()` — `useSyncExternalStore`
re-renders forever if the getter allocates.

### Beacons in [src/services/backendApi.ts](../src/services/backendApi.ts)

`saveConfigBeacon` / `saveGameBeacon`: fire-and-forget `fetch` with
`keepalive: body.length <= 60 KiB`. The size branch is load-bearing — the largest game file is already
80 KB, over the `keepalive` body cap, and for those the `visibilitychange` flush is the real path.

### React binding

[src/services/useSaveQueueStatus.ts](../src/services/useSaveQueueStatus.ts) —
`useSyncExternalStore(subscribe, getStatus, getStatus)`. The retry **countdown is deliberately not in
the store** (a ticking snapshot would re-render every consumer each second); the indicator derives it
from `nextRetryAt` with its own 1 s interval, only while `state === 'retrying'`.

## UI behaviour

### Editors

- [useEditableConfig](../src/components/backend/useEditableConfig.ts) (Config + Gameshows tabs) and
  [GameEditor](../src/components/backend/GameEditor.tsx) enqueue instead of owning a timer. **Their
  save effects have no cleanup** — that is the fix, and it is commented as deliberate.
- The mount fetch prefers `newerThanRead(key, startedAt)` over the disk read, so the pane that replaces
  an unmounted one starts from that pane's queued edit rather than writing it away.
- Reconciliation counts `hasPending(key)` as **dirty**: a queued payload is by definition unsaved, so
  the editor never adopts disk over it (that would flash the pre-save values and bounce straight back
  when the write lands). A genuine remote change still raises the conflict banner as before.
- The dirty check now runs **before** `isRecentSelfWrite`. A tab whose GET was served before a queued
  PUT landed is stale but clean, and testing the self-write set first would strand it on that stale
  copy forever.
- The per-pane success toast now hangs off `onSaved`. The per-save **error** toast is dropped: the pane
  can be gone before the failure is known, which is exactly what the global indicator is for.
- [GamesTab](../src/components/backend/GamesTab.tsx): `discardSave` before deleting a game;
  `newerThanRead` when reopening one. [LektoratTab](../src/components/backend/LektoratTab.tsx):
  `flushSave` before its re-fetch, and its own write goes through the queue so it lands in the
  self-write set. Without these, a queued save fights the delete / the correction.

### Indicator

No new chrome: the status goes in the **existing bottom-right toast box**.
[SaveStatusToast](../src/components/backend/SaveStatusToast.tsx) is the presentational half (plain
`be-toast` markup, shared with the Theme Showcase so the showcase cannot drift);
[SaveStatusIndicator](../src/components/backend/SaveStatusIndicator.tsx) subscribes to the queue and
owns the 2.5 s "Gespeichert" flash, the 500 ms announce delay and the retry countdown. It is mounted
once as a sibling of `<ProgressOverlay />` in `AdminScreen`, outside every pane, and is
`role="status" aria-live="polite"`.

Both it and the per-pane [StatusMessage](../src/components/backend/StatusMessage.tsx) portal into one
shared container ([toastRoot.ts](../src/components/backend/toastRoot.ts), `#be-toast-root`), so a pane
toast and the save status **stack** rather than landing on top of each other. The panes no longer emit
their own save toasts — there is exactly one "Gespeichert", and it comes from the shell.

| Condition | Text | Action |
|---|---|---|
| on the wire for ≥ 500 ms | `Speichern…` | — |
| just succeeded (2.5 s) | `✅ Gespeichert!` | — |
| `offline` with unsaved keys | `Offline – Änderungen werden gespeichert, sobald die Verbindung zurück ist` | — |
| `retrying` | `Speichern fehlgeschlagen – erneuter Versuch in {n} s` | `Jetzt versuchen` |
| `error` (permanent) | `❌ Speichern fehlgeschlagen: {lastError}` | `Erneut versuchen` |
| otherwise | (renders nothing) | — |

The 500 ms gate is measured from `status.inFlight`, not from "something is unsaved" — the debounce
alone is 800 ms, so timing it from the edit would announce every keystroke. A save that completes
quickly therefore shows only the `Gespeichert` flash, never `Speichern…`.

## Out of scope / known limitations

- **No cross-key ordering.** `config.json` and a game file save in parallel; only writes to the *same*
  key are ordered and serialized. Nothing today needs a global order.
- **Last-saver-wins persistence is unchanged** — the queue makes a write survive navigation, it does
  not add optimistic concurrency. Two admins editing the same file is still resolved by
  [live-config-reload.md](live-config-reload.md)'s whole-file conflict banner.
- **The queue does not outlive the browser tab.** A payload still unsaved when the process dies is lost
  beyond what the `pagehide` beacon rescues; there is no IndexedDB spool.
- Retries are unbounded in *time* but bounded in *memory*: one payload per key, so a permanently-down
  server costs a few hundred KB and one visible banner.
- The `keepalive` beacon is best-effort. Payloads over ~60 KiB fall back to a plain fetch that the
  browser may kill on unload — better than guaranteed loss, and `visibilitychange` usually fires first.
