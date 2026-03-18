import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';

export default function GlobalRulesScreen() {
  const { state } = useGameContext();
  const navigate = useNavigate();

  // Skip this screen entirely when there are no global rules
  useEffect(() => {
    if (state.settingsLoaded && state.settings.globalRules.length === 0) {
      navigate('/game?index=0');
    }
  }, [state.settingsLoaded, state.settings.globalRules, navigate]);

  return (
    <div id="globalRulesScreen" className="rules-container">
      <h1>Regelwerk</h1>
      <ul id="globalRulesList">
        {state.settings.globalRules.map((rule, i) => (
          <li key={i}>{rule}</li>
        ))}
      </ul>
      <button className="next-button" onClick={() => navigate('/game?index=0')}>
        Weiter
      </button>
    </div>
  );
}
