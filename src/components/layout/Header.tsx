import { useEffect, useState } from 'react';
import { useGameContext } from '@/context/GameContext';
import TeamJokers from '@/components/common/TeamJokers';
import TeamHeaderName from '@/components/layout/TeamHeaderName';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder, type TeamKey } from '@/utils/teamOrder';
import { useScoreReveal } from '@/hooks/useScoreReveal';

interface HeaderProps {
  showGameNumber?: boolean;
}

export default function Header({ showGameNumber = true }: HeaderProps) {
  const { state } = useGameContext();
  const { pointSystemEnabled, enabledJokers, jokersInLastGame } = state.settings;
  const { currentGame } = state;
  const { team1Points, team2Points } = state.teams;

  const isLastGame =
    currentGame !== null && currentGame.currentIndex === currentGame.totalGames - 1;
  // Jokers are hidden in the last game unless explicitly allowed — don't let
  // them keep the team side-columns alive (empty glass cell) in that case.
  const hasJokers =
    (enabledJokers ?? []).length > 0 && !(isLastGame && jokersInLastGame !== true);
  const showTeamColumns = pointSystemEnabled || hasJokers;
  const showGameCounter = showGameNumber && currentGame !== null;

  // Animated score reveal + lead-change detection (purely presentational).
  const reveal = useScoreReveal(team1Points, team2Points);

  // "Führungswechsel!" banner on a genuine lead flip.
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (reveal.leadChangeKey === 0) return;
    if (!pointSystemEnabled) return;
    setBannerVisible(true);
    const id = window.setTimeout(() => setBannerVisible(false), 2800);
    return () => window.clearTimeout(id);
  }, [reveal.leadChangeKey, pointSystemEnabled]);

  // The team now in front (well-defined at a flip — both diffs are non-zero).
  // Computed at render so the banner can name the new leader.
  const leaderName =
    team1Points > team2Points ? teamName(state.teams, 1)
    : team2Points > team1Points ? teamName(state.teams, 2)
    : null;

  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const update = () => setIsScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  // Layout is keyed to POSITION (left/right); which team's data flows into each
  // cell comes from the order swap. The cell's mirror-image internal layout
  // (label/joker order, borders, tooltip side) follows its side, not the team.
  // See specs/team-order-mirror.md.
  const [leftKey, rightKey] = teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled);
  const renderTeamCell = (teamKey: TeamKey, side: 'left' | 'right') => {
    const n = teamKey === 'team1' ? 1 : 2;
    const revealPoints = teamKey === 'team1' ? reveal.team1 : reveal.team2;
    const rawPoints = teamKey === 'team1' ? team1Points : team2Points;
    const label = pointSystemEnabled ? (
      <span className="team-header-label">
        <TeamHeaderName name={teamName(state.teams, n)} />
        <span className="team-header-score">
          : <span>{revealPoints}</span>{' '}
          {rawPoints === 1 ? 'Punkt' : 'Punkte'}
        </span>
      </span>
    ) : null;
    const jokers = <TeamJokers team={teamKey} side={side} />;
    return (
      <div id={`${teamKey}PointsContainer`} className={`team-header-cell team-header-${side}`}>
        {side === 'left' ? <>{label}{jokers}</> : <>{jokers}{label}</>}
      </div>
    );
  };

  return (
    <header className={isScrolled ? 'is-scrolled' : undefined}>
      {bannerVisible && (
        <div className="fuehrungswechsel-banner" role="status" aria-live="polite">
          Führungswechsel!
          {leaderName && (
            <> <span className="fuehrungswechsel-leader">{leaderName}</span> führt</>
          )}
        </div>
      )}
      {showTeamColumns ? renderTeamCell(leftKey, 'left') : <div />}

      {showGameCounter ? (
        <div id="gameNumber">
          Spiel {currentGame.currentIndex + 1} von {currentGame.totalGames}
        </div>
      ) : (
        <div />
      )}

      {showTeamColumns ? renderTeamCell(rightKey, 'right') : <div />}
    </header>
  );
}
