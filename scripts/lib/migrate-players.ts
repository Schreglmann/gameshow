/**
 * Pure core of `scripts/migrate-players.ts`: turns the old per-gameshow name
 * strings into the global player registry (`AppConfig.players`) and rewrites
 * every gameshow's `players` to registry ids. See specs/players.md.
 *
 * The operator writes the mapping (old names → full names), because a first
 * name or a nickname like "Raphi W." does not say who the person is, and two
 * spellings ("Raphi", "Raphi W.") may be the same person. The old names were
 * nicknames, so the FIRST alias becomes the player's nickname (Spitzname).
 */
import type { AppConfig, Player } from '../../src/types/config';
import { fullName, nameKey, normalizeWhitespace } from '../../src/utils/playerNames';
import { slugifyPlayerId, uniquePlayerId } from '../../src/utils/playerRegistry';

export interface PlayerMappingEntry {
  firstName: string;
  lastName: string;
  /**
   * The old name strings in `gameshows[*].players` that mean this person. The
   * first one is the nickname (see `nicknameFromAlias`).
   */
  aliases: string[];
}

export interface PlayerMapping {
  players: PlayerMappingEntry[];
}

export interface MigrationReport {
  /** Registry players added by this run. */
  created: Player[];
  /** Mapping entries that matched a player already in the registry. */
  reused: Player[];
  /** Gameshow keys whose `players` changed. */
  changedShows: string[];
  /** Problems that block writing. */
  errors: string[];
  /** Worth a look, but don't block writing. */
  warnings: string[];
}

const aliasKey = (s: string) => normalizeWhitespace(s).toLocaleLowerCase('de');

/**
 * The nickname an old name stands for. The old names told two people with the
 * same nickname apart with a surname initial ("Michi H.", "Fabian Sp."); the
 * show now adds that itself when it is needed, so the initial is dropped.
 */
export function nicknameFromAlias(alias: string): string {
  const name = normalizeWhitespace(alias);
  const stripped = name.replace(/\s+\p{Lu}\p{Ll}{0,2}\.$/u, '');
  return stripped || name;
}

