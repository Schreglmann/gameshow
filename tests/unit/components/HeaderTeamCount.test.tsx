import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Header from '@/components/layout/Header';
import { GameProvider } from '@/context/GameContext';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: () => true,
  onWsOpen: () => () => {},
  useWsChannel: () => {},
}));

/**
 * The header splits the ordered team list around the game counter:
 * 1 → 1/0, 2 → 1/1 (the historic layout), 3 → 2/1, 4 → 2/2.
 *
 * At 0-2 teams each side is a single slot — a cell, or an empty spacer <div> that
 * pads the shorter side so the counter stays centred. Above two teams each side
 * is instead a `.team-header-stack` column holding that side's cells, which makes
 * the two sides equal flex columns on their own (no padding needed) and puts
 * exactly one team on each row. See specs/header.md and specs/team-count.md.
 */
function renderHeader(teamCount: number, over: Record<string, unknown> = {}) {
  fetchSettings.mockResolvedValue({
    pointSystemEnabled: teamCount > 0,
    teamCount,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
    ...over,
  });
  return render(<GameProvider><Header /></GameProvider>);
}

const headerEl = () => document.querySelector('header')!;
const cells = () => Array.from(document.querySelectorAll('.team-header-cell'));

const kindOf = (el: Element) =>
  el.classList.contains('team-header-cell') ? el.id.replace('PointsContainer', '')
    : el.id === 'gameNumber' ? 'counter' : 'spacer';

/** The header's three top-level slots: left side, counter, right side. */
const topSlots = () => Array.from(headerEl().children).map(el =>
  el.classList.contains('team-header-stack') ? 'stack' : kindOf(el));

/**
 * Every team slot in DOM order, with the two stack columns flattened away — so
 * one assertion reads the display order at any count.
 */
const slots = () => Array.from(headerEl().children).flatMap(el =>
  el.classList.contains('team-header-stack')
    ? Array.from(el.children).map(kindOf)
    : [kindOf(el)]);

beforeEach(() => {
  localStorage.clear();
  // An active game, so the centre slot renders the real counter rather than the
  // same empty spacer the padding uses — otherwise the split can't be read off.
  localStorage.setItem('currentGame', JSON.stringify({ currentIndex: 0, totalGames: 3 }));
  localStorage.setItem('team1Points', '1');
  localStorage.setItem('team2Points', '2');
  localStorage.setItem('team3Points', '3');
  localStorage.setItem('team4Points', '4');
});

describe('header layout per team count', () => {
  it('keeps the historic single cell on each side at two teams', async () => {
    renderHeader(2);
    await waitFor(() => expect(cells()).toHaveLength(2));
    expect(slots()).toEqual(['team1', 'counter', 'team2']);
    expect(headerEl().getAttribute('data-team-count')).toBe('2');
  });

  it('pads the right side for a single team so the counter stays centred', async () => {
    renderHeader(1);
    await waitFor(() => expect(cells()).toHaveLength(1));
    expect(slots()).toEqual(['team1', 'counter', 'spacer']);
  });

  it('puts two teams left and one right at three teams', async () => {
    renderHeader(3);
    await waitFor(() => expect(cells()).toHaveLength(3));
    expect(slots()).toEqual(['team1', 'team2', 'counter', 'team3']);
  });

  it('splits four teams two and two', async () => {
    renderHeader(4);
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(slots()).toEqual(['team1', 'team2', 'counter', 'team3', 'team4']);
  });

  it.each([3, 4])('wraps each side in a stack column at %i teams', async count => {
    renderHeader(count);
    await waitFor(() => expect(cells()).toHaveLength(count));
    expect(topSlots()).toEqual(['stack', 'counter', 'stack']);
    // Stacked sides carry no spacer padding — the two columns balance each other.
    expect(slots()).not.toContain('spacer');
  });

  it.each([0, 1, 2])('keeps the flat two-team structure at %i teams', async count => {
    renderHeader(count);
    await waitFor(() => expect(headerEl().getAttribute('data-team-count')).toBe(String(count)));
    expect(topSlots()).not.toContain('stack');
  });

  it('drops every team cell at 0 teams, leaving the historic empty spacers', async () => {
    renderHeader(0);
    await waitFor(() => expect(headerEl().getAttribute('data-team-count')).toBe('0'));
    expect(cells()).toHaveLength(0);
    expect(slots()).toEqual(['spacer', 'counter', 'spacer']);
  });

  it.each([0, 1, 2, 3, 4])('keeps the counter slot dead centre at %i teams', async count => {
    renderHeader(count);
    await waitFor(() => expect(headerEl().getAttribute('data-team-count')).toBe(String(count)));
    // Always exactly three top-level slots — side, counter, side — whether a side
    // is one cell, one spacer or a stack column. That is what centres the counter.
    const s = topSlots();
    expect(s).toHaveLength(3);
    expect(s[1]).toBe('counter');
  });
});

