/**
 * Player identity and display labels for live team rosters — used by the show,
 * the gamemaster and the admin. Pure functions, no React. See specs/players.md.
 *
 * - Identity: `samePlayer` compares registry ids when both sides have one,
 *   otherwise the full name (trimmed, whitespace collapsed, case-insensitive)
 *   — the nickname for a player who has neither first name nor surname.
 * - Labels: `displayNames` shows the nickname (Spitzname; the first name when
 *   there is none), plus the shortest surname prefix that tells players with
 *   the same nickname apart. Derived at read time over the whole draw
 *   (`rosterDisplayNames`), never stored.
 */
import type { Player } from '../types/config.js';
import type { RosterPlayer, TeamState } from '../types/game.js';
import { teamRoster, type TeamKey } from './teams.js';

/** Anything with a first and last name — a registry `Player` or a `RosterPlayer`. */
export interface NamedPlayer {
  firstName: string;
  lastName: string;
  nickname?: string;
  id?: string;
}

/** Trim and collapse inner whitespace. */
export function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

const lower = (s: string) => normalizeWhitespace(s).toLocaleLowerCase('de');

/**
 * Capitalize EVERY word ("john smith" → "John Smith"), not just the first —
 * and every part of a double name ("anna-lena" → "Anna-Lena").
 */
export function normalizePlayerName(name: string): string {
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
  return normalizeWhitespace(name)
    .split(' ')
    .map(word => word.split('-').map(cap).join('-'))
    .join(' ');
}

/** Whether a first name or a surname is set (a live-added player has only a nickname). */
export function hasFullName(p: NamedPlayer): boolean {
  return normalizeWhitespace(p.firstName) !== '' || normalizeWhitespace(p.lastName) !== '';
}

/**
 * Case-insensitive identity key: the full name (`"anna|müller"`), or the
 * nickname (`"~maus"`) for a player with neither first name nor surname.
 */
export function nameKey(p: NamedPlayer): string {
  if (!hasFullName(p)) return `~${lower(p.nickname ?? '')}`;
  return `${lower(p.firstName)}|${lower(p.lastName)}`;
}

/**
 * Same player: equal ids when both have one, otherwise equal identity keys —
 * and a name typed as written (nickname only, "Anna Müller") is the player
 * whose full name it is.
 */
export function samePlayer(a: NamedPlayer, b: NamedPlayer): boolean {
  if (a.id && b.id) return a.id === b.id;
  if (nameKey(a) === nameKey(b)) return true;
  return hasFullName(a) !== hasFullName(b) && lower(fullName(a)) === lower(fullName(b));
}

/** "Anna Müller", just "Anna" without a surname, or the nickname when neither is set. */
export function fullName(p: NamedPlayer): string {
  const full = [normalizeWhitespace(p.firstName), normalizeWhitespace(p.lastName)].filter(Boolean).join(' ');
  return full || normalizeWhitespace(p.nickname ?? '');
}

/** What the show calls the player before any disambiguation: the nickname, else the first name. */
export function shownName(p: NamedPlayer): string {
  return normalizeWhitespace(p.nickname ?? '') || normalizeWhitespace(p.firstName);
}

/**
 * The admin's label: the full name, with the nickname in quotes when it is
 * not just the first name — `Michael „Michi“ Huber`.
 */
export function adminLabel(p: NamedPlayer): string {
  const nick = normalizeWhitespace(p.nickname ?? '');
  if (!nick || !hasFullName(p) || lower(nick) === lower(p.firstName)) return fullName(p);
  return [normalizeWhitespace(p.firstName), `„${nick}“`, normalizeWhitespace(p.lastName)].filter(Boolean).join(' ');
}

/**
 * A stable string for a roster: the change key for effects and the echo guard.
 * Field order is fixed, so the same roster always gives the same string no
 * matter how its objects were built. `.join(' ')` on objects would only give
 * "[object Object]".
 */
export function rosterSignature(roster: readonly RosterPlayer[]): string {
  return JSON.stringify(rosterTuples(roster));
}

/** The roster as `[firstName, lastName, nickname | null, id | null]` tuples — the fixed form behind `rosterSignature`. */
export function rosterTuples(roster: readonly RosterPlayer[]): [string, string, string | null, string | null][] {
  return roster.map(p => [p.firstName, p.lastName, p.nickname ?? null, p.id ?? null]);
}

