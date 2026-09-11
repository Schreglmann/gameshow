import { useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';
import { teamName, joinTeamNames } from '@/utils/teamNames';
import { leadingTeams, teamKeys, teamPoints, teamRoster } from '@/utils/teams';
import TeamDot from '@/components/common/TeamDot';
import confetti from 'canvas-confetti';

/** Highest stagger step; later names all share it so the list finishes quickly. */
const MAX_STAGGER_STEPS = 11;

/**
 * Columns the winning roster is laid out in — roughly a square block, so nine
 * names are three rows of three instead of nine stacked lines.
 *
 * One name per line was fine for the two- or three-person teams the screen was
 * built for, but a nine-player roster grew the fixed, viewport-centred card
 * past the screen on a 1080p projector: the heading was cut off at the top and
 * the last names ran off the bottom, with no way to scroll to them.
 */
function memberColumns(count: number): number {
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 12) return 3;
  return 4;
}

export default function SummaryScreen() {
  const { state } = useGameContext();
  const navigate = useNavigate();
  const { pointSystemEnabled, teamCount, showTitle } = state.settings;

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
    gameTitle: showTitle,
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

  const activeTeams = useMemo(() => teamKeys(teamCount), [teamCount]);
  // The team(s) on the top score. Everybody tied (including a solo team, which
  // trivially leads) is not a "win" — a single team just finishes with its score.
  const winners = useMemo(() => leadingTeams(state.teams, activeTeams), [state.teams, activeTeams]);
  const hasWinner = winners.length === 1 && activeTeams.length > 1;

  const result = useMemo(() => {
    if (!pointSystemEnabled || activeTeams.length === 0) {
      return { text: 'Das Spiel ist zu Ende!', subtitle: 'Vielen Dank fürs Spielen!', members: [] };
    }
    if (activeTeams.length === 1) {
      const solo = activeTeams[0]!;
      // A solo show has no team to name — the audience played the show itself, so
      // the closing line is just the score it reached. See specs/team-count.md.
      return {
        text: `${teamPoints(state.teams, solo)} Punkte`,
        subtitle: 'Vielen Dank fürs Spielen!',
        members: teamRoster(state.teams, solo).map(capitalize),
      };
    }
    if (hasWinner) {
      const winner = winners[0]!;
      return {
        text: `${teamName(state.teams, winner)} hat gewonnen!`,
        subtitle: '',
        members: teamRoster(state.teams, winner).map(capitalize),
        // Only the single-winner case names a team, so it is the only one that
        // can carry a colour dot. See specs/team-colors.md.
        team: winner,
      };
    }
    // Several teams share the top score. With more than two in play, naming them
    // is the only way the room knows who tied.
    const subtitle = winners.length > 0 && winners.length < activeTeams.length
      ? `${joinTeamNames(state.teams, winners)} liegen gleichauf`
      : '';
    return { text: 'Es ist ein Unentschieden!', subtitle, members: [] };
  }, [pointSystemEnabled, activeTeams, hasWinner, winners, state.teams]);

  const showConfetti = pointSystemEnabled && hasWinner;

  useEffect(() => {
    if (!showConfetti) return;
    const end = Date.now() + 5_000;
    // Tracked + cancelled on cleanup. Without this the rAF loop kept firing
    // after the screen unmounted — confetti sprayed over whatever came next —
    // and a re-run (back-navigation into the summary) stacked a second loop on
    // top of the first.
    let rafId = 0;
    let cancelled = false;
    const frame = () => {
      if (cancelled) return;
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 } });
      if (Date.now() < end) rafId = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      confetti.reset();
    };
  }, [showConfetti]);

  return (
    <>
      <canvas
        className="confetti"
        style={{ display: showConfetti ? 'block' : 'none' }}
      />
      <div id="summaryScreen" className="winner-announcement">
        <h1>{'team' in result && result.team && <TeamDot team={result.team} />}{result.text}</h1>
        {result.subtitle && <p>{result.subtitle}</p>}
        {result.members.length > 0 && (
          <ul className="winner-members" data-columns={memberColumns(result.members.length)}>
            {/* The stagger is per index rather than the fixed nth-child rules it
                replaces, which stopped at the fifth name and left every later
                one appearing first (delay 0). Capped so a big roster is fully
                on screen in about a second. */}
            {result.members.map((name, i) => (
              <li key={i} style={{ animationDelay: `${0.3 + Math.min(i, MAX_STAGGER_STEPS) * 0.08}s` }}>
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
