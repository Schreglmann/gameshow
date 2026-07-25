import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { GlobalSettings, TeamState, CurrentGame, ScoreLogEntry } from '@/types/game';
import type { ContentChangedPayload } from '@/types/config';
import { COMEBACK_JOKER_ID } from '@/data/jokers';
import { fetchSettings } from '@/services/api';
import { onWsOpen, sendWs, useWsChannel } from '@/services/useBackendSocket';
import { isInactiveShowTab, onBecameActive, onReemitRequest } from '@/services/showPresenceState';

type JokerTeam = 'team1' | 'team2';

function readJokerArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Read an optional team name from localStorage; blank → undefined. */
function readTeamName(key: string): string | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw && raw.trim() ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Persist an optional team name; blank/undefined removes the key. */
function writeTeamName(key: string, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) localStorage.setItem(key, normalized);
  else localStorage.removeItem(key);
}

// ── Current-game cross-tab sync ──
// `currentGame` is set by GameScreen (show entry) when a game mounts. Other
// entries (gamemaster, admin) need to know which game is active so checks like
// "is this the last game?" (joker lockout) work the same way they do on the
// show. Persist it to localStorage and react to storage events to keep all
// open tabs in the same origin in sync.

const CURRENT_GAME_KEY = 'currentGame';