describe('header layout invariants', () => {
  it('marks 3-4 team headers so the CSS can wrap them and clip the X axis', async () => {
    // The wrapped flex line reports its MIN-CONTENT width as scrollWidth, and the
    // nowrap ": N Punkte" score cannot shrink — without `overflow-x: clip` on the
    // header that made the whole page scrollable sideways on a phone. jsdom has no
    // layout, so this asserts the hook the stylesheet keys on rather than the pixels.
    for (const count of [3, 4]) {
      const { unmount } = renderHeader(count);
      await waitFor(() => expect(headerEl().getAttribute('data-team-count')).toBe(String(count)));
      unmount();
    }
  });

  it('never renders a team that is not in play', async () => {
    // A roster left over from a previous 4-team show must not leak into a 2-team one.
    localStorage.setItem('team3', JSON.stringify(['Ghost']));
    localStorage.setItem('team4Points', '99');
    renderHeader(2);
    await waitFor(() => expect(cells()).toHaveLength(2));
    expect(screen.queryByText('Team 3')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });
});

describe('header scores', () => {
  it('shows each active team\'s points and hides inactive ones', async () => {
    renderHeader(3);
    await waitFor(() => expect(cells()).toHaveLength(3));
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument(); // team4 is not in play
  });

  it('shows the bare score at 1 team — no team name, no colon', async () => {
    // A solo show has no team: the audience plays the show itself, so the header
    // states the score and nothing else. See specs/team-count.md.
    renderHeader(1);
    await waitFor(() => expect(cells()).toHaveLength(1));
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();
    expect(document.querySelector('.team-header-name')).toBeNull();
    expect(document.querySelector('.team-header-score')!.textContent!.trim()).toBe('1 Punkt');
  });

  it('still names the teams from two up', async () => {
    renderHeader(2);
    await waitFor(() => expect(cells()).toHaveLength(2));
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(document.querySelector('.team-header-score')!.textContent!.trim()).toBe(': 1 Punkt');
  });

  it('uses the singular "Punkt" only for a score of one', async () => {
    renderHeader(4);
    await waitFor(() => expect(cells()).toHaveLength(4));
    // The score reads "<name>: <n> Punkt(e)"; team1 is on 1, the rest on 2-4.
    const scores = Array.from(document.querySelectorAll('.team-header-score'))
      .map(el => el.textContent!.trim());
    expect(scores).toEqual([': 1 Punkt', ': 2 Punkte', ': 3 Punkte', ': 4 Punkte']);
  });

  it('reverses the whole row when the seating is swapped', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    renderHeader(4, { teamMirrorEnabled: true });
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(slots()).toEqual(['team4', 'team3', 'counter', 'team2', 'team1']);
  });

  it('ignores the swap while the mirror feature is off', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    renderHeader(3, { teamMirrorEnabled: false });
    await waitFor(() => expect(cells()).toHaveLength(3));
    expect(slots()).toEqual(['team1', 'team2', 'counter', 'team3']);
  });
});