/** Split at the first space: "Anna Maria Müller" → ["Anna", "Maria Müller"]. */
function splitName(name: string): [string, string] {
  const space = name.indexOf(' ');
  return space < 0 ? [name, ''] : [name.slice(0, space), name.slice(space + 1)];
}

/**
 * Bring untrusted roster data (localStorage, WS payload) into shape. A plain
 * string is a roster entry from before players had two names: the first word
 * becomes the first name, the rest the surname, no id. Returns `null` for
 * anything with neither a first name nor a nickname.
 */
export function toRosterPlayer(value: unknown): RosterPlayer | null {
  if (typeof value === 'string') {
    const name = normalizeWhitespace(value);
    if (!name) return null;
    const [firstName, lastName] = splitName(name);
    return { firstName, lastName };
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const firstName = typeof raw.firstName === 'string' ? normalizeWhitespace(raw.firstName) : '';
  const lastName = typeof raw.lastName === 'string' ? normalizeWhitespace(raw.lastName) : '';
  const nickname = typeof raw.nickname === 'string' ? normalizeWhitespace(raw.nickname) : '';
  if (!firstName && !nickname) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
  const player: RosterPlayer = { firstName, lastName };
  if (nickname) player.nickname = nickname;
  if (id) player.id = id;
  return player;
}

/**
 * A whole roster from untrusted data. Entries that cannot be read are dropped;
 * duplicates are KEPT — legacy state may hold two "Anna", and a player must
 * never vanish without anyone removing them.
 */
export function normalizeRoster(value: unknown): RosterPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.map(toRosterPlayer).filter((p): p is RosterPlayer => p !== null);
}

/** Registry players from untrusted settings data — only entries with an id and a first name or nickname. */
export function normalizeSettingsPlayers(value: unknown): Player[] {
  if (!Array.isArray(value)) return [];
  const out: Player[] = [];
  for (const entry of value) {
    const p = toRosterPlayer(entry);
    const disabled = (entry as { disabled?: unknown } | null)?.disabled === true;
    if (p?.id) out.push(toRegistryShape(p as RosterPlayer & { id: string }, disabled));
  }
  return out;
}

function toRegistryShape(p: NamedPlayer & { id: string }, disabled: boolean): Player {
  const player: Player = { id: p.id, firstName: p.firstName, lastName: p.lastName, nickname: shownName(p) };
  if (disabled) player.disabled = true;
  return player;
}

/** A configured player as a roster entry (id and nickname included). */
export function rosterPlayerOf(p: Player): RosterPlayer {
  return { firstName: p.firstName, lastName: p.lastName, nickname: shownName(p), id: p.id };
}

/** A typed name resolved against the registry: a player, or a nickname several players share. */
type TypedName = { player: RosterPlayer } | { ambiguous: string };

function resolveTypedName(raw: string, known: readonly Player[]): TypedName | null {
  const text = normalizeWhitespace(raw);
  if (!text) return null;
  const key = lower(text);
  const byName = known.find(k => (hasFullName(k) && lower(fullName(k)) === key) || lower(adminLabel(k)) === key);
  if (byName) return { player: rosterPlayerOf(byName) };
  const byNick = known.filter(k => lower(shownName(k)) === key);
  if (byNick.length === 1) return { player: rosterPlayerOf(byNick[0]!) };
  // Shared with disabled players only: the one active player is meant.
  const active = byNick.filter(k => !k.disabled);
  if (active.length === 1) return { player: rosterPlayerOf(active[0]!) };
  if (byNick.length > 1) return { ambiguous: text };
  // A new name: kept as written, as the nickname. The admin fills in the rest.
  return { player: { firstName: '', lastName: '', nickname: text } };
}

/**
 * One typed name → a roster player. A registry player's full name (or admin
 * label), or the nickname of exactly ONE registry player, gives that player,
 * id included. Anything else is a new player with the text, as written, as
 * the nickname. A nickname several registry players share gives `null` (see
 * `parsePlayerNames` for the reason).
 */
export function parsePlayerInput(raw: string, known: readonly Player[] = []): RosterPlayer | null {
  const resolved = resolveTypedName(raw, known);
  return resolved && 'player' in resolved ? resolved.player : null;
}

/**
 * A comma- or newline-separated list of names. Blanks are dropped; a nickname
 * several registry players share is listed in `ambiguous` instead.
 */
