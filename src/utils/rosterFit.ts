/**
 * Fits the start-screen team cards to the screen, per card: one column of
 * names as long as the card fits without scrolling, a second (third) column
 * only when it does not. Every name keeps the normal font size whatever the
 * column count; a name that does not fit its pill steps down on its own until
 * it does. Measured in the browser (the fit depends on the theme font, the
 * viewport and the team names), so it runs from a layout effect, before
 * paint. See specs/team-management.md ("Team cards").
 */

/** Font steps tried, largest first, when a name does not fit its cell. */
export const ROSTER_FONT_STEPS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.55, 0.5] as const;

/** The most member columns a card may use: 3 with two (wide) cards, 2 with 3-4. */
export function maxRosterColumns(teamCount: number): number {
  return teamCount <= 2 ? 3 : 2;
}

/** The first option `fits` accepts, or the last one when none does. */
export function firstFitting<T>(options: readonly T[], fits: (option: T) => boolean): T {
  for (const option of options) if (fits(option)) return option;
  return options[options.length - 1]!;
}

/**
 * Shrink each name that does not fit its cell, on its own, just until it fits
 * Names that fit keep the full size — one long name must
 * not shrink the whole card.
 */
function fitNames(card: HTMLElement, inputs: HTMLInputElement[]): void {
  const first = inputs[0];
  if (!first) return;
  const style = getComputedStyle(first);
  const base = parseFloat(style.fontSize);
  if (!base) return;
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  // A hidden copy of the name in the input's font measures its width; an
  // <input> itself reports no reliable text width.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre';
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontWeight = style.fontWeight;
  probe.style.letterSpacing = style.letterSpacing;
  card.appendChild(probe);
  for (const input of inputs) {
    if (input.clientWidth === 0 || !input.value) continue; // no layout (tests, hidden) / ghost slot
    const room = input.clientWidth - padding;
    probe.textContent = input.value;
    const scale = firstFitting(ROSTER_FONT_STEPS, s => {
      probe.style.fontSize = `${base * s}px`;
      return probe.offsetWidth <= room;
    });
    if (scale < 1) {
      // Keep the pill as tall as its neighbours: only the text gets smaller.
      input.style.height = `${input.offsetHeight}px`;
      input.style.fontSize = `${base * scale}px`;
    }
  }
  probe.remove();
}

/**
 * Lay out every `.team` card inside `grid` and return the member columns per
 * card id (`team1` …). Columns are set on the card's `ul[data-columns]` as it
 * measures; the caller mirrors the result into React state.
 *
 * "Fits" means the PAGE does not scroll — the space below the cards (the
 * page's own padding, a swap button) counts too, not just the cards. The cards
 * of a row share one height, so while the page scrolls, the card with the
 * most rows gets one more column, until nothing scrolls or that card is at
 * `cap`. A short card next to a long one therefore keeps its single column.
 *
 * Only when all cards sit in ONE row can extra columns help — stacked (phone)
 * or wrapped cards scroll anyway, so they keep one column.
 */
export function fitRosterLayout(grid: HTMLElement, cap: number): Record<string, number> {
  const cards = Array.from(grid.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('team'),
  );
  const lists = cards.map(card => card.querySelector<HTMLElement>('ul.team-members'));
  const columns = cards.map(() => 1);
  // Start from the natural state: one column, the stylesheet's font.
  lists.forEach(ul => {
    if (!ul) return;
    ul.dataset.columns = '1';
    ul.querySelectorAll<HTMLInputElement>('input.team-member-input').forEach(input => {
      input.style.fontSize = '';
      input.style.height = '';
    });
  });
  const singleRow = cards.every(card => Math.abs(card.offsetTop - cards[0]!.offsetTop) < 2);
  const pageScrolls = () => document.documentElement.scrollHeight > window.innerHeight + 1;
  if (singleRow) {
    while (pageScrolls()) {
      let tallest = -1;
      let tallestBottom = -Infinity;
      lists.forEach((ul, i) => {
        const bottom = ul ? ul.getBoundingClientRect().bottom : -Infinity;
        if (bottom > tallestBottom) { tallestBottom = bottom; tallest = i; }
      });
      if (tallest < 0 || columns[tallest]! >= cap) break;
      columns[tallest]! += 1;
      lists[tallest]!.dataset.columns = String(columns[tallest]);
    }
  }
  const result: Record<string, number> = {};
  cards.forEach((card, i) => {
    const ul = lists[i];
    if (!ul) return;
    // Any column count: a long name can overflow a full-width pill too.
    fitNames(card, Array.from(ul.querySelectorAll<HTMLInputElement>('input.team-member-input')));
    result[card.id] = columns[i]!;
  });
  return result;
}
