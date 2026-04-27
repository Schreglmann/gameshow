import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { GlobalSettings, TeamState, CurrentGame } from '@/types/game';
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

// ── State ──

interface AppState {
  settings: GlobalSettings;
  teams: TeamState;
  settingsLoaded: boolean;
  currentGame: CurrentGame | null;
  correctAnswersByGame: CorrectAnswersMap;
}

function getInitialState(): AppState {
  return {
    settings: {
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      isCleanInstall: false,
      enabledJokers: [],
    },
    teams: {
      team1: JSON.parse(localStorage.getItem('team1') || '[]'),
      team2: JSON.parse(localStorage.getItem('team2') || '[]'),
      team1Points: parseInt(localStorage.getItem('team1Points') || '0', 10),
      team2Points: parseInt(localStorage.getItem('team2Points') || '0', 10),
      team1JokersUsed: readJokerArray('team1JokersUsed'),
      team2JokersUsed: readJokerArray('team2JokersUsed'),
    },
    settingsLoaded: false,
    currentGame: null,
    correctAnswersByGame: readCorrectAnswersMap(),
  };
}

// ── Actions ──

type Action =
  | { type: 'SET_SETTINGS'; payload: GlobalSettings }
  | { type: 'SET_TEAMS'; payload: { team1: string[]; team2: string[] } }
  | { type: 'AWARD_POINTS'; payload: { team: 'team1' | 'team2'; points: number } }
  | { type: 'RESET_POINTS' }
  | { type: 'SET_TEAM_STATE'; payload: TeamState }
  | { type: 'SET_CURRENT_GAME'; payload: CurrentGame | null }
  | { type: 'USE_JOKER'; payload: { team: JokerTeam; jokerId: string } }
  | { type: 'SET_JOKER_USED'; payload: { team: JokerTeam; jokerId: string; used: boolean } }
  | { type: 'RESET_JOKERS' }
  | { type: 'SET_JOKERS_STATE'; payload: { team1JokersUsed: string[]; team2JokersUsed: string[] } }
  | { type: 'UPDATE_CORRECT_ANSWER'; payload: { gameIndex: number; team: 'team1' | 'team2'; delta: number } }
  | { type: 'SET_CORRECT_ANSWERS'; payload: CorrectAnswersMap };

function reducer(state: AppState, action: Action): AppState {
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
    case 'AWARD_POINTS': {
      const key =
        action.payload.team === 'team1' ? 'team1Points' : 'team2Points';
      const newPoints = Math.max(0, state.teams[key] + action.payload.points);
      const teams = { ...state.teams, [key]: newPoints };
      localStorage.setItem(key, String(newPoints));
      return { ...state, teams };
    }
    case 'RESET_POINTS': {
      const teams = {
        ...state.teams,
        team1Points: 0,
        team2Points: 0,
        team1JokersUsed: [],
        team2JokersUsed: [],
      };
      localStorage.setItem('team1Points', '0');
      localStorage.setItem('team2Points', '0');
      localStorage.removeItem('correctAnswersByGame');
      localStorage.removeItem('team1JokersUsed');
      localStorage.removeItem('team2JokersUsed');
      return { ...state, teams, correctAnswersByGame: {} };
    }
    case 'SET_TEAM_STATE': {
      const ts = action.payload;
      localStorage.setItem('team1', JSON.stringify(ts.team1));
      localStorage.setItem('team2', JSON.stringify(ts.team2));
      localStorage.setItem('team1Points', String(ts.team1Points));
      localStorage.setItem('team2Points', String(ts.team2Points));
      localStorage.setItem('team1JokersUsed', JSON.stringify(ts.team1JokersUsed));
      localStorage.setItem('team2JokersUsed', JSON.stringify(ts.team2JokersUsed));
      return { ...state, teams: ts };
    }
    case 'SET_CURRENT_GAME':
      return { ...state, currentGame: action.payload };
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
      return {
        ...state,
        teams: { ...state.teams, team1JokersUsed: [], team2JokersUsed: [] },
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

  // Echo-loop guards: when a WS payload is applied via the reducer, the
  // reducer still produces a new state reference. We capture that reference
  // on arrival and skip re-broadcast when the current state is that same
  // remote-sourced reference.
  const lastRemoteTeamsRef = useRef<TeamState | null>(null);
  const lastRemoteCorrectAnswersRef = useRef<CorrectAnswersMap | null>(null);


  const loadSettingsAction = useCallback(async () => {
    try {
      const data = await fetchSettings();
      dispatch({
        type: 'SET_SETTINGS',
        payload: {
          pointSystemEnabled: data.pointSystemEnabled !== false,
          teamRandomizationEnabled: data.teamRandomizationEnabled !== false,
          globalRules: data.globalRules || [],
          isCleanInstall: data.isCleanInstall === true,
          enabledJokers: data.enabledJokers || [],
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
    const normalized = names.map(n => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase());
    const shuffled = [...normalized].sort(() => Math.random() - 0.5);
    const team1: string[] = [];
    const team2: string[] = [];
    shuffled.forEach((name, i) => {
      if (i % 2 === 0) team1.push(name);
      else team2.push(name);
    });
    dispatch({ type: 'SET_TEAMS', payload: { team1, team2 } });
  }, []);

  // Broadcast team state on local mutations. Skip broadcast when the
  // current state is the remote-sourced reference (echo-loop guard), or
  // when this is an inactive show tab.
  useEffect(() => {
    if (isInactiveShowTab()) return;
    if (state.teams === lastRemoteTeamsRef.current) return;
    sendWs('gamemaster-team-state', state.teams);
  }, [state.teams]);

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
      team1Points: typeof payload.team1Points === 'number' ? payload.team1Points : 0,
      team2Points: typeof payload.team2Points === 'number' ? payload.team2Points : 0,
      team1JokersUsed: Array.isArray(payload.team1JokersUsed) ? payload.team1JokersUsed : [],
      team2JokersUsed: Array.isArray(payload.team2JokersUsed) ? payload.team2JokersUsed : [],
    };
    lastRemoteTeamsRef.current = next;
    dispatch({ type: 'SET_TEAM_STATE', payload: next });
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
    lastRemoteCorrectAnswersRef.current = next;
    dispatch({ type: 'SET_CORRECT_ANSWERS', payload: next });
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
