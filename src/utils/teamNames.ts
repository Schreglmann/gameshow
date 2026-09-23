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

/**
 * The German hint shown next to a team-name input whose value `isTeamNameLong`
 * — the ONE copy for the HomeScreen card, the gamemaster rename panel and the
 * admin SessionTab. Each joker column steals room from the name, so the copy
 * says so when any are enabled.
 */
export function teamNameLongHint(jokerCount: number): string {
  const note = jokerCount > 0 ? ` (mit ${jokerCount} Joker${jokerCount === 1 ? '' : 'n'} weniger Platz)` : '';
  return `Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt${note}.`;
}

// Smallest font scale TeamHeaderName shrinks a long name to before it truncates
// (must match the last step of its STEPS array). A name "fits" — i.e. shows in
// full without an ellipsis — iff it fits at this scale.
const NAME_MIN_FONT_SCALE = 0.76;

// An off-screen replica of the real header, reused across calls. It uses the
// same tag (`header`), the same classes and the same tree as `Header.tsx`
// renders — the `.team-header-stack` columns above two teams, `data-team` on
// every cell, the colour dot before the name, `--joker-count` on the cell — so
// ALL the real show CSS applies: the fluid font, the flex split, the pill cap
// and its joker-aware floor, the joker-grid width, the score, the
// `:has(.header-jokers)` layout rule and the ellipsis. We deliberately do NOT
// pin any dimension: the replica is laid out at the CURRENT display width, so
// it measures truncation for the screen the name is actually being shown/edited
// on (the primary flow is the click-to-edit on the show itself). No hardcoded
// character/width budget.
//
// It is rebuilt whenever the team COUNT changes: at 3-4 teams a pill is capped
// to half its side, so a name that fits at two teams may truncate at four. The
// unit test in tests/unit/utils/teamNames.test.ts diffs this tree against the
// real `<Header>`, so a markup change there fails loudly here.
// See specs/team-management.md and specs/team-count.md.
/**
 * The off-screen wrapper the replica header sits in. It carries the SHOW's
 * theme as `data-theme`, because the theme decides the header's font: the admin
 * runs its own theme on `<html>` (Atlas beside a Pub-Quiz show), so a replica
 * inheriting from there measured the wrong glyphs and flagged different names
 * than the show did. Theme rules are attribute selectors (`[data-theme="x"]`,
 * the same mechanism the theme showcase pins previews with), so a wrapper is
 * enough. Without a theme it is transparent and the header inherits `<html>`.
 */
let replicaWrapper: HTMLElement | null = null;
let replica: HTMLElement | null = null;
let replicaTeamCount = 0;
let replicaName: HTMLElement | null = null;
/** Each cell's joker grid with the cell it belongs to — detached while no jokers are enabled. */
let replicaJokerGrids: Array<{ grid: HTMLElement; cell: HTMLElement; side: 'left' | 'right' }> = [];

/**
 * One team cell's markup — mirrors `renderTeamCell` in Header.tsx. The measured
 * cell is the first left-hand one (its name starts empty).
 */
function replicaCell(side: 'left' | 'right', teamKey: TeamKey, name: string): string {
  // Score uses a 2-digit value ("88") so the name region accounts for the
  // worst realistic case: when points reach double digits the score is wider
  // and steals room — a name flagged OK must still fit then, not break later.
  const label =
    '<span class="team-header-label">' +
    `<span class="team-dot" data-team="${teamKey}" aria-hidden="true"></span>` +
    `<span class="team-header-name">${name}</span>` +
    '<span class="team-header-score">: <span>88</span> Punkte</span></span>';
  const jokers = `<div class="header-jokers header-jokers-${side}"></div>`;
  return `<div id="${teamKey}PointsContainer" class="team-header-cell team-header-${side}" data-team="${teamKey}">` +
    (side === 'left' ? label + jokers : jokers + label) +
    '</div>';
}

