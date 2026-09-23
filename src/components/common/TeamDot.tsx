import type { TeamKey } from '@/utils/teams';

interface Props {
  team: TeamKey;
  className?: string;
}

/**
 * The small coloured disc that marks a team beside its name.
 *
 * Renders no visible box unless the operator enabled team colours
 * (`html[data-team-colors="on"]`, published by `useTeamColorVars`), so it can be
 * dropped into a tight header pill without reserving a gap when the feature is
 * off. It carries its OWN `data-team`, which means a surface can show a dot
 * without also marking its container.
 *
 * `aria-hidden` because it never carries meaning on its own — the team's name is
 * always right next to it. Lives in `common/` because all three zones (show,
 * gamemaster, admin) render it. See specs/team-colors.md.
 */
export default function TeamDot({ team, className }: Props) {
  return (
    <span
      className={className ? `team-dot ${className}` : 'team-dot'}
      data-team={team}
      aria-hidden="true"
    />
  );
}
