import { useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';
import { teamName } from '@/utils/teamNames';
import confetti from 'canvas-confetti';

export default function SummaryScreen() {
  const { state } = useGameContext();
  const navigate = useNavigate();
  const { team1Points, team2Points, team1, team2 } = state.teams;
  const { pointSystemEnabled } = state.settings;

  const capitalize = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

  // Back returns to the LAST game, opened at its end for review — the summary
  // is the end of the flow so there is no forward. See specs/app-navigation-flow.md
  // and specs/game-back-review.md.
  const lastIndex = (state.currentGame?.totalGames ?? 0) - 1;
  const handleBack = useCallback(() => {
    if (lastIndex >= 0) navigate(`/game?index=${lastIndex}`, { state: { resumeAtEnd: true } });
  }, [lastIndex, navigate]);

  // Broadcast screen info to gamemaster
  useGamemasterSync({
    gameTitle: 'Game Show',
    questionNumber: 0,
    totalQuestions: 0,
    answer: '',
    screenLabel: 'Zusammenfassung',
  });
  useGamemasterControlsSync([{ type: 'nav', id: 'nav', hideForward: true, hideBack: lastIndex < 0 }]);
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-back') handleBack();
  }, [handleBack]));

  // ArrowLeft steps back into the last game. No forward binding — the summary
  // is the end, so clicks / ArrowRight stay inert here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack]);

  const result = useMemo(() => {
    if (!pointSystemEnabled) {
      return { text: 'Das Spiel ist zu Ende!', subtitle: 'Vielen Dank fürs Spielen!', members: [] };
    }
    if (team1Points > team2Points) {
      return {
        text: `${teamName(state.teams, 1)} hat gewonnen!`,
        subtitle: '',
        members: team1.map(capitalize),
      };
    }
    if (team2Points > team1Points) {
      return {
        text: `${teamName(state.teams, 2)} hat gewonnen!`,
        subtitle: '',
        members: team2.map(capitalize),
      };
    }
    return { text: 'Es ist ein Unentschieden!', subtitle: '', members: [] };
  }, [pointSystemEnabled, team1Points, team2Points, team1, team2, state.teams]);

  const showConfetti = pointSystemEnabled && team1Points !== team2Points;

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
