import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { GlobalSettings, TeamState, CurrentGame } from '@/types/game';
import { fetchSettings } from '@/services/api';

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

// ── State ──

interface AppState {
  settings: GlobalSettings;
  teams: TeamState;
  settingsLoaded: boolean;
  currentGame: CurrentGame | null;
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
  | { type: 'SET_JOKERS_STATE'; payload: { team1JokersUsed: string[]; team2JokersUsed: string[] } };

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
      return { ...state, teams };
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

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);

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

  // Sync state when another tab updates localStorage (e.g. admin changes points)
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (
        e.key === 'team1Points' ||
        e.key === 'team2Points' ||
        e.key === 'team1' ||
        e.key === 'team2'
      ) {
        dispatch({
          type: 'SET_TEAM_STATE',
          payload: {
            team1: JSON.parse(localStorage.getItem('team1') || '[]'),
            team2: JSON.parse(localStorage.getItem('team2') || '[]'),
            team1Points: parseInt(
              localStorage.getItem('team1Points') || '0',
              10
            ),
            team2Points: parseInt(
              localStorage.getItem('team2Points') || '0',
              10
            ),
            team1JokersUsed: readJokerArray('team1JokersUsed'),
            team2JokersUsed: readJokerArray('team2JokersUsed'),
          },
        });
      } else if (e.key === 'team1JokersUsed' || e.key === 'team2JokersUsed') {
        dispatch({
          type: 'SET_JOKERS_STATE',
          payload: {
            team1JokersUsed: readJokerArray('team1JokersUsed'),
            team2JokersUsed: readJokerArray('team2JokersUsed'),
          },
        });
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
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
