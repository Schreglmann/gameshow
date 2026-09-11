import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SHOW_TITLE,
  resolveShowTitle,
  normalizeShowTitle,
  cacheShowTitle,
  readCachedShowTitle,
} from '@/utils/showTitle';

// See specs/show-title.md — the operator-configurable landing-page title.
describe('resolveShowTitle', () => {
  it('falls back to the default when neither level is configured', () => {
    expect(resolveShowTitle()).toBe(DEFAULT_SHOW_TITLE);
    expect(resolveShowTitle(undefined, undefined)).toBe('Game Show');
  });

  it('uses the global title when the gameshow has none', () => {
    expect(resolveShowTitle('Sommerfest Quiz')).toBe('Sommerfest Quiz');
  });

  it('lets the gameshow override the global title', () => {
    expect(resolveShowTitle('Sommerfest Quiz', 'Weihnachtsshow')).toBe('Weihnachtsshow');
  });

  it('treats a blank gameshow title as unset and falls through to the global one', () => {
    expect(resolveShowTitle('Sommerfest Quiz', '')).toBe('Sommerfest Quiz');
    expect(resolveShowTitle('Sommerfest Quiz', '   ')).toBe('Sommerfest Quiz');
  });

  it('treats a blank global title as unset and falls through to the default', () => {
    expect(resolveShowTitle('   ', '  ')).toBe(DEFAULT_SHOW_TITLE);
  });

  it('trims surrounding whitespace off the resolved value', () => {
    expect(resolveShowTitle('  Sommerfest Quiz  ')).toBe('Sommerfest Quiz');
  });
});

describe('normalizeShowTitle', () => {
  it('passes a real title through, trimmed', () => {
    expect(normalizeShowTitle('  Sommerfest  ')).toBe('Sommerfest');
  });

  it('defaults anything missing, blank, or non-string', () => {
    expect(normalizeShowTitle(undefined)).toBe(DEFAULT_SHOW_TITLE);
    expect(normalizeShowTitle(null)).toBe(DEFAULT_SHOW_TITLE);
    expect(normalizeShowTitle('')).toBe(DEFAULT_SHOW_TITLE);
    expect(normalizeShowTitle('   ')).toBe(DEFAULT_SHOW_TITLE);
    expect(normalizeShowTitle(42)).toBe(DEFAULT_SHOW_TITLE);
  });
});

describe('show-title cache', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default before anything is cached', () => {
    expect(readCachedShowTitle()).toBe(DEFAULT_SHOW_TITLE);
  });

  it('round-trips the resolved title for the pre-mount gamemaster emit', () => {
    cacheShowTitle('Sommerfest Quiz');
    expect(readCachedShowTitle()).toBe('Sommerfest Quiz');
  });
});
