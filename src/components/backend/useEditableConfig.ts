import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppConfig, ContentChangedPayload } from '@/types/config';
import { fetchConfig, saveConfig, saveConfigBeacon } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import {
  CONFIG_SAVE_KEY,
  enqueueSave,
  hasPending,
  isRecentSelfWrite,
  newerThanRead,
  onSaved,
} from '@/services/saveQueue';

export interface EditableConfig {
  config: AppConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  loading: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  showMsg: (type: 'success' | 'error', text: string) => void;
  conflict: { fresh: AppConfig } | null;
  adoptRemote: (fresh: AppConfig) => void;
  dismissConflict: () => void;
}

/**
 * Shared load/save/live-sync machinery for `config.json`, used by both the
 * Config tab and the Gameshows tab. Each tab mounts independently (the admin
 * panes are conditionally rendered), fetches a fresh config on mount, edits its
 * own slice, and writes the full config back.
 *
 * ── Persistence — see specs/admin-save-queue.md ──
 * The debounce, the PUT, the write-serialization and the retry all live in the
 * module-scope save queue, NOT in this hook. That is deliberate: the panes unmount
 * on a tab switch, and a timer owned by an effect here was cancelled by that
 * effect's cleanup — which silently discarded any setting changed within 800 ms of
 * navigating away.
 *
 * ── Cross-tab live sync (admin multi-instance) — see specs/live-config-reload.md ──
 * `savedSnapshotRef` drives the dirty check, the queue's self-write set suppresses
 * our own echoes (it has to live there so an echo of a save that completed after
 * this pane unmounted is still recognised as ours), `reconcileReq` guards stale
 * re-fetches, `skipNextSave` keeps an adopted remote config from bouncing back.
 */
export function useEditableConfig(): EditableConfig {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isFirstRender = useRef(true);
  const hasFetched = useRef(false);

  const savedSnapshotRef = useRef<string>('');
  const reconcileReq = useRef(0);
  const skipNextSave = useRef(false);
  const [conflict, setConflict] = useState<{ fresh: AppConfig } | null>(null);
  // Read by the reconcile callback, which is stable and would otherwise close over
  // a stale config.
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;

  const adoptRemote = (fresh: AppConfig) => {
    // Mark BEFORE setConfig so the save effect early-returns and doesn't re-write it.
    skipNextSave.current = true;
    savedSnapshotRef.current = JSON.stringify(fresh);
    setConfig(fresh);
    setConflict(null);
  };
  const adoptRemoteRef = useRef(adoptRemote);
  adoptRemoteRef.current = adoptRemote;

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    const startedAt = Date.now();
    fetchConfig()
      .then(disk => {
        // Prefer anything the queue holds over the disk read. A save queued by the
        // pane we just replaced is newer than disk, and a save that landed WHILE
        // this GET was in flight isn't in the response either — starting from the
        // stale read would make our first edit write that change away.
        const base = newerThanRead<AppConfig>(CONFIG_SAVE_KEY, startedAt) ?? disk;
        setConfig(base);
        savedSnapshotRef.current = JSON.stringify(base);
      })
      .catch(e => setMessage({ type: 'error', text: `Fehler beim Laden: ${e.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };
  const showMsgRef = useRef(showMsg);
  showMsgRef.current = showMsg;

  useEffect(() => {
    if (!config) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    // No cleanup on purpose — the queue owns the debounce timer, so unmounting this
    // pane can no longer cancel the write. Failures retry there, and the shell's
    // save-status pill reports them from whichever tab the operator is on.
    enqueueSave(CONFIG_SAVE_KEY, config, saveConfig, { beacon: saveConfigBeacon });
  }, [config]);

  const runReconcile = useCallback(() => {
    const myReq = ++reconcileReq.current;
    fetchConfig()
      .then(fresh => {
        const current = configRef.current;
        if (myReq !== reconcileReq.current || !current) return;
        const freshStr = JSON.stringify(fresh);
        const currentStr = JSON.stringify(current);
        if (freshStr === currentStr) return;                    // already in sync
        // A payload still queued or in flight is by definition unsaved, so it counts as
        // dirty even when it matches our baseline — adopting disk over it would flash the
        // pre-save state and then bounce straight back when our write lands.
        const isDirty = hasPending(CONFIG_SAVE_KEY) || currentStr !== savedSnapshotRef.current;
        // Clean → take disk, even if this is our own echo. Testing the self-write
        // set first would leave a tab that read a stale copy (its GET served before
        // our queued PUT landed) stuck on it forever.
        if (!isDirty) { adoptRemoteRef.current(fresh); return; }
        if (isRecentSelfWrite(CONFIG_SAVE_KEY, freshStr)) return;  // our write, we hold newer edits
        // Disk matches the baseline we loaded — no remote change to reconcile; any
        // difference is purely our own unsaved edits.
        if (freshStr === savedSnapshotRef.current) return;
        setConflict({ fresh });
      })
      .catch(() => { /* transient fetch error — keep current config */ });
  }, []);

  // Keep the on-disk baseline in step with saves the queue completes, including ones
  // issued by a pane that has since unmounted — otherwise this tab would read its
  // own landed write as a remote change.
  // The shell's SaveStatusIndicator owns the "Gespeichert" toast — it is mounted
  // outside the panes and so can also report a save that outlived this one.
  useEffect(() => onSaved((key, json) => {
    if (key !== CONFIG_SAVE_KEY) return;
    savedSnapshotRef.current = json;
  }), []);

  // React to a content-changed broadcast for config.json: adopt silently when clean,
  // show a banner when we have unsaved edits, ignore our own echoes.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (!payload?.config || !config) return;
    runReconcile();
  });

  return {
    config,
    setConfig,
    loading,
    message,
    showMsg,
    conflict,
    adoptRemote,
    dismissConflict: () => setConflict(null),
  };
}