/** Every gameshow `players` entry that is not a registry id — the old name strings, deduped, sorted. */
export function legacyPlayerNames(config: AppConfig): string[] {
  const ids = new Set((config.players ?? []).map(p => p.id));
  const seen = new Map<string, string>();
  for (const show of Object.values(config.gameshows ?? {})) {
    for (const entry of show.players ?? []) {
      if (typeof entry !== 'string' || ids.has(entry)) continue;
      const key = aliasKey(entry);
      if (key && !seen.has(key)) seen.set(key, normalizeWhitespace(entry));
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

/** A mapping skeleton with one entry per old name, split at the first space. */
export function mappingTemplate(config: AppConfig): PlayerMapping {
  return {
    players: legacyPlayerNames(config).map(name => {
      const space = name.indexOf(' ');
      return {
        firstName: space < 0 ? name : name.slice(0, space),
        lastName: space < 0 ? '' : name.slice(space + 1),
        aliases: [name],
      };
    }),
  };
}

/**
 * Apply `mapping` to `config`. Returns the migrated config and a report; when
 * the report has errors, `config` is returned unchanged. Running it again on
 * the result changes nothing (existing registry players keep their ids).
 */
export function migratePlayers(config: AppConfig, mapping: PlayerMapping): { config: AppConfig; report: MigrationReport } {
  const report: MigrationReport = { created: [], reused: [], changedShows: [], errors: [], warnings: [] };
  const registry = [...(config.players ?? [])];
  const entries = Array.isArray(mapping?.players) ? mapping.players : [];
  if (!Array.isArray(mapping?.players)) report.errors.push('Mapping must be { "players": [ { firstName, lastName, aliases } ] }');

  // Each mapping entry needs both names, a unique full name, and aliases that
  // belong to it alone.
  const aliasOwner = new Map<string, number>();
  const fullNames = new Map<string, number>();
  entries.forEach((entry, i) => {
    const first = normalizeWhitespace(String(entry?.firstName ?? ''));
    const last = normalizeWhitespace(String(entry?.lastName ?? ''));
    const label = first || last ? `${first} ${last}`.trim() : `players[${i}]`;
    if (!first || !last) report.errors.push(`${label}: firstName and lastName are both required`);
    const key = nameKey({ firstName: first, lastName: last });
    if (first && last) {
      if (fullNames.has(key)) report.errors.push(`${label}: listed twice in the mapping`);
      else fullNames.set(key, i);
    }
    for (const alias of Array.isArray(entry?.aliases) ? entry.aliases : []) {
      const a = aliasKey(String(alias));
      if (!a) continue;
      const owner = aliasOwner.get(a);
      if (owner !== undefined && owner !== i) report.errors.push(`Alias "${alias}" is listed for more than one player`);
      else aliasOwner.set(a, i);
    }
  });

  for (const name of legacyPlayerNames(config)) {
    if (!aliasOwner.has(aliasKey(name))) report.errors.push(`"${name}" is not in any aliases list`);
  }
  if (report.errors.length > 0) return { config, report };

  // Resolve every mapping entry to a registry player: reuse by full name, else
  // create — in full-name order, so collision suffixes are stable.
  const order = entries
    .map((entry, i) => ({
      i,
      first: normalizeWhitespace(entry.firstName),
      last: normalizeWhitespace(entry.lastName),
      alias: (Array.isArray(entry.aliases) ? entry.aliases : []).map(a => String(a)).find(a => normalizeWhitespace(a)),
    }))
    .sort((a, b) => fullName({ firstName: a.first, lastName: a.last }).localeCompare(fullName({ firstName: b.first, lastName: b.last }), 'de'));
  const playerOf = new Map<number, Player>();
  const taken = new Set(registry.map(p => p.id));
  for (const { i, first, last, alias } of order) {
    const existing = registry.find(p => nameKey(p) === nameKey({ firstName: first, lastName: last }));
    if (existing) {
      playerOf.set(i, existing);
      report.reused.push(existing);
      continue;
    }
    const id = uniquePlayerId(slugifyPlayerId(first, last), taken);
    taken.add(id);
    const player: Player = { id, firstName: first, lastName: last, nickname: alias ? nicknameFromAlias(alias) : first };
    registry.push(player);
    playerOf.set(i, player);
    report.created.push(player);
  }

  // Rewrite every gameshow: old names → ids, ids kept, repeats dropped.
  const ids = new Set(registry.map(p => p.id));
  const gameshows: AppConfig['gameshows'] = {};
  for (const [key, show] of Object.entries(config.gameshows ?? {})) {
    if (!show.players) { gameshows[key] = show; continue; }
    const out: string[] = [];
    const sources = new Map<string, string>();
    for (const entry of show.players) {
      const isId = ids.has(entry) && !aliasOwner.has(aliasKey(entry));
      const id = isId ? entry : playerOf.get(aliasOwner.get(aliasKey(entry))!)?.id;
      if (!id) continue;
      if (out.includes(id)) {
        report.warnings.push(`Gameshow "${key}": "${entry}" and "${sources.get(id)}" are the same player — listed once`);
        continue;
      }
      out.push(id);
      sources.set(id, entry);
    }
    if (JSON.stringify(out) !== JSON.stringify(show.players)) report.changedShows.push(key);
    gameshows[key] = { ...show, players: out };
  }

  registry.sort((a, b) => fullName(a).localeCompare(fullName(b), 'de'));
  // Keep `players` next to `gameshows` in the file, so the registry is easy to find.
  const migrated: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === 'players') continue;
    if (k === 'gameshows') migrated.players = registry;
    migrated[k] = k === 'gameshows' ? gameshows : v;
  }
  if (!('players' in migrated)) migrated.players = registry;
  return { config: migrated as unknown as AppConfig, report };
}