export function parsePlayerNames(
  text: string,
  known: readonly Player[] = [],
): { players: RosterPlayer[]; ambiguous: string[] } {
  const players: RosterPlayer[] = [];
  const ambiguous: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const resolved = resolveTypedName(part, known);
    if (!resolved) continue;
    if ('player' in resolved) players.push(resolved.player);
    else ambiguous.push(resolved.ambiguous);
  }
  return { players, ambiguous };
}

/** `parsePlayerNames` without the ambiguous ones. */
export function parsePlayerList(text: string, known: readonly Player[] = []): RosterPlayer[] {
  return parsePlayerNames(text, known).players;
}

/**
 * The players a typed name is matched against: the whole registry, with the
 * gameshow's players first (a fixture or old server without `registry` still
 * resolves the configured ones), then the binned (deleted) players — marked
 * `disabled` here, so they are suggested only for a name typed in full and an
 * active player wins a shared nickname. Adding one restores them on the
 * server. See specs/players.md ("Player bin").
 */
export function knownPlayers(settings: {
  players: readonly Player[];
  registry?: readonly Player[];
  binned?: readonly Player[];
}): Player[] {
  const seen = new Set(settings.players.map(p => p.id));
  const registry = (settings.registry ?? []).filter(p => !seen.has(p.id));
  for (const p of registry) seen.add(p.id);
  const binned = (settings.binned ?? []).filter(p => !seen.has(p.id)).map(p => ({ ...p, disabled: true }));
  return [...settings.players, ...registry, ...binned];
}

/** One autocomplete entry: a registry player id and the label the list shows. */
export interface Suggestion {
  id: string;
  label: string;
  /** Offered only when the typed text is one of these in full (a disabled player). */
  fullMatch?: string[];
}

/** Every name a player can be typed by in full: first name, surname, nickname, full name, admin label. */
export function namesOf(p: NamedPlayer): string[] {
  const names = [p.firstName, p.lastName, p.nickname ?? '', fullName(p), adminLabel(p)].map(normalizeWhitespace).filter(Boolean);
  return [...new Set(names)];
}

/**
 * Whether the autocomplete offers this registry player for `query`: an
 * active player when their full name or nickname contains it, a disabled one
 * only when it is one of their names in full. See specs/players.md.
 */
export function playerMatchesQuery(p: Player, query: string): boolean {
  const q = lower(query);
  if (!q) return !p.disabled;
  if (p.disabled) return namesOf(p).some(n => lower(n) === q);
  return lower(`${fullName(p)} ${p.nickname}`).includes(q);
}

/**
 * Registry players not in `exclude` (the draw), labelled `Michael „Michi“
 * Huber`, sorted. A disabled player carries `fullMatch`, so the list offers
 * them only for a name typed in full.
 */