function readCurrentGame(): CurrentGame | null {
  try {
    const raw = localStorage.getItem(CURRENT_GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const ci = (parsed as { currentIndex?: unknown }).currentIndex;
    const tg = (parsed as { totalGames?: unknown }).totalGames;
    if (typeof ci !== 'number' || typeof tg !== 'number') return null;
    return { currentIndex: ci, totalGames: tg };
  } catch {
    return null;
  }
}

function writeCurrentGame(value: CurrentGame | null): void {
  try {
    if (value === null) localStorage.removeItem(CURRENT_GAME_KEY);
    else localStorage.setItem(CURRENT_GAME_KEY, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ── Correct answers map ──

const CORRECT_ANSWERS_KEY = 'correctAnswersByGame';

export type CorrectAnswersMap = Record<string, { team1: number; team2: number }>;

function readCorrectAnswersMap(): CorrectAnswersMap {
  try {
    const raw = localStorage.getItem(CORRECT_ANSWERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: CorrectAnswersMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const entry = v as { team1?: unknown; team2?: unknown };
        out[k] = {
          team1: typeof entry.team1 === 'number' ? entry.team1 : 0,
          team2: typeof entry.team2 === 'number' ? entry.team2 : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeCorrectAnswersMap(map: CorrectAnswersMap): void {
  localStorage.setItem(CORRECT_ANSWERS_KEY, JSON.stringify(map));
}

// ── Score history (audit log for scoring-undo) ──
// Every team-points mutation funnels through applyPointDelta, which appends an
// entry here so the gamemaster can undo a mis-award. The list is capped (oldest
// dropped) to bound localStorage growth and rides the cached gamemaster-team-state
// channel as part of TeamState. See specs/gamemaster-cockpit.md.

const SCORE_HISTORY_KEY = 'scoreHistory';
const SCORE_HISTORY_CAP = 30;

let scoreEntryCounter = 0;
function makeScoreId(): string {
  scoreEntryCounter += 1;
  return `${Date.now()}-${scoreEntryCounter}`;
}

function isValidScoreEntry(v: unknown): v is ScoreLogEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    (e.team === 'team1' || e.team === 'team2') &&
    typeof e.delta === 'number' &&
    typeof e.pointsAfter === 'number' &&
    typeof e.ts === 'number'
  );
}

/** Coerce arbitrary input (localStorage / WS payload) to a valid, capped list. */
function normalizeScoreHistory(value: unknown): ScoreLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidScoreEntry).slice(-SCORE_HISTORY_CAP);
}

function readScoreHistory(): ScoreLogEntry[] {
  try {
    const raw = localStorage.getItem(SCORE_HISTORY_KEY);
    if (!raw) return [];
    return normalizeScoreHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeScoreHistory(history: ScoreLogEntry[]): void {
  try {
    localStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* ignore */
  }
}

// ── Comeback-joker armed multiplier ──
// `doubleNextGame` is the team whose next awarded game doubles its points (the
// Aufholjoker). Transient pending state — persisted so it survives a reload and
// rides the cached gamemaster-team-state channel. See specs/comeback-joker.md.

const DOUBLE_NEXT_GAME_KEY = 'doubleNextGame';

function normalizeDoubleNextGame(value: unknown): JokerTeam | null {
  return value === 'team1' || value === 'team2' ? value : null;
}

function readDoubleNextGame(): JokerTeam | null {
  try {
    return normalizeDoubleNextGame(localStorage.getItem(DOUBLE_NEXT_GAME_KEY));
  } catch {
    return null;
  }
}

function writeDoubleNextGame(value: JokerTeam | null): void {
  try {
    if (value === null) localStorage.removeItem(DOUBLE_NEXT_GAME_KEY);
    else localStorage.setItem(DOUBLE_NEXT_GAME_KEY, value);
  } catch {
    /* ignore */
  }
}

// ── Team-state revision (stale-write guard) ──
// A Lamport clock on TeamState. Every local mutation bumps it past the highest
// rev this client has seen, and the server only relays a team-state write whose
// rev beats the cached one (server/ws.ts `decideTeamStateWrite`). That is what
// stops a client holding an older snapshot — a reconnecting show re-seeding, a
// background tab taking over, a stale cache replay — from clobbering newer
// points. Persisted so it survives a reload, and deliberately NEVER reset: a
// RESET_POINTS whose rev restarted at 0 would be rejected and the old score
// would come back. See specs/cross-device-gamemaster.md.

const TEAM_STATE_REV_KEY = 'teamStateRev';

function readTeamStateRev(): number {
  try {
    const raw = parseInt(localStorage.getItem(TEAM_STATE_REV_KEY) || '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function writeTeamStateRev(rev: number): void {
  try {
    localStorage.setItem(TEAM_STATE_REV_KEY, String(rev));
  } catch {
    /* ignore */
  }
}

/**
 * The rev a state transition should carry.
 *
 * `remote` — we are mirroring a peer's snapshot: adopt its rev verbatim so the
 * clock advances without authoring a new version (re-broadcasting it would be
 * an echo, and on an equal-rev tie both peers would ping-pong forever).
 * Otherwise we are authoring a change and must outrank everything we have seen.
 */
export function nextTeamStateRev(
  localRev: number | undefined,
  incomingRev: number | undefined,
  remote: boolean,
): number {
  const highest = Math.max(localRev ?? 0, incomingRev ?? 0);
  return remote ? highest : highest + 1;
}

/**
 * Canonical serialization of the fields that ride the `gamemaster-team-state`
 * channel, used for the value-based echo guard in GameProvider.
 *
 * An ARRAY, not the raw object: `JSON.stringify(teams)` compares key ORDER too,
 * so the guard only held as long as the inbound normalizer listed every
 * optional field in exactly the order SET_TEAM_STATE reassembles them — an
 * invariant nothing enforced, and whose breach costs an echo per client per
 * update. Listing the fields positionally makes the comparison immune to key
 * order and to a field being added to TeamState in the wrong place.
 */
function serializeTeams(t: TeamState): string {
  return JSON.stringify([
    t.team1,
    t.team2,
    t.team1Name ?? null,
    t.team2Name ?? null,
    t.team1Points,
    t.team2Points,
    t.team1JokersUsed,
    t.team2JokersUsed,
    t.scoreHistory ?? [],
    t.doubleNextGame ?? null,
    t.orderSwapped === true,
    t.rev ?? 0,
  ]);
}

interface ScoreMeta {
  gameIndex?: number;
  gameTitle?: string;
  reason?: string;
}

/**
 * THE single funnel for every team-points delta. Computes the clamped new total,
 * persists it to localStorage, and (unless this is an undo) appends a trimmed
 * audit entry. Keeping ALL point writes here is exactly what makes the
 * gamemaster scoring-undo reliable — no game may write team points by any other
 * path. Returns the new TeamState. See specs/gamemaster-cockpit.md.
 */
function applyPointDelta(
  teams: TeamState,
  team: JokerTeam,
  delta: number,
  meta?: ScoreMeta,
  isUndo = false,
): TeamState {
  const key = team === 'team1' ? 'team1Points' : 'team2Points';
  const newPoints = Math.max(0, teams[key] + delta);
  const actualDelta = newPoints - teams[key];
  localStorage.setItem(key, String(newPoints));

  let scoreHistory = teams.scoreHistory ?? [];
  if (!isUndo && actualDelta !== 0) {
    const entry: ScoreLogEntry = {
      id: makeScoreId(),
      team,
      delta: actualDelta,
      pointsAfter: newPoints,
      ts: Date.now(),
      ...(meta?.gameIndex !== undefined ? { gameIndex: meta.gameIndex } : {}),
      ...(meta?.gameTitle ? { gameTitle: meta.gameTitle } : {}),
      ...(meta?.reason ? { reason: meta.reason } : {}),
    };
    scoreHistory = [...scoreHistory, entry].slice(-SCORE_HISTORY_CAP);
    writeScoreHistory(scoreHistory);
  }

  return { ...teams, [key]: newPoints, scoreHistory };
}

// ── Cold-start authority ──
// Captured once on first call (effectively page load). When the show tab
// booted with no team-state in localStorage, the first inbound on each
// of the cached WS channels is treated as a (possibly stale) server-cache
// replay and dropped if it carries data — otherwise a previous session's
// cached state, or a stale GM/admin tab re-broadcasting its in-memory
// copy on mount, would silently repopulate a deliberately-cleared show.

let coldStartFlagsCaptured = false;
let coldStartEmptyTeams = false;
let coldStartEmptyCorrect = false;

function captureColdStartFlags(): void {
  if (coldStartFlagsCaptured) return;
  coldStartFlagsCaptured = true;
  try {
    coldStartEmptyTeams =
      localStorage.getItem('team1') === null &&
      localStorage.getItem('team2') === null &&
      // Points must count too: a show run with team rosters disabled has no
      // team1/team2 keys at all, so without these it looked "cold" on EVERY
      // load and dropped the first inbound carrying the live score.
      localStorage.getItem('team1Points') === null &&
      localStorage.getItem('team2Points') === null &&
      localStorage.getItem(SCORE_HISTORY_KEY) === null &&
      localStorage.getItem(DOUBLE_NEXT_GAME_KEY) === null;
    coldStartEmptyCorrect = localStorage.getItem(CORRECT_ANSWERS_KEY) === null;
  } catch {
    /* no localStorage (SSR/test) — leave flags false */
  }
}

// ── State ──

interface AppState {
  settings: GlobalSettings;
  teams: TeamState;
  settingsLoaded: boolean;
  currentGame: CurrentGame | null;
  correctAnswersByGame: CorrectAnswersMap;
}

function getInitialState(): AppState {
  captureColdStartFlags();
  return {
    settings: {
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: [],
      isCleanInstall: false,
      enabledJokers: [],
      jokerRules: [],
      jokersInLastGame: false,
      jokerUsageScope: 'per-gameshow',
      players: [],
    },
    teams: {
      team1: JSON.parse(localStorage.getItem('team1') || '[]'),
      team2: JSON.parse(localStorage.getItem('team2') || '[]'),
      team1Name: readTeamName('team1Name'),
      team2Name: readTeamName('team2Name'),
      team1Points: parseInt(localStorage.getItem('team1Points') || '0', 10),
      team2Points: parseInt(localStorage.getItem('team2Points') || '0', 10),
      team1JokersUsed: readJokerArray('team1JokersUsed'),
      team2JokersUsed: readJokerArray('team2JokersUsed'),
      scoreHistory: readScoreHistory(),
      doubleNextGame: readDoubleNextGame(),
      orderSwapped: localStorage.getItem('teamOrderSwapped') === 'true',
      rev: readTeamStateRev(),
    },
    settingsLoaded: false,
    currentGame: readCurrentGame(),
    correctAnswersByGame: readCorrectAnswersMap(),
  };
}

// ── Actions ──

type Action =
  | { type: 'SET_SETTINGS'; payload: GlobalSettings }
  | { type: 'SET_TEAMS'; payload: { team1: string[]; team2: string[] } }
  | { type: 'SET_TEAM_NAMES'; payload: { team1Name?: string; team2Name?: string } }
  | { type: 'SET_TEAM_ORDER'; payload: { swapped: boolean } }
  | { type: 'AWARD_POINTS'; payload: { team: 'team1' | 'team2'; points: number } }
  | { type: 'UNDO_LAST_SCORE' }
  | { type: 'UNDO_SCORE_ENTRY'; payload: { id: string } }
  | { type: 'ARM_DOUBLE_NEXT_GAME'; payload: { team: JokerTeam } }
  | { type: 'CLEAR_DOUBLE_NEXT_GAME' }
  | { type: 'RESET_POINTS' }
  // `remote: true` marks a snapshot mirrored from a peer over WS — it adopts the
  // payload's rev instead of authoring a new one. Local callers (admin Session
  // tab, tests) omit it and get a fresh rev that outranks what they have seen.
  | { type: 'SET_TEAM_STATE'; payload: TeamState; remote?: boolean }
  | { type: 'SET_CURRENT_GAME'; payload: CurrentGame | null }
  | { type: 'USE_JOKER'; payload: { team: JokerTeam; jokerId: string } }
  | { type: 'SET_JOKER_USED'; payload: { team: JokerTeam; jokerId: string; used: boolean } }
  | { type: 'RESET_JOKERS' }
  | { type: 'SET_JOKERS_STATE'; payload: { team1JokersUsed: string[]; team2JokersUsed: string[] } }
  | { type: 'UPDATE_CORRECT_ANSWER'; payload: { gameIndex: number; team: 'team1' | 'team2'; delta: number } }
  | { type: 'SET_CORRECT_ANSWERS'; payload: CorrectAnswersMap }
  | { type: 'CLEAR_ALL' };

/**
 * Stamps a fresh `rev` on any action that actually changed `teams`, so no
 * mutating case can forget to (and a case added later gets it for free).
 * `SET_TEAM_STATE` is exempt — it decides its own rev, since mirroring a peer
 * must adopt rather than author. See nextTeamStateRev.
 */
function reducer(state: AppState, action: Action): AppState {
  const next = baseReducer(state, action);
  if (next.teams === state.teams || action.type === 'SET_TEAM_STATE') return next;
  const rev = nextTeamStateRev(state.teams.rev, undefined, false);
  writeTeamStateRev(rev);
  return { ...next, teams: { ...next.teams, rev } };
}

function baseReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload, settingsLoaded: true };
    case 'SET_TEAMS': {
      const teams = {
        ...state.teams,
        team1: action.payload.team1,
        team2: action.payload.team2,
      };
      localStorage.setItem('team1', JSON.stringify(teams.team1));
      localStorage.setItem('team2', JSON.stringify(teams.team2));
      return { ...state, teams };
    }
    case 'SET_TEAM_NAMES': {
      const team1Name = action.payload.team1Name?.trim() || undefined;
      const team2Name = action.payload.team2Name?.trim() || undefined;
      writeTeamName('team1Name', team1Name);
      writeTeamName('team2Name', team2Name);
      return { ...state, teams: { ...state.teams, team1Name, team2Name } };
    }
    case 'SET_TEAM_ORDER': {
      // Presentation-only flip of which team sits on the frontend's left; team
      // identities/points/jokers are untouched. The GM surfaces derive the
      // mirror from this same flag. See specs/team-order-mirror.md.
      const { swapped } = action.payload;
      localStorage.setItem('teamOrderSwapped', String(swapped));
      return { ...state, teams: { ...state.teams, orderSwapped: swapped } };
    }
    case 'AWARD_POINTS': {
      // Sole producer of point deltas — funnels through applyPointDelta so the
      // mutation is logged for scoring-undo. gameIndex is read from the active
      // game so the undo panel can label where the points came from.
      const teams = applyPointDelta(state.teams, action.payload.team, action.payload.points, {
        gameIndex: state.currentGame?.currentIndex,
      });
      return { ...state, teams };
    }
    case 'UNDO_LAST_SCORE': {
      const history = state.teams.scoreHistory ?? [];
      const entry = history[history.length - 1];
      if (!entry) return state;
      const teams = applyPointDelta(state.teams, entry.team, -entry.delta, undefined, true);
      const scoreHistory = history.slice(0, -1);
      writeScoreHistory(scoreHistory);
      return { ...state, teams: { ...teams, scoreHistory } };
    }
    case 'UNDO_SCORE_ENTRY': {
      const history = state.teams.scoreHistory ?? [];
      const entry = history.find(e => e.id === action.payload.id);
      if (!entry) return state;
      const teams = applyPointDelta(state.teams, entry.team, -entry.delta, undefined, true);
      const scoreHistory = history.filter(e => e.id !== action.payload.id);
      writeScoreHistory(scoreHistory);
      return { ...state, teams: { ...teams, scoreHistory } };
    }
    case 'ARM_DOUBLE_NEXT_GAME': {
      const { team } = action.payload;
      if (state.teams.doubleNextGame === team) return state;
      writeDoubleNextGame(team);
      return { ...state, teams: { ...state.teams, doubleNextGame: team } };
    }
    case 'CLEAR_DOUBLE_NEXT_GAME': {
      if (!state.teams.doubleNextGame) return state;
      writeDoubleNextGame(null);
      return { ...state, teams: { ...state.teams, doubleNextGame: null } };
    }
    case 'RESET_POINTS': {
      const teams = {
        ...state.teams,
        team1Name: undefined,
        team2Name: undefined,
        team1Points: 0,
        team2Points: 0,
        team1JokersUsed: [],
        team2JokersUsed: [],
        scoreHistory: [],
        doubleNextGame: null,
      };
      localStorage.setItem('team1Points', '0');
      localStorage.setItem('team2Points', '0');
      localStorage.removeItem('team1Name');
      localStorage.removeItem('team2Name');
      localStorage.removeItem('correctAnswersByGame');
      localStorage.removeItem('team1JokersUsed');
      localStorage.removeItem('team2JokersUsed');
      localStorage.removeItem(SCORE_HISTORY_KEY);
      localStorage.removeItem(DOUBLE_NEXT_GAME_KEY);
      return { ...state, teams, correctAnswersByGame: {} };
    }
    case 'SET_TEAM_STATE': {
      const ts = action.payload;
      localStorage.setItem('team1', JSON.stringify(ts.team1));
      localStorage.setItem('team2', JSON.stringify(ts.team2));
      writeTeamName('team1Name', ts.team1Name);
      writeTeamName('team2Name', ts.team2Name);
      localStorage.setItem('team1Points', String(ts.team1Points));
      localStorage.setItem('team2Points', String(ts.team2Points));
      localStorage.setItem('team1JokersUsed', JSON.stringify(ts.team1JokersUsed));
      localStorage.setItem('team2JokersUsed', JSON.stringify(ts.team2JokersUsed));
      // Seating order survives a partial payload (SessionTab omits it) — only an
      // explicit boolean moves the furniture. The inbound WS path always supplies
      // it, so a remote `false` still clears a local swap.
      const orderSwapped = ts.orderSwapped ?? state.teams.orderSwapped ?? false;
      localStorage.setItem('teamOrderSwapped', String(orderSwapped));
      // Adopt an inbound rev when it is ahead of ours (that is how the Lamport
      // clock advances); otherwise bump, so a LOCAL edit built on top of what we
      // already know — the admin Session tab saving, say — still outranks the
      // value it is replacing. Never goes backwards.
      const rev = nextTeamStateRev(state.teams.rev, ts.rev, action.remote === true);
      writeTeamStateRev(rev);
      // Callers that omit the audit/multiplier fields (e.g. SessionTab) get them
      // filled from current state; the inbound WS path already supplies them.
      // (The team-state echo storm is prevented by the VALUE-based broadcast
      // guard in GameProvider — see lastSentTeamsJsonRef. It now compares a
      // canonical positional projection, `serializeTeams`, so this no longer has
      // to preserve each optional field's insertion position to hold.)
      const teams: TeamState = ts.scoreHistory !== undefined
        ? { ...ts, orderSwapped, rev }
        : { ...ts, orderSwapped, rev, scoreHistory: state.teams.scoreHistory ?? [], doubleNextGame: state.teams.doubleNextGame ?? null };
      writeScoreHistory(normalizeScoreHistory(teams.scoreHistory));
      writeDoubleNextGame(normalizeDoubleNextGame(teams.doubleNextGame));
      return { ...state, teams };
    }
    case 'SET_CURRENT_GAME': {
      const prev = state.currentGame;
      const next = action.payload;
      // Idempotence: avoid ping-pong with the cross-tab storage listener.
      // Storage events fire in other tabs even when the value is unchanged,
      // so without this guard the show ↔ GM tabs would re-dispatch forever.
      if (
        prev === next ||
        (prev !== null &&
          next !== null &&
          prev.currentIndex === next.currentIndex &&
          prev.totalGames === next.totalGames)
      ) {
        return state;
      }
      writeCurrentGame(next);

      // Per-game joker refresh: when the operator has chosen `per-game` scope,
      // every joker EXCEPT the Aufholjoker (comeback) becomes available again at
      // the start of each game. Gate strictly on the game INDEX changing — a
      // live gameOrder edit re-dispatches this action with a new `totalGames`
      // but the same index, which must NOT wipe mid-game joker usage. Comeback
      // (single-use per show) and the armed `doubleNextGame` multiplier are
      // preserved. The reset is deterministic, so cross-tab (storage listener)
      // and cross-device (WS team-state broadcast) copies converge.
      const indexChanged = (prev?.currentIndex ?? null) !== (next?.currentIndex ?? null);
      if (state.settings.jokerUsageScope === 'per-game' && indexChanged) {
        const stripNonComeback = (arr: string[]) => arr.filter(id => id === COMEBACK_JOKER_ID);
        const team1JokersUsed = stripNonComeback(state.teams.team1JokersUsed);
        const team2JokersUsed = stripNonComeback(state.teams.team2JokersUsed);
        const changed =
          team1JokersUsed.length !== state.teams.team1JokersUsed.length ||
          team2JokersUsed.length !== state.teams.team2JokersUsed.length;
        if (changed) {
          localStorage.setItem('team1JokersUsed', JSON.stringify(team1JokersUsed));
          localStorage.setItem('team2JokersUsed', JSON.stringify(team2JokersUsed));
          return {
            ...state,
            currentGame: next,
            teams: { ...state.teams, team1JokersUsed, team2JokersUsed },
          };
        }
      }

      return { ...state, currentGame: next };
    }
    case 'USE_JOKER': {
      const { team, jokerId } = action.payload;
      const key = team === 'team1' ? 'team1JokersUsed' : 'team2JokersUsed';
      if (state.teams[key].includes(jokerId)) return state;
      const next = [...state.teams[key], jokerId];
      localStorage.setItem(key, JSON.stringify(next));
      return { ...state, teams: { ...state.teams, [key]: next } };
    }
    case 'SET_JOKER_USED': {
      const { team, jokerId, used } = action.payload;
      const key = team === 'team1' ? 'team1JokersUsed' : 'team2JokersUsed';
      const current = state.teams[key];
      const already = current.includes(jokerId);
      if (used === already) return state;
      const next = used ? [...current, jokerId] : current.filter(id => id !== jokerId);
      localStorage.setItem(key, JSON.stringify(next));
      return { ...state, teams: { ...state.teams, [key]: next } };
    }
    case 'RESET_JOKERS': {
      localStorage.removeItem('team1JokersUsed');
      localStorage.removeItem('team2JokersUsed');
      localStorage.removeItem(DOUBLE_NEXT_GAME_KEY);
      return {
        ...state,
        teams: { ...state.teams, team1JokersUsed: [], team2JokersUsed: [], doubleNextGame: null },
      };
    }
    case 'SET_JOKERS_STATE': {
      return {
        ...state,
        teams: {
          ...state.teams,
          team1JokersUsed: action.payload.team1JokersUsed,
          team2JokersUsed: action.payload.team2JokersUsed,
        },
      };
    }
    case 'UPDATE_CORRECT_ANSWER': {
      const { gameIndex, team, delta } = action.payload;
      const key = String(gameIndex);
      const current = state.correctAnswersByGame[key] ?? { team1: 0, team2: 0 };
      const nextCount = Math.max(0, current[team] + delta);
      if (nextCount === current[team]) return state;
      const nextEntry = { ...current, [team]: nextCount };
      const nextMap = { ...state.correctAnswersByGame, [key]: nextEntry };
      writeCorrectAnswersMap(nextMap);
      return { ...state, correctAnswersByGame: nextMap };
    }
    case 'SET_CORRECT_ANSWERS': {
      writeCorrectAnswersMap(action.payload);
      return { ...state, correctAnswersByGame: action.payload };
    }
    case 'CLEAR_ALL': {
      localStorage.clear();
      return {
        ...state,
        teams: {
          team1: [],
          team2: [],
          team1Name: undefined,
          team2Name: undefined,
          team1Points: 0,
          team2Points: 0,
          team1JokersUsed: [],
          team2JokersUsed: [],
          scoreHistory: [],
          doubleNextGame: null,
          orderSwapped: false,
        },
        correctAnswersByGame: {},
      };
    }
    default:
      return state;
  }
}

// ── Context ──

interface GameContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  loadSettings: () => Promise<void>;
  awardPoints: (team: 'team1' | 'team2', points: number) => void;
  assignTeams: (names: string[]) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

function isShowTab(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/show');
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);

  // Echo-loop guards. We dedup team-state broadcasts BY VALUE (serialized
  // last-sent/received payload) rather than by object reference: a reference
  // guard breaks the instant any reducer returns a fresh object, and a single
  // stale/cached peer that re-wraps can then perpetuate an infinite echo storm
  // (saturating the socket → 30s lag + awards clobbered to 0). With a value
  // guard, an inbound update we apply produces the same serialized teams →
  // the broadcast effect skips it, so received state is never echoed back.
  const lastSentTeamsJsonRef = useRef<string | null>(null);
  const lastRemoteCorrectAnswersRef = useRef<CorrectAnswersMap | null>(null);
  // A team-state broadcast that sendWs dropped (socket not OPEN), retried on
  // the next connection open.
  const pendingTeamsRef = useRef<TeamState | null>(null);

  // One-shot cold-start gate (show tabs only). Flips false on the first
  // inbound message on each respective channel; while true, an inbound
  // carrying data is dropped and our (empty) state is re-asserted back to
  // the server cache. See captureColdStartFlags above for the why.
  const teamsColdGateRef = useRef(isShowTab() && coldStartEmptyTeams);
  const correctColdGateRef = useRef(isShowTab() && coldStartEmptyCorrect);

  const loadSettingsAction = useCallback(async () => {
    try {
      const data = await fetchSettings();
      dispatch({
        type: 'SET_SETTINGS',
        payload: {
          pointSystemEnabled: data.pointSystemEnabled !== false,
          teamRandomizationEnabled: data.teamRandomizationEnabled !== false,
          teamMirrorEnabled: data.teamMirrorEnabled === true,
          globalRules: data.globalRules || [],
          isCleanInstall: data.isCleanInstall === true,
          enabledJokers: data.enabledJokers || [],
          jokerRules: data.jokerRules || [],
          jokersInLastGame: data.jokersInLastGame === true,
          jokerUsageScope: data.jokerUsageScope === 'per-game' ? 'per-game' : 'per-gameshow',
          players: data.players || [],
        },
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  const awardPoints = useCallback(
    (team: 'team1' | 'team2', points: number) => {
      dispatch({ type: 'AWARD_POINTS', payload: { team, points } });
    },
    []
  );

  const assignTeams = useCallback((names: string[]) => {
    // Capitalize EVERY word (e.g. "john smith" → "John Smith"), not just the
    // first — multi-word names must have each part upper-cased.
    const capitalizeWords = (n: string) =>
      n.split(/\s+/).map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
    const normalized = names.map(capitalizeWords);
    const shuffled = [...normalized].sort(() => Math.random() - 0.5);
    const team1: string[] = [];
    const team2: string[] = [];
    shuffled.forEach((name, i) => {
      if (i % 2 === 0) team1.push(name);
      else team2.push(name);
    });
    dispatch({ type: 'SET_TEAMS', payload: { team1, team2 } });
  }, []);

  // Broadcast team state on local mutations. Skip when the serialized value is
  // unchanged from what we last sent OR just received (value-based echo guard,
  // see lastSentTeamsJsonRef above), or when this is an inactive show tab.
  useEffect(() => {
    if (isInactiveShowTab()) return;
    const json = serializeTeams(state.teams);
    if (json === lastSentTeamsJsonRef.current) return;
    // Record only what actually went out: sendWs is a no-op while the socket is
    // reconnecting, and marking a dropped payload as "sent" left the peers on
    // the old value until something else changed. Re-sent on the next open.
    if (!sendWs('gamemaster-team-state', state.teams)) {
      pendingTeamsRef.current = state.teams;
      return;
    }
    pendingTeamsRef.current = null;
    lastSentTeamsJsonRef.current = json;
  }, [state.teams]);

  // Flush a broadcast that was dropped because the socket was down. Safe for
  // every zone (not just the show): the rev guard means this can only ever
  // land if nothing newer has been published in the meantime.
  useEffect(() => onWsOpen(() => {
    const pending = pendingTeamsRef.current;
    if (!pending || isInactiveShowTab()) return;
    if (sendWs('gamemaster-team-state', pending)) {
      pendingTeamsRef.current = null;
      lastSentTeamsJsonRef.current = serializeTeams(pending);
    }
  }), []);

  // Broadcast correct-answers map on local mutations. Same guards.
  useEffect(() => {
    if (isInactiveShowTab()) return;
    if (state.correctAnswersByGame === lastRemoteCorrectAnswersRef.current) return;
    sendWs('gamemaster-correct-answers', state.correctAnswersByGame);
  }, [state.correctAnswersByGame]);

  // Apply remote team-state updates.
  useWsChannel<TeamState | null>('gamemaster-team-state', (payload) => {
    if (!payload) return;
    const next: TeamState = {
      team1: Array.isArray(payload.team1) ? payload.team1 : [],
      team2: Array.isArray(payload.team2) ? payload.team2 : [],
      team1Name: typeof payload.team1Name === 'string' && payload.team1Name.trim() ? payload.team1Name : undefined,
      team2Name: typeof payload.team2Name === 'string' && payload.team2Name.trim() ? payload.team2Name : undefined,
      team1Points: typeof payload.team1Points === 'number' ? payload.team1Points : 0,
      team2Points: typeof payload.team2Points === 'number' ? payload.team2Points : 0,
      team1JokersUsed: Array.isArray(payload.team1JokersUsed) ? payload.team1JokersUsed : [],
      team2JokersUsed: Array.isArray(payload.team2JokersUsed) ? payload.team2JokersUsed : [],
      scoreHistory: normalizeScoreHistory(payload.scoreHistory),
      doubleNextGame: normalizeDoubleNextGame(payload.doubleNextGame),
      // Seating order rides this channel — it MUST be copied through. Dropping
      // it here left every device except the one that pressed "Teams tauschen"
      // with a stale flag, so the GM surfaces that compute their own order
      // (CorrectAnswersTracker, joker cards) stopped mirroring the show.
      // Always set it explicitly: `undefined` would be treated as "omitted" by
      // SET_TEAM_STATE and resurrect the local value instead of clearing it.
      orderSwapped: payload.orderSwapped === true,
      rev: typeof payload.rev === 'number' ? payload.rev : 0,
    };
    // Stale-write guard: a peer that has fallen behind — a show re-seeding on
    // reconnect, a background tab taking over, a cache replay from an earlier
    // session — must not roll our score back. Re-assert ours so the sender
    // converges on the newer value instead of the two of us diverging.
    if ((next.rev ?? 0) < (state.teams.rev ?? 0)) {
      sendWs('gamemaster-team-state', state.teams);
      return;
    }
    if (teamsColdGateRef.current) {
      teamsColdGateRef.current = false;
      const hasData =
        next.team1.length > 0 ||
        next.team2.length > 0 ||
        !!next.team1Name ||
        !!next.team2Name ||
        next.team1Points > 0 ||
        next.team2Points > 0 ||
        next.team1JokersUsed.length > 0 ||
        next.team2JokersUsed.length > 0 ||
        (next.scoreHistory?.length ?? 0) > 0 ||
        !!next.doubleNextGame;
      if (hasData) {
        // Re-assert our (deliberately empty) state. Routed through the reducer
        // rather than a bare sendWs so it authors a rev ABOVE the snapshot we
        // just refused — otherwise the stale-write guard on the other side, or
        // the server's, would reject the wipe and the old state would return.
        dispatch({ type: 'SET_TEAM_STATE', payload: { ...state.teams, rev: next.rev } });
        return;
      }
    }
    // Record the value we're about to apply so the broadcast effect (which
    // fires on the resulting state change) recognises it as already-known and
    // does NOT echo it back. This is what breaks the cross-tab storm.
    lastSentTeamsJsonRef.current = serializeTeams(next);
    dispatch({ type: 'SET_TEAM_STATE', payload: next, remote: true });
  });

  // Apply remote correct-answers updates.
  useWsChannel<CorrectAnswersMap | null>('gamemaster-correct-answers', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const next: CorrectAnswersMap = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v && typeof v === 'object') {
        const entry = v as { team1?: unknown; team2?: unknown };
        next[k] = {
          team1: typeof entry.team1 === 'number' ? entry.team1 : 0,
          team2: typeof entry.team2 === 'number' ? entry.team2 : 0,
        };
      }
    }
    if (correctColdGateRef.current) {
      correctColdGateRef.current = false;
      if (Object.keys(next).length > 0) {
        sendWs('gamemaster-correct-answers', state.correctAnswersByGame);
        return;
      }
    }
    lastRemoteCorrectAnswersRef.current = next;
    dispatch({ type: 'SET_CORRECT_ANSWERS', payload: next });
  });

  // Live config reload: when config.json changes on disk, re-fetch settings so
  // point-system / global-rules / enabled-jokers / team-randomization changes
  // apply without a page reload. Pure read — no broadcast. See
  // specs/live-config-reload.md.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (payload?.config) loadSettingsAction();
  });

  // Re-seed server cache on reconnect. Only the show tab does this;
  // otherwise an iPad gamemaster reconnecting could overwrite the
  // laptop's live state with stale data.
  const latestTeamsRef = useRef(state.teams);
  latestTeamsRef.current = state.teams;
  const latestCorrectRef = useRef(state.correctAnswersByGame);
  latestCorrectRef.current = state.correctAnswersByGame;

  useEffect(() => {
    if (!isShowTab()) return;
    return onWsOpen(() => {
      if (isInactiveShowTab()) return;
      sendWs('gamemaster-team-state', latestTeamsRef.current);
      sendWs('gamemaster-correct-answers', latestCorrectRef.current);
    });
  }, []);

  // Re-emit team/correct state when this tab takes over as the active show
  // (claim or auto-promotion). Without this, the server cache keeps the
  // previous active tab's values until something mutates locally.
  useEffect(() => {
    if (!isShowTab()) return;
    return onBecameActive(() => {
      sendWs('gamemaster-team-state', latestTeamsRef.current);
      sendWs('gamemaster-correct-answers', latestCorrectRef.current);
    });
  }, []);

  // Re-emit when the server asks (new GM connected, cache empty).
  useEffect(() => {
    if (!isShowTab()) return;
    return onReemitRequest(() => {
      if (isInactiveShowTab()) return;
      sendWs('gamemaster-team-state', latestTeamsRef.current);
      sendWs('gamemaster-correct-answers', latestCorrectRef.current);
    });
  }, []);

  useEffect(() => {
    loadSettingsAction();
  }, [loadSettingsAction]);

  // Cross-tab sync of currentGame: when the show tab dispatches
  // SET_CURRENT_GAME and writes to localStorage, the storage event fires in
  // every other same-origin tab — pick it up so the gamemaster and admin
  // stay in sync (e.g. for the joker last-game lockout).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CURRENT_GAME_KEY) return;
      const next = readCurrentGame();
      dispatch({ type: 'SET_CURRENT_GAME', payload: next });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <GameContext.Provider
      value={{
        state,
        dispatch,
        loadSettings: loadSettingsAction,
        awardPoints,
        assignTeams,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
