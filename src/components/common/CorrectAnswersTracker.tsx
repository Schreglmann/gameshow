import { useCallback, useEffect, useState } from 'react';
import { useGameContext } from '@/context/GameContext';

const STORAGE_KEY = 'correctAnswersByGame';

interface TeamCounts {
  team1: number;
  team2: number;
}

type CountsMap = Record<string, TeamCounts>;

function readMap(): CountsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CountsMap) : {};
  } catch {
    return {};
  }
}

function readCounts(map: CountsMap, gameIndex: number): TeamCounts {
  const entry = map[String(gameIndex)];
  if (!entry) return { team1: 0, team2: 0 };
  return {
    team1: typeof entry.team1 === 'number' ? entry.team1 : 0,
    team2: typeof entry.team2 === 'number' ? entry.team2 : 0,
  };
}

interface CorrectAnswersTrackerProps {
  gameIndex: number;
}

export default function CorrectAnswersTracker({ gameIndex }: CorrectAnswersTrackerProps) {
  const { state } = useGameContext();
  const [counts, setCounts] = useState<TeamCounts>(() => readCounts(readMap(), gameIndex));

  useEffect(() => {
    setCounts(readCounts(readMap(), gameIndex));
  }, [gameIndex]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setCounts(readCounts(readMap(), gameIndex));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [gameIndex]);

  const update = useCallback(
    (team: 'team1' | 'team2', delta: number) => {
      setCounts(prev => {
        const next = { ...prev, [team]: Math.max(0, prev[team] + delta) };
        const map = readMap();
        map[String(gameIndex)] = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        return next;
      });
    },
    [gameIndex],
  );

  const renderTeam = (team: 'team1' | 'team2', label: string, members: string[]) => (
    <div className="gm-correct-team">
      <div className="gm-correct-label">{label}</div>
      {members.length > 0 && (
        <div className="gm-correct-members">{members.join(', ')}</div>
      )}
      <div className="gm-correct-row">
        <button
          className="gm-btn gm-correct-btn"
          onClick={() => update(team, -1)}
          aria-label={`${label} minus`}
          disabled={counts[team] === 0}
        >
          −
        </button>
        <div className="gm-correct-count">{counts[team]}</div>
        <button
          className="gm-btn gm-correct-btn"
          onClick={() => update(team, 1)}
          aria-label={`${label} plus`}
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className="gm-correct-panel">
      {renderTeam('team1', 'Team 1', state.teams.team1)}
      {renderTeam('team2', 'Team 2', state.teams.team2)}
    </div>
  );
}
