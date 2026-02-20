import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { GlobalSettings, TeamState } from '@/types/game';
import { fetchSettings } from '@/services/api';

// ── State ──

interface AppState {
  settings: GlobalSettings;
  teams: TeamState;
  settingsLoaded: boolean;
}

const initialState: AppState = {
  settings: {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  },
  teams: {
    team1: JSON.parse(localStorage.getItem('team1') || '[]'),
    team2: JSON.parse(localStorage.getItem('team2') || '[]'),
    team1Points: parseInt(localStorage.getItem('team1Points') || '0', 10),
    team2Points: parseInt(localStorage.getItem('team2Points') || '0', 10),
  },
  settingsLoaded: false,
};

// ── Actions ──

type Action =
  | { type: 'SET_SETTINGS'; payload: GlobalSettings }
  | { type: 'SET_TEAMS'; payload: { team1: string[]; team2: string[] } }
  | { type: 'AWARD_POINTS'; payload: { team: 'team1' | 'team2'; points: number } }
  | { type: 'RESET_POINTS' }
  | { type: 'SET_TEAM_STATE'; payload: TeamState };

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
      const newPoints = state.teams[key] + action.payload.points;
      const teams = { ...state.teams, [key]: newPoints };
      localStorage.setItem(key, String(newPoints));
      return { ...state, teams };
    }
    case 'RESET_POINTS': {
      const teams = { ...state.teams, team1Points: 0, team2Points: 0 };
      localStorage.setItem('team1Points', '0');
      localStorage.setItem('team2Points', '0');
      return { ...state, teams };
    }
    case 'SET_TEAM_STATE': {
      const ts = action.payload;
      localStorage.setItem('team1', JSON.stringify(ts.team1));
      localStorage.setItem('team2', JSON.stringify(ts.team2));
      localStorage.setItem('team1Points', String(ts.team1Points));
      localStorage.setItem('team2Points', String(ts.team2Points));
      return { ...state, teams: ts };
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
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadSettingsAction = useCallback(async () => {
    try {
      const data = await fetchSettings();
      dispatch({
        type: 'SET_SETTINGS',
        payload: {
          pointSystemEnabled: data.pointSystemEnabled !== false,
          teamRandomizationEnabled: data.teamRandomizationEnabled !== false,
          globalRules: data.globalRules || [],
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
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    const team1: string[] = [];
    const team2: string[] = [];
    shuffled.forEach((name, i) => {
      if (i % 2 === 0) team1.push(name);
      else team2.push(name);
    });
    dispatch({ type: 'SET_TEAMS', payload: { team1, team2 } });
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