export function playerSuggestions(registry: readonly Player[], exclude: readonly NamedPlayer[]): Suggestion[] {
  return registry
    .filter(p => !exclude.some(e => samePlayer(e, p)))
    .map((p): Suggestion => (p.disabled
      ? { id: p.id, label: adminLabel(p), fullMatch: namesOf(p) }
      : { id: p.id, label: adminLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/**
 * The entries whose label contains `query` (case-insensitive), best first:
 * label starts with it, then a word starts with it, then anywhere. An empty
 * query matches nothing — the list only opens while typing. An entry with
 * `fullMatch` (a disabled player) matches only a name typed in full.
 */
export function filterSuggestions<T extends Suggestion>(items: readonly T[], query: string, limit = 8): T[] {
  const q = lower(query);
  if (!q) return [];
  const rank = (label: string, fullMatch?: string[]): number => {
    if (fullMatch) return fullMatch.some(n => lower(n) === q) ? 0 : -1;
    const l = lower(label);
    if (l.startsWith(q)) return 0;
    if (l.split(/[\s„“"()-]+/).some(w => w.startsWith(q))) return 1;
    return l.includes(q) ? 2 : -1;
  };
  return items
    .map((item, i) => ({ item, i, r: rank(item.label, item.fullMatch) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(x => x.item);
}

/** A surname prefix may not end here: "van " or "Müller-" would read as a typo. */
const BAD_PREFIX_END = new Set([' ', '-']);

/**
 * The label for each player, in input order: the nickname alone (the first
 * name when there is none), unless another player in `players` has the same
 * one. Then the shortest prefix of the surname that no other surname in that
 * group starts with is added — "Michi H.", "Jo Ka." — or the whole surname
 * without a dot when only that works ("Anna Huber" next to "Anna Huberty").
 * Two in a group with the same surname are told apart by first name.
 */
export function displayNames(players: readonly NamedPlayer[]): string[] {
  const firstKeys = players.map(p => lower(shownName(p)));
  const groups = new Map<string, number[]>();
  firstKeys.forEach((key, i) => {
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  });

  return players.map((p, i) => {
    const first = shownName(p);
    const last = normalizeWhitespace(p.lastName);
    const group = groups.get(firstKeys[i]!)!;
    if (!last || group.length < 2) return first;
    // Same nickname and the same surname: only the first name can tell them apart.
    const sameLast = group.some(j => j !== i && lower(players[j]!.lastName) === lower(last));
    if (sameLast && lower(p.firstName) !== lower(first)) return `${first} (${normalizeWhitespace(p.firstName)})`;

    // Code points, so "Ö" counts as one letter.
    const chars = Array.from(last);
    const lowerChars = chars.map(c => c.toLocaleLowerCase('de'));
    const others = group
      .filter(j => j !== i)
      .map(j => Array.from(normalizeWhitespace(players[j]!.lastName)).map(c => c.toLocaleLowerCase('de')).join(''));

    for (let k = 1; k < chars.length; k++) {
      if (BAD_PREFIX_END.has(chars[k - 1]!)) continue;
      const prefix = lowerChars.slice(0, k).join('');
      if (others.every(o => !o.startsWith(prefix))) {
        const shown = chars.slice(0, k).join('');
        return `${first} ${shown}${shown.endsWith('.') ? '' : '.'}`;
      }
    }
    return `${first} ${last}`;
  });
}

/**
 * Labels for every active roster, computed over the whole draw — a player
 * keeps their label when moved to another team. Each array lines up with
 * `teamRoster(teams, key)` by index.
 */
export function rosterDisplayNames(
  teams: TeamState,
  keys: readonly TeamKey[],
): Partial<Record<TeamKey, string[]>> {
  const rosters = keys.map(k => teamRoster(teams, k));
  const labels = displayNames(rosters.flat());
  const out: Partial<Record<TeamKey, string[]>> = {};
  let offset = 0;
  keys.forEach((key, i) => {
    const length = rosters[i]!.length;
    out[key] = labels.slice(offset, offset + length);
    offset += length;
  });
  return out;
}

export interface AdditionCheck {
  /** New players that may join. */
  accepted: RosterPlayer[];
  /** Refused: already in the draw (or twice in this batch). */
  duplicates: RosterPlayer[];
  /** Accepted, but without a surname while the first name is taken. */
  clashes: RosterPlayer[];
  /** Typed nicknames several registry players share — nothing added for them. */
  ambiguous?: string[];
}

/**
 * The one uniqueness rule for every add path: a player already in `existing`
 * (or earlier in `incoming`) is refused; a surname-less player whose first
 * name is taken is accepted but reported, so the host can add a surname.
 */
export function checkAdditions(
  existing: readonly RosterPlayer[],
  incoming: readonly RosterPlayer[],
): AdditionCheck {
  const result: AdditionCheck = { accepted: [], duplicates: [], clashes: [] };
  for (const p of incoming) {
    const present = [...existing, ...result.accepted];
    if (present.some(e => samePlayer(e, p))) {
      result.duplicates.push(p);
      continue;
    }
    if (!normalizeWhitespace(p.lastName) && present.some(e => lower(shownName(e)) === lower(shownName(p)))) {
      result.clashes.push(p);
    }
    result.accepted.push(p);
  }
  return result;
}

/** German feedback for an add, or `null` when everything went through cleanly. */
export function additionFeedback(result: AdditionCheck): string | null {
  const parts: string[] = [];
  if (result.duplicates.length === 1) {
    parts.push(`„${fullName(result.duplicates[0]!)}“ ist schon dabei.`);
  } else if (result.duplicates.length > 1) {
    parts.push(`Schon dabei: ${result.duplicates.map(fullName).join(', ')}.`);
  }
  if (result.clashes.length > 0) {
    const names = result.clashes.map(p => `„${shownName(p)}“`).join(', ');
    parts.push(`${names} gibt es schon – Vor- und Nachnamen im Admin ergänzen, damit sie unterscheidbar sind.`);
  }
  for (const name of result.ambiguous ?? []) {
    parts.push(`„${name}“ gibt es mehrmals – bitte aus der Liste auswählen.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
