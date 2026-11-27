/**
 * The global player registry (`AppConfig.players`): ids, lookups, create and
 * rename with the uniqueness rule, resolving a gameshow's ids, and the config
 * validation. Shared by the server, the admin, `validate-config.ts` and
 * `scripts/migrate-players.ts`. See specs/players.md.
 */
import type { LivePlayersRequest, Player } from '../types/config.js';
import { adminLabel, fullName, hasFullName, nameKey, normalizeWhitespace } from './playerNames.js';
import { findInBin } from './playerBin.js';

/** Registry ids are lowercase slugs: `anna-mueller`, `anna-mueller-2`. */
export const PLAYER_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Slug of a full name — of the nickname when there is no first name or
 * surname — with German umlauts transliterated ("Jürgen Groß" → "juergen-gross").
 */
export function slugifyPlayerId(firstName: string, lastName: string, nickname = ''): string {
  const base = `${firstName} ${lastName}`.trim() || nickname;
  const slug = base
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'spieler';
}

/** `base`, or `base-2`, `base-3`, … — the first one not in `taken`. */
export function uniquePlayerId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function playerById(registry: readonly Player[]): Map<string, Player> {
  return new Map(registry.map(p => [p.id, p]));
}

/** Admin label of a registry id (`Michael „Michi“ Huber`), or the id marked as unknown. */
export function playerLabel(id: string, byId: ReadonlyMap<string, Player>): string {
  const p = byId.get(id);
  return p ? adminLabel(p) : `${id} (unbekannt)`;
}

/**
 * The registry player who already has this identity (other than `exceptId`):
 * the same full name, or — for a player without one — the same nickname.
 */
export function findNameConflict(
  registry: readonly Player[],
  firstName: string,
  lastName: string,
  exceptId?: string,
  nickname = '',
): Player | undefined {
  const key = nameKey({ firstName, lastName, nickname: nicknameOrFirst(nickname, firstName) });
  return registry.find(p => p.id !== exceptId && nameKey(p) === key);
}

/** German error for a name the registry can't take, or `null` when it's fine. */
export function playerNameError(
  registry: readonly Player[],
  firstName: string,
  lastName: string,
  exceptId?: string,
  nickname = '',
): string | null {
  const first = normalizeWhitespace(firstName);
  const last = normalizeWhitespace(lastName);
  const nick = nicknameOrFirst(nickname, first);
  if (!nick) return 'Vorname oder Spitzname angeben.';
  if (findNameConflict(registry, first, last, exceptId, nick)) {
    return `„${fullName({ firstName: first, lastName: last, nickname: nick })}“ gibt es schon.`;
  }
  return null;
}

export type PlayerChange =
  | { ok: true; player: Player; registry: Player[] }
  | { ok: false; error: string };

/** The nickname to store: the typed one, or the first name when it is left empty. */
function nicknameOrFirst(nickname: string | undefined, firstName: string): string {
  return normalizeWhitespace(nickname ?? '') || normalizeWhitespace(firstName);
}

/**
 * Add a player to the registry. The id is a slug of the full name (of the
 * nickname without one), made unique. An empty nickname becomes the first
 * name; a first name or a nickname is required.
 */
export function createPlayer(
  registry: readonly Player[],
  firstName: string,
  lastName: string,
  nickname?: string,
  /** Ids that are taken outside the registry — the player bin's. */
  takenIds: Iterable<string> = [],
): PlayerChange {
  const error = playerNameError(registry, firstName, lastName, undefined, nickname);
  if (error) return { ok: false, error };
  const first = normalizeWhitespace(firstName);
  const last = normalizeWhitespace(lastName);
  const nick = nicknameOrFirst(nickname, first);
  const id = uniquePlayerId(slugifyPlayerId(first, last, nick), new Set([...registry.map(p => p.id), ...takenIds]));
  const player: Player = { id, firstName: first, lastName: last, nickname: nick };
  return { ok: true, player, registry: [...registry, player] };
}

/** Rename a registry player. The id stays the same; an empty nickname becomes the first name. */
export function renamePlayer(
  registry: readonly Player[],
  id: string,
  firstName: string,
  lastName: string,
  nickname?: string,
): PlayerChange {
  const current = registry.find(p => p.id === id);
  if (!current) return { ok: false, error: 'Spieler nicht gefunden.' };
  const error = playerNameError(registry, firstName, lastName, id, nickname);
  if (error) return { ok: false, error };
  const first = normalizeWhitespace(firstName);
  const player: Player = {
    ...current,
    firstName: first,
    lastName: normalizeWhitespace(lastName),
    nickname: nicknameOrFirst(nickname, first),
  };
  return { ok: true, player, registry: registry.map(p => (p.id === id ? player : p)) };
}

