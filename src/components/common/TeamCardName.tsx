import type { TeamKey } from '@/utils/teams';
import { useFitTeamName } from '@/hooks/useFitTeamName';
import TeamDot from './TeamDot';

interface Props {
  team: TeamKey;
  name: string;
  /** Omitted only by the theme showcase, which renders the heading statically. */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * The click-to-rename heading on a HomeScreen team card.
 *
 * The `<h2>` is the box — a pinned one line of height — and the span inside it
 * is the text that `useFitTeamName` scales into it, so a long name shrinks
 * instead of being cut off while every card in the row keeps its roster at the
 * same height.
 *
 * The colour dot is a SIBLING of that span, not part of it: as inline content it
 * ends up alone on the first line whenever the name is one long unbreakable word
 * (the word moves to a line of its own rather than breaking). As a flex item it
 * sits beside the whole name block instead. See specs/team-management.md.
 */
export default function TeamCardName({ team, name, onClick }: Props) {
  const ref = useFitTeamName(name);

  return (
    <h2
      className="team-name-editable team-card-name"
      title="Zum Umbenennen klicken"
      onClick={onClick}
    >
      <TeamDot team={team} />
      <span className="team-card-name-text" ref={ref}>{name}</span>
    </h2>
  );
}
