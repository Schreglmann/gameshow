/**
 * Admin-scoped spellcheck settings (the global master switch + allowlist).
 *
 * This is admin CMS UI state — NOT gameshow runtime state — so an admin-local
 * context is appropriate (same as UploadProvider). It is the single place that
 * knows whether the feature is enabled, so the Lektorat tab and the GameEditor
 * react to the toggle without remounting. See specs/spellcheck.md.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import {
  fetchSpellConfig,
  setSpellEnabled as apiSetEnabled,
  allowSpellWord,
  removeAllowSpellWord,
  ignoreSpellMatch,
  unignoreSpellMatch,
  type SpellcheckConfig,
} from '@/services/backendApi';

interface SpellcheckSettings {
  loading: boolean;
  enabled: boolean;
  allowedWords: string[];
  ignoredMatches: string[];
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  allowWord: (word: string) => Promise<void>;
  removeWord: (word: string) => Promise<void>;
  ignoreMatch: (fingerprint: string) => Promise<void>;
  unignoreMatch: (fingerprint: string) => Promise<void>;
}

const DEFAULT_CONFIG: SpellcheckConfig = { version: 1, enabled: false, allowedWords: [], ignoredMatches: [] };

const SpellcheckSettingsCtx = createContext<SpellcheckSettings | null>(null);

export function SpellcheckSettingsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SpellcheckConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const cfg = await fetchSpellConfig();
      if (mounted.current) setConfig(cfg);
    } catch {
      // Default (disabled) on failure — feature stays off rather than breaking the admin.
      if (mounted.current) setConfig(DEFAULT_CONFIG);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const cfg = await apiSetEnabled(enabled);
    if (mounted.current) setConfig(cfg);
  }, []);

  const allowWord = useCallback(async (word: string) => {
    const cfg = await allowSpellWord(word);
    if (mounted.current) setConfig(cfg);
  }, []);

  const removeWord = useCallback(async (word: string) => {
    const cfg = await removeAllowSpellWord(word);
    if (mounted.current) setConfig(cfg);
  }, []);

  const ignoreMatch = useCallback(async (fingerprint: string) => {
    const cfg = await ignoreSpellMatch(fingerprint);
    if (mounted.current) setConfig(cfg);
  }, []);

  const unignoreMatch = useCallback(async (fingerprint: string) => {
    const cfg = await unignoreSpellMatch(fingerprint);
    if (mounted.current) setConfig(cfg);
  }, []);

  const value: SpellcheckSettings = {
    loading,
    enabled: config.enabled,
    allowedWords: config.allowedWords,
    ignoredMatches: config.ignoredMatches,
    refresh,
    setEnabled,
    allowWord,
    removeWord,
    ignoreMatch,
    unignoreMatch,
  };

  return <SpellcheckSettingsCtx.Provider value={value}>{children}</SpellcheckSettingsCtx.Provider>;
}

const NOOP = async () => {};

/** Disabled fallback when no provider is mounted (e.g. isolated component tests).
 *  The feature is simply off — no UI renders, so the no-op mutators are never called. */
const DISABLED_FALLBACK: SpellcheckSettings = {
  loading: false,
  enabled: false,
  allowedWords: [],
  ignoredMatches: [],
  refresh: NOOP,
  setEnabled: NOOP,
  allowWord: NOOP,
  removeWord: NOOP,
  ignoreMatch: NOOP,
  unignoreMatch: NOOP,
};

export function useSpellcheckSettings(): SpellcheckSettings {
  return useContext(SpellcheckSettingsCtx) ?? DISABLED_FALLBACK;
}
