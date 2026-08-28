import type { TeamState } from '@/types/game';
import { teamNumber, type TeamKey } from '@/utils/teams';

/** The name fields of TeamState — all a caller of `teamName` has to supply. */
export type TeamNames = Partial<Pick<TeamState, 'team1Name' | 'team2Name' | 'team3Name' | 'team4Name'>>;

/**
 * Whether this show has TEAMS worth naming.
 *
 * At 0 teams nothing scores. At 1 team points ARE awarded, but there is a single
 * side — the audience playing the show itself — so calling it "Team 1" invents a
 * team that does not exist and implies an opponent. Every surface that would
 * print a name checks this and shows the bare score instead. The `team1`
 * identity still exists underneath; it is only the LABEL that is suppressed.
 * See specs/team-count.md.
 */
export function hasNamedTeams(teamCount: number): boolean {
  return teamCount > 1;
}

/**
 * Display name for a team. Returns the custom name when set (and non-blank),
 * otherwise the positional fallback "Team 1" … "Team 4". Computed at read time
 * — never stored as derived state.
 */
export function teamName(teams: TeamNames, key: TeamKey): string {
  const name = teams[`${key}Name`];
  return name?.trim() || `Team ${teamNumber(key)}`;
}

/** "Team 1", "Team 1 und Team 2", "Team 1, Team 2 und Team 3" — for German hint copy. */
export function joinTeamNames(teams: TeamNames, keys: readonly TeamKey[]): string {
  const names = keys.map(k => teamName(teams, k));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/**
 * Joker columns in the header grid for a given enabled-joker count — mirrors
 * the grid layout in TeamJokers (1→1, 2→2, 3→3, 4→2, 5→3, 6→3), clamped to the
 * grid's 3-column max.
 */
export function jokerColumns(jokerCount: number): number {
  if (jokerCount <= 0) return 0;
  return Math.min(3, jokerCount <= 3 ? jokerCount : Math.ceil(jokerCount / 2));
}

// Smallest font scale TeamHeaderName shrinks a long name to before it truncates
// (must match the last step of its STEPS array). A name "fits" — i.e. shows in
// full without an ellipsis — iff it fits at this scale.
const NAME_MIN_FONT_SCALE = 0.76;

// An off-screen replica of the real header, reused across calls. It uses the
// same tag (`header`) and classes, so ALL the real show CSS applies — the fluid
// font, flex split, joker-grid width, score, the `:has(.header-jokers)` layout
// rule and the ellipsis. We deliberately do NOT pin any dimension: the replica
// is laid out at the CURRENT display width, so it measures truncation for the
// screen the name is actually being shown/edited on (the primary flow is the
// click-to-edit on the show itself). No hardcoded character/width budget.
//
// It is rebuilt whenever the team COUNT changes: with 3-4 teams the cells share
// the row with more siblings, so each name box is narrower and a name that fits
// at two teams may truncate at four. See specs/team-count.md.
let replica: HTMLElement | null = null;
let replicaTeamCount = 0;
let replicaName: HTMLElement | null = null;
let replicaJokerGrids: HTMLElement[] = [];

/** One team cell's markup. The measured cell is the first left-hand one. */
function replicaCell(side: 'left' | 'right', name: string): string {
  // Score uses a 2-digit value ("88") so the name region accounts for the
  // worst realistic case: when points reach double digits the score is wider
  // and steals room — a name flagged OK must still fit then, not break later.
  const label =
    `<span class="team-header-label"><span class="team-header-name">${name}</span>` +
    '<span class="team-header-score">: <span>88</span> Punkte</span></span>';
  const jokers = `<div class="header-jokers header-jokers-${side}"></div>`;
  return `<div class="team-header-cell team-header-${side}">` +
    (side === 'left' ? label + jokers : jokers + label) +
    '</div>';
}

function ensureReplica(teamCount: number): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (replica && replicaTeamCount !== teamCount) {
    replica.remove();
    replica = null;
  }
  if (!replica) {
    replica = document.createElement('header');
    replica.setAttribute('aria-hidden', 'true');
    replica.setAttribute('data-team-count', String(teamCount));
    // Off-screen, non-animated, non-sticky; full viewport width like the real
    // header (`header { width: 100% }`). No font/spacing overrides — the real
    // fluid CSS must apply for the measurement to match the live header.
    replica.style.cssText =
      'position:absolute;left:-99999px;top:0;width:100%;visibility:hidden;pointer-events:none;animation:none';
    // Mirror the real Header's split: ceil(N/2) cells left of the game counter,
    // the rest right, short side padded with the same empty spacer divs.
    const pivot = Math.ceil(teamCount / 2);
    const slots = Math.max(pivot, teamCount - pivot, 1);
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < teamCount; i += 1) {
      // The FIRST left cell is the one measured, so it starts empty.
      const cell = i < pivot ? replicaCell('left', i === 0 ? '' : `Team ${i + 1}`)
                             : replicaCell('right', `Team ${i + 1}`);
      (i < pivot ? left : right).push(cell);
    }
    while (left.length < slots) left.unshift('<div></div>');
    while (right.length < slots) right.push('<div></div>');
    replica.innerHTML =
      left.join('') + '<div id="gameNumber">Spiel 12 von 12</div>' + right.join('');
    replicaName = replica.querySelector('.team-header-name');
    replicaJokerGrids = Array.from(replica.querySelectorAll<HTMLElement>('.header-jokers'));
    replicaTeamCount = teamCount;
  }
  if (!replica.isConnected) document.body.appendChild(replica);
  return replica;
}

