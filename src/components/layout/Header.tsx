import { useEffect, useRef, useState, useMemo } from 'react';
import { useGameContext } from '@/context/GameContext';
import TeamJokers from '@/components/common/TeamJokers';
import TeamHeaderName from '@/components/layout/TeamHeaderName';
import TeamDot from '@/components/common/TeamDot';
import { teamName, joinTeamNames, hasNamedTeams } from '@/utils/teamNames';
import { teamDisplayOrder, splitAroundCenter } from '@/utils/teamOrder';
import { ALL_TEAM_KEYS, leadingTeams, pointsByTeam, teamPoints, type TeamKey } from '@/utils/teams';
import { useScoreReveal } from '@/hooks/useScoreReveal';
import { useHeaderHeightVar } from '@/hooks/useHeaderHeightVar';

interface HeaderProps {
  showGameNumber?: boolean;
}

export default function Header({ showGameNumber = true }: HeaderProps) {
  const { state } = useGameContext();
  const { pointSystemEnabled, enabledJokers, jokersInLastGame, teamCount } = state.settings;
  const { currentGame } = state;

  const isLastGame =
    currentGame !== null && currentGame.currentIndex === currentGame.totalGames - 1;
  // Jokers are hidden in the last game unless explicitly allowed — don't let
  // them keep the team side-columns alive (empty glass cell) in that case.
  const hasJokers =
    (enabledJokers ?? []).length > 0 && !(isLastGame && jokersInLastGame !== true);
  const showTeamColumns = (pointSystemEnabled || hasJokers) && teamCount > 0;
  const showGameCounter = showGameNumber && currentGame !== null;

  // Layout is keyed to POSITION (left/right); which team's data flows into each
  // cell comes from the order swap. The cell's mirror-image internal layout
  // (label/joker order, borders, tooltip side) follows its side, not the team.
  // See specs/team-order-mirror.md and specs/team-count.md.
  const order = useMemo(
    () => teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled, teamCount),
    [state.teams.orderSwapped, state.settings.teamMirrorEnabled, teamCount],
  );
  const { left, right } = splitAroundCenter(order);

  // Animated score reveal + lead-change detection (purely presentational).
  //
  // The DISPLAY values cover every team, not just the active ones: settings load
  // asynchronously, so the first render still has the default two-team count —
  // seeding the hook from `order` there would start teams 3/4 at 0 and then
  // animate them up to their real score on every page load. Only lead detection
  // is scoped to `order`.
  const points = useMemo(() => pointsByTeam(state.teams, ALL_TEAM_KEYS), [state.teams]);
  const reveal = useScoreReveal(points, order);

  // "Führungswechsel!" banner on a genuine lead flip.
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (reveal.leadChangeKey === 0) return;
    if (!pointSystemEnabled) return;
    setBannerVisible(true);
    const id = window.setTimeout(() => setBannerVisible(false), 2800);
    return () => window.clearTimeout(id);
  }, [reveal.leadChangeKey, pointSystemEnabled]);

  // The team(s) now in front. Computed at render so the banner can name the new
  // leader; a universal tie has no leader and is not announced.
  const leaders = leadingTeams(state.teams, order);
  const leaderName = leaders.length > 0 && leaders.length < order.length
    ? joinTeamNames(state.teams, leaders)
    : null;

  // Fixed theme layers (the pub-quiz wooden frame) need to start below the
  // sticky header, whose height is fluid. See specs/themes.md.
  const headerRef = useRef<HTMLElement>(null);
  useHeaderHeightVar(headerRef);

  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const update = () => setIsScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  const renderTeamCell = (teamKey: TeamKey, side: 'left' | 'right') => {
    const revealPoints = reveal.points[teamKey];
    const rawPoints = teamPoints(state.teams, teamKey);
    // At 0-1 teams there is no team to name — the audience simply has a score.
    // Printing "Team 1: 7 Punkte" there would invent a team and imply an
    // opponent, so the label collapses to the bare score (and drops the colon
    // that only made sense after a name). See specs/team-count.md.
    const named = hasNamedTeams(teamCount);
    const label = pointSystemEnabled ? (
      <span className="team-header-label">
        {named && <><TeamDot team={teamKey} /><TeamHeaderName name={teamName(state.teams, teamKey)} /></>}
        <span className="team-header-score">
          {named ? ': ' : ''}<span>{revealPoints}</span>{' '}
          {rawPoints === 1 ? 'Punkt' : 'Punkte'}
        </span>
      </span>
    ) : null;
    const jokers = <TeamJokers team={teamKey} side={side} />;
    return (
      <div key={teamKey} id={`${teamKey}PointsContainer`} data-team={teamKey} className={`team-header-cell team-header-${side}`}>
        {side === 'left' ? <>{label}{jokers}</> : <>{jokers}{label}</>}
      </div>
    );
  };

  // Above two teams each side becomes a COLUMN of team pills — team 1 over
  // team 2 on the left, team 3 over team 4 on the right — instead of more pills
  // competing for the one row. That keeps the two-team header's shape (a side,
  // the counter, a side) at every count, and it is what makes the jokers
  // attributable again: side by side on one row, team 2's grid and team 3's
  // ended up adjacent in the middle with nothing to say which was which, whereas
  // a stack puts exactly one team on each row. See specs/header.md.
  const stacked = showTeamColumns && order.length > 2;

  // Each side gets the same number of slots so the game counter stays centred:
  // the shorter side is padded with empty <div>s, which `header div:empty` in
  // layout.css renders as invisible flex spacers. With 2 teams this is exactly
  // the historic 1 / counter / 1 layout. Stacked sides need no padding — the two
  // stack wrappers are themselves the two equal flex columns.
  const slots = showTeamColumns ? Math.max(left.length, right.length, 1) : 1;
  const renderSide = (cells: TeamKey[], side: 'left' | 'right') => {
    const rendered = showTeamColumns ? cells.map(key => renderTeamCell(key, side)) : [];
    if (stacked) {
      return (
        <div key={`stack-${side}`} className={`team-header-stack team-header-stack-${side}`}>
          {rendered}
        </div>
      );
    }
    const padding = Array.from(
      { length: slots - rendered.length },
      (_, i) => <div key={`spacer-${side}-${i}`} />,
    );
    return side === 'left' ? [...padding, ...rendered] : [...rendered, ...padding];
  };

  return (
    <header
      ref={headerRef}
      className={isScrolled ? 'is-scrolled' : undefined}
      data-team-count={showTeamColumns ? order.length : 0}
    >
      {bannerVisible && (
        <div className="fuehrungswechsel-banner" role="status" aria-live="polite">
          Führungswechsel!
          {leaderName && (
            <> <span className="fuehrungswechsel-leader">{leaderName}</span> führt</>
          )}
        </div>
      )}
      {renderSide(left, 'left')}

      {showGameCounter ? (
        <div id="gameNumber">
          Spiel {currentGame.currentIndex + 1} von {currentGame.totalGames}
        </div>
      ) : (
        <div />
      )}

      {renderSide(right, 'right')}
    </header>
  );
}
