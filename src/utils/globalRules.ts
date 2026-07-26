import type { GlobalSettings } from '@/types/game';

/**
 * Whether the global rules screen (`GlobalRulesScreen`) has anything to show for
 * the active gameshow: either configured `globalRules`, or enabled jokers (which
 * append a generic joker explanation — see specs/jokers.md). When this is false,
 * the rules screen auto-forwards to game 0 and back-navigation skips it entirely.
 *
 * Kept in one place so the rules screen's skip logic and `GameScreen`'s back-nav
 * target can never disagree about whether `/rules` is worth showing.
 */
export function hasGlobalRulesContent(
  settings: Pick<GlobalSettings, 'globalRules' | 'enabledJokers'>,
): boolean {
  return settings.globalRules.length > 0 || settings.enabledJokers.length > 0;
}
