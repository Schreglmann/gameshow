/**
 * Field-level spellcheck context for the inline underlines (Phase 2).
 *
 * GameEditor runs the per-game check and feeds the resulting matches in here,
 * keyed by segment key (`q3.answer`, `title`, …). Each prose `<SpellField segKey>`
 * subscribes to its own key and renders squiggles + a fix popover. When disabled or
 * unprovided, `useSpellField` returns an inert value so `<SpellField>` behaves like a
 * plain input. See specs/spellcheck.md.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { SpellMatch } from '@/services/backendApi';

export interface SpellCheckCtxValue {
  enabled: boolean;
  getMatches: (segKey: string) => SpellMatch[];
  /** Apply a suggestion to the field at `segKey`. */
  apply: (segKey: string, match: SpellMatch, replacement: string) => void;
  /** Add a word to the permanent allowlist (spelling false-positive). */
  allowWord: (word: string) => void;
  /** Ignore a specific match by fingerprint (grammar/other false-positive). */
  ignore: (fingerprint: string) => void;
}

const SpellCheckCtx = createContext<SpellCheckCtxValue | null>(null);

export function SpellCheckProvider({ value, children }: { value: SpellCheckCtxValue; children: ReactNode }) {
  return <SpellCheckCtx.Provider value={value}>{children}</SpellCheckCtx.Provider>;
}

export interface SpellFieldHook {
  enabled: boolean;
  matches: SpellMatch[];
  apply: (match: SpellMatch, replacement: string) => void;
  allowWord: (word: string) => void;
  ignore: (fingerprint: string) => void;
}

const NOOP_HOOK: SpellFieldHook = {
  enabled: false,
  matches: [],
  apply: () => {},
  allowWord: () => {},
  ignore: () => {},
};

export function useSpellField(segKey: string): SpellFieldHook {
  const ctx = useContext(SpellCheckCtx);
  if (!ctx || !ctx.enabled) return NOOP_HOOK;
  return {
    enabled: true,
    matches: ctx.getMatches(segKey),
    apply: (match, replacement) => ctx.apply(segKey, match, replacement),
    allowWord: ctx.allowWord,
    ignore: ctx.ignore,
  };
}