// The counter's text when the show's length is unknown (fixtures, a client that
// predates `totalGames`): two digits twice, the widest realistic case.
const FALLBACK_TOTAL_GAMES = 12;

/**
 * Sets the replica's counter to the WIDEST text it will show in THIS show —
 * "Spiel k von N" for the k in 1…N that renders widest (the last game when
 * nothing can be measured). Its width is what the two stacks share the row
 * with: a 12-game show's counter is ~50px wider than a 5-game show's at 1920,
 * and in a handwriting font "Spiel 5 von 5" is ~35px wider than "Spiel 1 von 5";
 * every one of those pixels comes out of the name boxes, so both a fixed worst
 * case and the current game flagged names the real header shows in full — or
 * passed names it cuts once the show reaches its widest counter.
 */
function setWidestCounterText(counter: Element, totalGames: number | undefined): void {
  const n = totalGames && totalGames > 0 ? totalGames : FALLBACK_TOTAL_GAMES;
  let best = `Spiel ${n} von ${n}`;
  counter.textContent = best;
  let bestWidth = counter.scrollWidth;
  for (let k = 1; k < n; k += 1) {
    const text = `Spiel ${k} von ${n}`;
    counter.textContent = text;
    const width = counter.scrollWidth;
    if (width > bestWidth) {
      best = text;
      bestWidth = width;
    }
  }
  counter.textContent = best;
}

/** The replica's inner markup for a team count of two or more. */
function replicaMarkup(teamCount: number): string {
  // Mirror the real Header's split: ceil(N/2) cells left of the game counter,
  // the rest right. At two teams that is one cell a side; above two each side
  // is a `.team-header-stack` column (no spacer padding — the stacks are the
  // two equal columns).
  const pivot = Math.ceil(teamCount / 2);
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < teamCount; i += 1) {
    const teamKey = `team${i + 1}` as TeamKey;
    const cell = i < pivot ? replicaCell('left', teamKey, i === 0 ? '' : `Team ${i + 1}`)
                           : replicaCell('right', teamKey, `Team ${i + 1}`);
    (i < pivot ? left : right).push(cell);
  }
  const side = (cells: string[], name: 'left' | 'right') => teamCount > 2
    ? `<div class="team-header-stack team-header-stack-${name}">${cells.join('')}</div>`
    : cells.join('');
  return side(left, 'left') + '<div id="gameNumber"></div>' + side(right, 'right');
}

function ensureReplica(teamCount: number, theme: string | undefined): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (replica && replicaTeamCount !== teamCount) {
    replicaWrapper?.remove();
    replicaWrapper = null;
    replica = null;
  }
  if (!replica || !replicaWrapper) {
    replicaWrapper = document.createElement('div');
    replicaWrapper.className = 'team-name-replica';
    replicaWrapper.setAttribute('aria-hidden', 'true');
    // Off-screen, full width like the real header's parent — the header itself
    // keeps its own `width: 100%`. No font/spacing overrides — the real fluid
    // CSS must apply for the measurement to match the live header.
    // `font-family` is the ONE style the wrapper re-applies: base.css sets it on
    // `body` from `--font-primary`, and a wrapper that only redefines the
    // variable still inherits the body's already-resolved (admin) font.
    replicaWrapper.style.cssText =
      'position:absolute;left:-99999px;top:0;width:100%;visibility:hidden;pointer-events:none;' +
      'font-family:var(--font-primary)';
    replica = document.createElement('header');
    replica.setAttribute('data-team-count', String(teamCount));
    replica.style.cssText = 'position:static;animation:none';
    replica.innerHTML = replicaMarkup(teamCount);
    replicaWrapper.appendChild(replica);
    replicaName = replica.querySelector('.team-header-name');
    replicaJokerGrids = Array.from(replica.querySelectorAll<HTMLElement>('.header-jokers'), grid => ({
      grid,
      cell: grid.parentElement as HTMLElement,
      side: grid.classList.contains('header-jokers-right') ? 'right' as const : 'left' as const,
    }));
    replicaTeamCount = teamCount;
  }
  if (theme) replicaWrapper.setAttribute('data-theme', theme);
  else replicaWrapper.removeAttribute('data-theme');
  if (!replicaWrapper.isConnected) document.body.appendChild(replicaWrapper);
  return replica;
}

