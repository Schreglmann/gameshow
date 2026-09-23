import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTeamColorVars } from '@/hooks/useTeamColorVars';
import type { TeamColors } from '@/utils/teamColors';

// See specs/team-colors.md — the single DOM write that feeds every team surface.
describe('useTeamColorVars', () => {
  beforeEach(() => {
    const root = document.documentElement;
    root.removeAttribute('style');
    delete root.dataset.teamColors;
  });

  const varOf = (key: string) =>
    document.documentElement.style.getPropertyValue(`--${key}-color`);

  it('publishes one custom property per marked team and flags the root', () => {
    renderHook(() => useTeamColorVars({ team1: '#ff0000', team2: '#00ff00' }));
    expect(varOf('team1')).toBe('#ff0000');
    expect(varOf('team2')).toBe('#00ff00');
    expect(document.documentElement.dataset.teamColors).toBe('on');
  });

  it('REMOVES the property for an absent or blank team, never blanks it', () => {
    // A declared-but-empty custom property would make
    // `var(--teamN-color, var(--teamN-house, transparent))` resolve to nothing
    // instead of falling through to the theme's house colour — the whole
    // fallback chain hangs off this.
    renderHook(() => useTeamColorVars({ team1: '#ff0000', team2: '' }));
    expect(document.documentElement.style.getPropertyValue('--team2-color')).toBe('');
    expect(document.documentElement.getAttribute('style')).not.toContain('--team2-color');
    expect(document.documentElement.getAttribute('style')).not.toContain('--team3-color');
  });

  it('drops the root flag when no team is marked', () => {
    const { rerender } = renderHook(
      ({ colors }: { colors: TeamColors }) => useTeamColorVars(colors),
      { initialProps: { colors: { team1: '#ff0000' } as TeamColors } },
    );
    expect(document.documentElement.dataset.teamColors).toBe('on');
    rerender({ colors: {} });
    expect(document.documentElement.dataset.teamColors).toBeUndefined();
    expect(varOf('team1')).toBe('');
  });

  it('does not rewrite the DOM when the palette is unchanged', () => {
    // The settings reducer allocates a new object on every settings load
    // (including each content-changed re-fetch), so the effect keys on the four
    // primitives rather than the object identity.
    const setProperty = vi.spyOn(document.documentElement.style, 'setProperty');
    const { rerender } = renderHook(
      ({ colors }: { colors: TeamColors }) => useTeamColorVars(colors),
      { initialProps: { colors: { team1: '#ff0000' } as TeamColors } },
    );
    const afterFirst = setProperty.mock.calls.length;
    rerender({ colors: { team1: '#ff0000' } });
    expect(setProperty.mock.calls.length).toBe(afterFirst);
    setProperty.mockRestore();
  });
});
