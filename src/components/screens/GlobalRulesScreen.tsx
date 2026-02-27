import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/context/GameContext';

export default function GlobalRulesScreen() {
  const { state } = useGameContext();
  const navigate = useNavigate();

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
