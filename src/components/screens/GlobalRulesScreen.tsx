import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';
import { GENERIC_JOKER_RULES } from '@/data/jokers';
import { hasGlobalRulesContent } from '@/utils/globalRules';

export default function GlobalRulesScreen() {
  const { state } = useGameContext();
  const navigate = useNavigate();

  // Broadcast screen info to gamemaster
  useGamemasterSync({
    gameTitle: 'Regelwerk',
    questionNumber: 0,
    totalQuestions: 0,
    answer: '',
    screenLabel: 'Globale Regeln',
  });
  useGamemasterControlsSync([{ type: 'nav', id: 'nav' }]);
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward') {
      navigate('/game?index=0');
    } else if (cmd.controlId === 'nav-back') {
      navigate('/');
    }
  }, [navigate]));

  // Skip this screen entirely when there is nothing to show — no global rules
  // AND no jokers (jokers append a generic explanation below the rules list).
  useEffect(() => {
    if (state.settingsLoaded && !hasGlobalRulesContent(state.settings)) {
      navigate('/game?index=0');
    }
  }, [state.settingsLoaded, state.settings, navigate]);

  useEffect(() => {
    const handleNav = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent) {
        // ArrowLeft steps back to the start page; the other keys advance.
        if (e.key === 'ArrowLeft') { navigate('/'); return; }
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== ' ') return;
      }
      navigate('/game?index=0');
    };
    window.addEventListener('keydown', handleNav);
    window.addEventListener('click', handleNav);
    return () => {
      window.removeEventListener('keydown', handleNav);
      window.removeEventListener('click', handleNav);
    };
  }, [navigate]);

  const { globalRules, enabledJokers } = state.settings;
  // Operator-editable joker explanation (admin ConfigTab); fall back to the
  // built-in default when unset/empty. See specs/jokers.md.
  const jokerRules = state.settings.jokerRules?.length
    ? state.settings.jokerRules
    : GENERIC_JOKER_RULES;

  return (
    <div id="globalRulesScreen" className="rules-container">
      <h1>Regelwerk</h1>
      {globalRules.length > 0 && (
        <ul id="globalRulesList">
          {globalRules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      )}
      {enabledJokers.length > 0 && (
        <ul
          id="globalRulesJokerList"
          className={`rules-joker-list${globalRules.length > 0 ? ' rules-joker-list--divided' : ''}`}
        >
          {jokerRules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
