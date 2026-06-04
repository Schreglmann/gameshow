import { useState, useEffect, useRef } from 'react';
import type { AppConfig, ContentChangedPayload } from '@/types/config';
import { fetchConfig, saveConfig } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';

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
 * own slice, and writes the full config back via the 800 ms debounced save.
 *
 * ── Cross-tab live sync (admin multi-instance) — see specs/live-config-reload.md ──
 * Same reconciliation shape as GameEditor: `savedSnapshotRef` drives the dirty check,
 * `recentSelfWrites` suppresses our own echoes, `reconcileReq` guards stale re-fetches,
 * `skipNextSave` keeps an adopted remote config from bouncing straight back to the server.
 */
export function useEditableConfig(): EditableConfig {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isFirstRender = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFetched = useRef(false);

  const savedSnapshotRef = useRef<string>('');
  const recentSelfWrites = useRef<Set<string>>(new Set());
  const reconcileReq = useRef(0);
  const skipNextSave = useRef(false);
  const [conflict, setConflict] = useState<{ fresh: AppConfig } | null>(null);

  const markSelfSaved = (payload: AppConfig) => {
    const s = JSON.stringify(payload);
    savedSnapshotRef.current = s;
    recentSelfWrites.current.add(s);
    setTimeout(() => recentSelfWrites.current.delete(s), 5000);
  };

  const adoptRemote = (fresh: AppConfig) => {
    // Mark BEFORE setConfig so the save effect early-returns and doesn't re-write it.
    skipNextSave.current = true;
    savedSnapshotRef.current = JSON.stringify(fresh);
    setConfig(fresh);
    setConflict(null);
  };

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchConfig()
      .then(cfg => { setConfig(cfg); savedSnapshotRef.current = JSON.stringify(cfg); })
      .catch(e => setMessage({ type: 'error', text: `Fehler beim Laden: ${e.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveConfig(config);
        markSelfSaved(config);
        showMsg('success', '✅ Config gespeichert!');
      } catch (e) {
        showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config]);

  // React to a content-changed broadcast for config.json: adopt silently when clean,
  // show a banner when we have unsaved edits, ignore our own echoes.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (!payload?.config || !config) return;
    const myReq = ++reconcileReq.current;
    fetchConfig()
      .then(fresh => {
        if (myReq !== reconcileReq.current || !config) return;
        const freshStr = JSON.stringify(fresh);
        if (recentSelfWrites.current.has(freshStr)) return;  // our own write echoing back
        if (freshStr === JSON.stringify(config)) return;      // already in sync
        // Disk matches the baseline we loaded — no remote change to reconcile; any difference is
        // purely our own unsaved edits. Guards against a late content-changed echo falsely raising
        // the conflict banner while we have unsaved config edits.
        if (freshStr === savedSnapshotRef.current) return;
        const isDirty = JSON.stringify(config) !== savedSnapshotRef.current;
        if (isDirty) setConflict({ fresh });
        else adoptRemote(fresh);
      })
      .catch(() => { /* transient fetch error — keep current config */ });
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
