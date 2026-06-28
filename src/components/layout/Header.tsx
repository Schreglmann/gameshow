import { useEffect, useRef, useState } from 'react';
import { useGameContext } from '@/context/GameContext';
import TeamJokers from '@/components/common/TeamJokers';
import { teamName } from '@/utils/teamNames';
import { useScoreReveal } from '@/hooks/useScoreReveal';
import { playCoinTally, playLeadChangeSting } from '@/utils/revealSound';
import { isInactiveShowTab } from '@/services/showPresenceState';

interface HeaderProps {
  showGameNumber?: boolean;
}

function audioAllowed(): boolean {
  if (isInactiveShowTab()) return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
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

  // One coin "ping" PER POINT gained — a Mario-style tally (active show only,
  // not reduced-motion). Sum the positive deltas so a draw award that lifts both
  // teams still tallies every point.
  const prevTotalRef = useRef({ team1Points, team2Points });
  useEffect(() => {
    const prev = prevTotalRef.current;
    const gained = Math.max(0, team1Points - prev.team1Points) + Math.max(0, team2Points - prev.team2Points);
    prevTotalRef.current = { team1Points, team2Points };
    if (gained > 0 && pointSystemEnabled && audioAllowed()) playCoinTally(gained);
  }, [team1Points, team2Points, pointSystemEnabled]);

  // "Führungswechsel!" banner + sting on a genuine lead flip.
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (reveal.leadChangeKey === 0) return;
    if (!pointSystemEnabled) return;
    setBannerVisible(true);
    if (audioAllowed()) playLeadChangeSting();
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
      {showTeamColumns ? (
        <div id="team1PointsContainer" className="team-header-cell team-header-team1">
          {pointSystemEnabled && (
            <span className="team-header-label">
              <span className="team-header-name">{teamName(state.teams, 1)}</span>
              <span className="team-header-score">
                : <span>{reveal.team1}</span>{' '}
                {state.teams.team1Points === 1 ? 'Punkt' : 'Punkte'}
              </span>
            </span>
          )}
          <TeamJokers team="team1" />
        </div>
      ) : (
        <div />
      )}

      {showGameCounter ? (
        <div id="gameNumber">
          Spiel {currentGame.currentIndex + 1} von {currentGame.totalGames}
        </div>
      ) : (
        <div />
      )}

      {showTeamColumns ? (
        <div id="team2PointsContainer" className="team-header-cell team-header-team2">
          <TeamJokers team="team2" />
          {pointSystemEnabled && (
            <span className="team-header-label">
              <span className="team-header-name">{teamName(state.teams, 2)}</span>
              <span className="team-header-score">
                : <span>{reveal.team2}</span>{' '}
                {state.teams.team2Points === 1 ? 'Punkt' : 'Punkte'}
              </span>
            </span>
          )}
        </div>
      ) : (
        <div />
      )}
    </header>
  );
}