/**
 * Disable or enable a registry player (see specs/players.md, "Disabled
 * players"). Enabled players carry no flag at all. Unknown ids change nothing.
 */
export function setPlayerDisabled(registry: readonly Player[], id: string, disabled: boolean): Player[] {
  return registry.map(p => {
    if (p.id !== id) return p;
    const { disabled: _old, ...rest } = p;
    return disabled ? { ...rest, disabled: true } : rest;
  });
}

/**
 * A gameshow's player ids resolved to registry players, in gameshow order.
 * Unknown ids are skipped (reported through `onUnknown`), repeats dropped.
 */
export function resolveGameshowPlayers(
  registry: readonly Player[] | undefined,
  ids: readonly unknown[] | undefined,
  onUnknown?: (id: string) => void,
): Player[] {
  const byId = playerById(Array.isArray(registry) ? registry : []);
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (p) {
      out.push({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        nickname: nicknameOrFirst(p.nickname, p.firstName),
        ...(p.disabled === true ? { disabled: true } : {}),
      });
    }
    else onUnknown?.(id);
  }
  return out;
}

/** The registry and every gameshow's `players`, checked against specs/players.md. */
export function validatePlayerRegistry(config: {
  players?: unknown;
  gameshows?: Record<string, { players?: unknown }> | unknown;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const names = new Map<string, string>();

  if (config.players !== undefined && !Array.isArray(config.players)) {
    errors.push('"players" must be an array of { id, firstName, lastName, nickname }');
  } else if (Array.isArray(config.players)) {
    config.players.forEach((entry: unknown, idx) => {
      const where = `players[${idx}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${where}: must be an object { id, firstName, lastName, nickname }`);
        return;
      }
      const p = entry as Record<string, unknown>;
      const id = typeof p.id === 'string' ? p.id : '';
      if (!PLAYER_ID_PATTERN.test(id)) {
        errors.push(`${where}: "id" must be a lowercase slug like "anna-mueller" (got ${JSON.stringify(p.id)})`);
      } else if (ids.has(id)) {
        errors.push(`${where}: duplicate id "${id}"`);
      } else {
        ids.add(id);
      }
      const label = id || where;
      // First name and surname may be empty (a player added during the show);
      // the nickname may not.
      for (const field of ['firstName', 'lastName', 'nickname'] as const) {
        const value = p[field];
        if (typeof value !== 'string' || (field === 'nickname' && !value.trim())) {
          errors.push(`Player "${label}": "${field}" must be a ${field === 'nickname' ? 'non-empty ' : ''}string`);
        } else if (value !== normalizeWhitespace(value)) {
          warnings.push(`Player "${label}": "${field}" has extra whitespace`);
        }
      }
      if (p.disabled !== undefined && typeof p.disabled !== 'boolean') {
        errors.push(`Player "${label}": "disabled" must be true or false`);
      }
      if (typeof p.firstName === 'string' && typeof p.lastName === 'string' && typeof p.nickname === 'string' && p.nickname.trim()) {
        const named = { firstName: p.firstName, lastName: p.lastName, nickname: p.nickname };
        const key = nameKey(named);
        const other = names.get(key);
        if (other !== undefined) {
          errors.push(
            hasFullName(named)
              ? `Player "${label}": same name as "${other}" (${fullName(named)}) — every player must be unique`
              : `Player "${label}": same nickname as "${other}" (${fullName(named)}) and no first name or surname — every player must be unique`,
          );
        } else {
          names.set(key, label);
        }
      }
    });
  }

  const gameshows = config.gameshows && typeof config.gameshows === 'object'
    ? (config.gameshows as Record<string, { players?: unknown }>)
    : {};
  for (const [showKey, show] of Object.entries(gameshows)) {
    if (!show || typeof show !== 'object' || show.players === undefined) continue;
    if (!Array.isArray(show.players)) {
      errors.push(`Gameshow "${showKey}": "players" must be an array of player ids`);
      continue;
    }
    const seen = new Set<string>();
    show.players.forEach((id: unknown, idx) => {
      if (typeof id !== 'string') {
        errors.push(`Gameshow "${showKey}" players[${idx}]: must be a player id string`);
      } else if (!ids.has(id)) {
        errors.push(
          PLAYER_ID_PATTERN.test(id)
            ? `Gameshow "${showKey}" players[${idx}]: unknown player id "${id}"`
            : `Gameshow "${showKey}" players[${idx}]: "${id}" is not a player id — migrate the old names with: npx tsx scripts/migrate-players.ts <mapping.json>`,
        );
      } else if (seen.has(id)) {
        errors.push(`Gameshow "${showKey}" players[${idx}]: "${id}" is listed twice`);
      }
      if (typeof id === 'string') seen.add(id);
    });
  }
  return { errors, warnings };
}