function configureJokers(
  { grid, cell, side }: { grid: HTMLElement; cell: HTMLElement; side: 'left' | 'right' },
  count: number,
): void {
  // The cell's minimum width covers its joker row (layout.css) via the same
  // `--joker-count` Header.tsx sets on the real cell.
  cell.style.setProperty('--joker-count', String(count));
  if (count <= 0) {
    // `TeamJokers` renders nothing without enabled jokers, so the grid leaves
    // the tree (and the `:has(.header-jokers)` layout rule does NOT apply).
    grid.remove();
    return;
  }
  // Left cell: label then grid; right cell: grid then label (Header.tsx).
  if (!grid.isConnected) {
    if (side === 'left') cell.append(grid);
    else cell.prepend(grid);
  }
  grid.style.setProperty('--joker-cols', String(jokerColumns(count)));
  grid.innerHTML =
    '<button class="header-joker"><span class="header-joker-svg">★</span></button>'.repeat(count);
}

/** What the header check needs to know about the show besides the name. */
export interface TeamNameFitContext {
  /** Enabled jokers — each column steals room from the name. */
  jokerCount: number;
  /** Active team count (0-4); below two teams no name is printed. Default 2. */
  teamCount?: number;
  /** The show's game count — sizes the counter the pills share the row with. */
  totalGames?: number;
  /**
   * The SHOW's theme id (`useTheme().theme`). Pass it from a zone whose `<html>`
   * carries a different theme — the admin — so the replica measures with the
   * show's font. Omit on the show itself.
   */
  theme?: string;
}

/**
 * The attached, joker-configured header replica — what `isTeamNameLong`
 * measures against. Returns the `<header>` (its parent is the theme wrapper).
 * Exported so a test can diff its tree against the real `<Header>`; the caller
 * removes the wrapper when done. `null` without a DOM.
 */
export function buildHeaderReplica(ctx: TeamNameFitContext): HTMLElement | null {
  const root = ensureReplica(ctx.teamCount ?? 2, ctx.theme);
  if (!root) return null;
  for (const entry of replicaJokerGrids) configureJokers(entry, ctx.jokerCount);
  const counter = root.querySelector('#gameNumber');
  if (counter) setWidestCounterText(counter, ctx.totalGames);
  return root;
}

/**
 * True when the name would be CUT somewhere in the show. The header is the one
 * surface that cuts a name (shrink, then ellipsis) — every other place a team
 * name appears (team cards, guess fields, award cards, judgment headings,
 * winner banner, gamemaster panels) wraps or has its own fit, so the header's
 * tightest box is the show's limit (see specs/team-management.md, "Where a
 * name shows"). Measured at the current display width against an off-screen
 * header replica using the real CSS, in the show's theme, for the given joker
 * count, team count and show length (`totalGames` — the game counter's width is
 * room the names do not get), at the smallest font the header shrinks to (so
 * the adaptive shrink is accounted for). No hardcoded budget.
 *
 * Returns false (no warning) when measurement isn't possible — SSR / no layout
 * (jsdom), or before the theme web font has loaded (fallback-font metrics would
 * misjudge widths; once the font loads a re-render re-measures correctly) — and
 * below two teams, where the header prints no name at all (`hasNamedTeams`).
 */
export function isTeamNameLong(name: string | undefined, ctx: TeamNameFitContext): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return false;
  if (!hasNamedTeams(ctx.teamCount ?? 2)) return false;
  // Avoid measuring with fallback-font metrics before the theme font is ready.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    return false;
  }
  const root = buildHeaderReplica(ctx);
  if (!root || !replicaName) return false;
  try {
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
    replicaWrapper?.remove();
  }
}
