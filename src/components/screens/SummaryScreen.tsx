import { useEffect, useMemo } from 'react';
import { useGameContext } from '@/context/GameContext';
import confetti from 'canvas-confetti';

export default function SummaryScreen() {
  const { state } = useGameContext();
  const { team1Points, team2Points, team1, team2 } = state.teams;
  const { pointSystemEnabled } = state.settings;

  const capitalize = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

  const result = useMemo(() => {
    if (!pointSystemEnabled) {
      return { text: 'Das Spiel ist zu Ende!', subtitle: 'Vielen Dank fürs Spielen!', members: [] };
    }
    if (team1Points > team2Points) {
      return {
        text: 'Team 1 hat gewonnen!',
        subtitle: '',
        members: team1.map(capitalize),
      };
    }
    if (team2Points > team1Points) {
      return {
        text: 'Team 2 hat gewonnen!',
        subtitle: '',
        members: team2.map(capitalize),
      };
    }
    return { text: 'Es ist ein Unentschieden!', subtitle: '', members: [] };
  }, [pointSystemEnabled, team1Points, team2Points, team1, team2]);

  const showConfetti = team1Points !== team2Points || !pointSystemEnabled;

  useEffect(() => {
    if (!showConfetti) return;
    const end = Date.now() + 5_000;
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, [showConfetti]);

  return (
    <>
      <canvas
        className="confetti"
        style={{ display: showConfetti ? 'block' : 'none' }}
      />
      <div id="summaryScreen" className="winner-announcement">
        <h1>{result.text}</h1>
        {result.subtitle && <p>{result.subtitle}</p>}
        {result.members.map((name, i) => (
          <p key={i}>{name}</p>
        ))}
      </div>
    </>
  );
}
