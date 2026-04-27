import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import type { GamemasterCommand } from '@/types/game';

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
  useGamemasterControlsSync([{ type: 'nav', id: 'nav', hideBack: true }]);
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward') {
      navigate('/game?index=0');
    }
  }, [navigate]));

  // Skip this screen entirely when there are no global rules
  useEffect(() => {
    if (state.settingsLoaded && state.settings.globalRules.length === 0) {
      navigate('/game?index=0');
    }
  }, [state.settingsLoaded, state.settings.globalRules, navigate]);

  useEffect(() => {
    const handleAdvance = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== ' ') return;
      navigate('/game?index=0');
    };
    window.addEventListener('keydown', handleAdvance);
    window.addEventListener('click', handleAdvance);
    return () => {
      window.removeEventListener('keydown', handleAdvance);
      window.removeEventListener('click', handleAdvance);
    };
  }, [navigate]);

  return (
    <div id="globalRulesScreen" className="rules-container">
      <h1>Regelwerk</h1>
      <ul id="globalRulesList">
        {state.settings.globalRules.map((rule, i) => (
          <li key={i}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}