/**
 * The registry without the players among `removedIds` who are now in no
 * gameshow — a player taken out of their last gameshow leaves the Spieler
 * tab too. Players who were never in a gameshow (just created) are not
 * touched: only a removal prunes. Returns `registry` itself when nothing goes.
 * See specs/players.md.
 */
export function dropOrphanedPlayers(
  registry: readonly Player[],
  gameshows: Record<string, { players?: readonly string[] }>,
  removedIds: Iterable<string>,
): readonly Player[] {
  const inUse = new Set(Object.values(gameshows).flatMap(gs => gs.players ?? []));
  const orphans = new Set([...removedIds].filter(id => !inUse.has(id)));
  if (orphans.size === 0 || !registry.some(p => orphans.has(p.id))) return registry;
  return registry.filter(p => !orphans.has(p.id));
}

/** The config fields `applyLivePlayers` reads and changes. */
interface LivePlayersConfig {
  players?: Player[];
  activeGameshow: string;
  gameshows: Record<string, { players?: string[] }>;
}

export type LivePlayersResult =
  | { ok: true; changed: boolean; players: Player[] }
  | { ok: false; error: string };

/**
 * Write the show's adds and removes into the config (mutates `config`): an
 * add by id is appended to the active gameshow; an add by name reuses the
 * registry player with that identity or creates one (nickname only when no
 * first name / surname is given) and appends them. A player found in the
 * player `bin` instead (by id, or by identity) is restored to the registry
 * as they were; a removed id leaves the
 * gameshow — and the registry too when that was their last gameshow. Ids
 * already listed are not added twice. `players` are the added players as
 * stored, in request order.
 * See specs/players.md ("Sync to the gameshow").
 */
export function applyLivePlayers(
  config: LivePlayersConfig,
  request: LivePlayersRequest,
  bin: readonly Player[] = [],
): LivePlayersResult {
  const show = config.gameshows[config.activeGameshow];
  if (!show) return { ok: false, error: 'Keine aktive Gameshow.' };
  let registry = config.players ?? [];
  let ids = show.players ?? [];
  const added: Player[] = [];
  let changed = false;

  for (const entry of request.add ?? []) {
    let player: Player | undefined;
    if ('id' in entry) {
      player = registry.find(p => p.id === entry.id);
      if (!player) {
        // Deleted earlier: back from the bin.
        player = bin.find(p => p.id === entry.id);
        if (!player) return { ok: false, error: `Unbekannter Spieler "${entry.id}".` };
        registry = [...registry, player];
        changed = true;
      }
    } else {
      const first = normalizeWhitespace(entry.firstName ?? '');
      const last = normalizeWhitespace(entry.lastName ?? '');
      player = findNameConflict(registry, first, last, undefined, entry.nickname);
      const binned = player ? undefined : findInBin(bin, first, last, normalizeWhitespace(entry.nickname) || first);
      if (binned) {
        player = binned;
        registry = [...registry, binned];
        changed = true;
      } else if (!player) {
        const created = createPlayer(registry, first, last, entry.nickname, bin.map(p => p.id));
        if (!created.ok) return { ok: false, error: created.error };
        registry = created.registry;
        player = created.player;
        changed = true;
      }
    }
    if (!ids.includes(player.id)) {
      ids = [...ids, player.id];
      changed = true;
    }
    added.push(player);
  }

  const remove = new Set(request.remove ?? []);
  if (ids.some(id => remove.has(id))) {
    ids = ids.filter(id => !remove.has(id));
    changed = true;
    const pruned = dropOrphanedPlayers(registry, { ...config.gameshows, [config.activeGameshow]: { players: ids } }, remove);
    if (pruned !== registry) registry = [...pruned];
  }

  if (changed) {
    config.players = registry;
    show.players = ids;
  }
  return { ok: true, changed, players: added };
}