function configureJokers(grid: HTMLElement, side: 'left' | 'right', count: number): void {
  const cols = jokerColumns(count);
  if (cols === 0) {
    // Drop the class so the `:has(.header-jokers)` layout rule does NOT apply.
    grid.className = '';
    grid.removeAttribute('style');
    grid.innerHTML = '';
    return;
  }
  grid.className = `header-jokers header-jokers-${side}`;
  grid.style.setProperty('--joker-cols', String(cols));
  grid.innerHTML =
    '<button class="header-joker"><span class="header-joker-svg">★</span></button>'.repeat(count);
}

/**
 * True when the name would TRUNCATE (show an ellipsis) on the header at the
 * current display width, for the given enabled-joker count. Measured against an
 * off-screen header replica using the real CSS, at the smallest font the header
 * shrinks to (so the adaptive shrink is accounted for). No hardcoded budget.
 *
 * Returns false (no warning) when measurement isn't possible — SSR / no layout
 * (jsdom), or before the theme web font has loaded (fallback-font metrics would
 * misjudge widths; once the font loads a re-render re-measures correctly).
 */
export function isTeamNameLong(
  name: string | undefined,
  jokerCount: number,
  teamCount = 2,
): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return false;
  if (teamCount <= 0) return false;
  // Avoid measuring with fallback-font metrics before the theme font is ready.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    return false;
  }
  const root = ensureReplica(teamCount);
  if (!root || !replicaName) return false;
  try {
    for (const grid of replicaJokerGrids) {
      configureJokers(grid, grid.classList.contains('header-jokers-right') ? 'right' : 'left', jokerCount);
    }
    replicaName.style.fontSize = `${NAME_MIN_FONT_SCALE}em`;
    replicaName.textContent = trimmed;
    // scrollWidth = full text width at the floor scale; clientWidth = allocated
    // box. It truncates only when the former still exceeds the latter.
    if (!replicaName.clientWidth) return false; // not laid out (jsdom)
    return replicaName.scrollWidth > replicaName.clientWidth + 1;
  } finally {
    // Detach after measuring so the replica's text never pollutes the live DOM
    // (accessibility tree, Testing Library queries, etc.).
    replicaName.textContent = '';
    root.remove();
  }
}
