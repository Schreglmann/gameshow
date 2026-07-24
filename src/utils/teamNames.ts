import type { TeamState } from '@/types/game';

/**
 * Display name for a team. Returns the custom name when set (and non-blank),
 * otherwise the positional fallback "Team 1" / "Team 2". Computed at read time
 * — never stored as derived state.
 */
export function teamName(teams: Pick<TeamState, 'team1Name' | 'team2Name'>, n: 1 | 2): string {
  const name = n === 1 ? teams.team1Name : teams.team2Name;
  return name?.trim() || `Team ${n}`;
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
let replica: HTMLElement | null = null;
let replicaName: HTMLElement | null = null;
let replicaJokers1: HTMLElement | null = null;
let replicaJokers2: HTMLElement | null = null;

function ensureReplica(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!replica) {
    replica = document.createElement('header');
    replica.setAttribute('aria-hidden', 'true');
    // Off-screen, non-animated, non-sticky; full viewport width like the real
    // header (`header { width: 100% }`). No font/spacing overrides — the real
    // fluid CSS must apply for the measurement to match the live header.
    replica.style.cssText =
      'position:absolute;left:-99999px;top:0;width:100%;visibility:hidden;pointer-events:none;animation:none';
    // Score uses a 2-digit value ("88") so the name region accounts for the
    // worst realistic case: when points reach double digits the score is wider
    // and steals room — a name flagged OK must still fit then, not break later.
    replica.innerHTML =
      '<div class="team-header-cell team-header-left">' +
        '<span class="team-header-label"><span class="team-header-name"></span>' +
        '<span class="team-header-score">: <span>88</span> Punkte</span></span>' +
        '<div class="header-jokers header-jokers-left"></div>' +
      '</div>' +
      '<div id="gameNumber">Spiel 12 von 12</div>' +
      '<div class="team-header-cell team-header-right">' +
        '<div class="header-jokers header-jokers-right"></div>' +
        '<span class="team-header-label"><span class="team-header-name">Team 2</span>' +
        '<span class="team-header-score">: <span>88</span> Punkte</span></span>' +
      '</div>';
    replicaName = replica.querySelector('.team-header-left .team-header-name');
    replicaJokers1 = replica.querySelector('.header-jokers-left');
    replicaJokers2 = replica.querySelector('.header-jokers-right');
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
export function isTeamNameLong(name: string | undefined, jokerCount: number): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return false;
  // Avoid measuring with fallback-font metrics before the theme font is ready.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    return false;
  }
  const root = ensureReplica();
  if (!root || !replicaName || !replicaJokers1 || !replicaJokers2) return false;
  try {
    configureJokers(replicaJokers1, 'left', jokerCount);
    configureJokers(replicaJokers2, 'right', jokerCount);
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
