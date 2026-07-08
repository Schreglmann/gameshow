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
  useGamemasterControlsSync([{ type: 'nav', id: 'nav' }]);
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward') {
      navigate('/game?index=0');
    } else if (cmd.controlId === 'nav-back') {
      navigate('/');
    }
  }, [navigate]));

  // Skip this screen entirely when there are no global rules
  useEffect(() => {
    if (state.settingsLoaded && state.settings.globalRules.length === 0) {
      navigate('/game?index=0');
    }
  }, [state.settingsLoaded, state.settings.globalRules, navigate]);

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
