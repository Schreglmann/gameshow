import { useState, useEffect, type FormEvent } from 'react';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { useGameContext } from '@/context/GameContext';
import { getJoker } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import type { JokerTeam } from '@/types/jokers';
import type { GamemasterControl, GamemasterButtonDef, GamemasterInputDef } from '@/types/game';
import CorrectAnswersTracker from '@/components/common/CorrectAnswersTracker';
import '@/styles/gamemaster.css';

/**
 * Shared gamemaster view: answer card + controls panel.
 * Used by both /gamemaster (full-screen) and /admin#answers (embedded).
 */
export default function GamemasterView() {
  const data = useGamemasterAnswer();
  const controlsData = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();

  const controls = controlsData?.controls ?? [];

  return (
    <div className="gamemaster-content">
      <div className="gamemaster-card">
        {data?.screenLabel ? (
          <>
            <div className="gamemaster-title">{data.gameTitle}</div>
            <div className="gamemaster-screen-label">{data.screenLabel}</div>
          </>
        ) : data ? (
          <>
            <div className="gamemaster-meta">
              {data.questionNumber === 0 ? 'Beispiel' : `Frage ${data.questionNumber} / ${data.totalQuestions}`}
            </div>
            <div className="gamemaster-title">{data.gameTitle}</div>
            {data.question && <div className="gamemaster-question">{data.question}</div>}
            {data.answerList ? (
              <ul className="gamemaster-answer-list">
                {data.answerList.map(item => (
                  <li key={item.rank}>
                    <button
                      type="button"
                      className={`gamemaster-answer-item${item.revealed ? ' revealed' : ' pending'}`}
                      onClick={() => sendCommand(`rank-${item.rank}`)}
                      title="In Frontend bis hierher aufdecken"
                    >
                      <span className="gamemaster-answer-rank">{item.rank}</span>
                      <span className="gamemaster-answer-text">{item.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="gamemaster-answer">{data.answer}</div>
            )}
            {data.answerImage && (
              <img
                className="gamemaster-image"
                src={data.answerImage}
                alt="Antwort"
              />
            )}
            {data.extraInfo && (
              <div className="gamemaster-extra">
                {data.extraInfo.split('\n').map((line, i) => (
                  <div key={i} className={line.includes(data.answer) ? 'gamemaster-extra-highlight' : undefined}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="gamemaster-waiting">
            <div className="gamemaster-waiting-icon">📝</div>
            <div className="gamemaster-waiting-title">Gamemaster-Ansicht</div>
            <div className="gamemaster-waiting-description">
              Hier wird während einer laufenden Gameshow die aktuelle Antwort angezeigt.
              Starte ein Spiel in einem anderen Tab — die Lösung erscheint dann automatisch hier.
            </div>
            <div className="gamemaster-waiting-description">
              Pfeiltasten und Klicks funktionieren wie im Frontend:
              Pfeil rechts / Leertaste / Klick blättert weiter, Pfeil links zurück.
            </div>
          </div>
        )}
      </div>

      {controls.length > 0 && (
        <div className="gamemaster-controls-panel">
          {controls.map(control => (
            <ControlRenderer
              key={control.id}
              control={control}
              onCommand={sendCommand}
            />
          ))}
        </div>
      )}

      {(controlsData?.phase === 'game' || controlsData?.phase === 'points')
        && typeof controlsData.gameIndex === 'number'
        && !controlsData.hideCorrectTracker && (
        <CorrectAnswersTracker gameIndex={controlsData.gameIndex} />
      )}

      {data && <JokerControls />}
    </div>
  );
}

// ── Joker controls ──

function JokerControls() {
  const { state, dispatch } = useGameContext();
  const controlsData = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();
  // Collapsed by default — the GM panel already has a lot going on; the joker
  // grid only needs to appear when the GM actually wants to flip state.
  const [collapsed, setCollapsed] = useState(true);

  const enabled = state.settings.enabledJokers ?? [];
  if (enabled.length === 0) return null;

  // Use the WS-broadcast gameIndex/totalGames so the lockout works on a
  // gamemaster running on a different device (iPad) than the show — the
  // localStorage `currentGame` is per-device, but `controlsData` rides over
  // the WebSocket and reaches every connected gamemaster.
  const ci = controlsData?.gameIndex;
  const tg = controlsData?.totalGames;
  const isLastGame =
    typeof ci === 'number' && typeof tg === 'number' && ci === tg - 1;
  // Match the frontend's TeamJokers behaviour: jokers are simply disabled in
  // the last game on the GM as well, no per-session override.
  const locked = isLastGame;

  const toggle = (team: JokerTeam, jokerId: string, used: boolean) => {
    dispatch({ type: 'SET_JOKER_USED', payload: { team, jokerId, used } });
    sendCommand('use-joker', { team, jokerId, used: used ? 'true' : 'false' });
  };

  const usedCount =
    state.teams.team1JokersUsed.length + state.teams.team2JokersUsed.length;
  const totalCount = enabled.length * 2;

  return (
    <div className={`gm-jokers${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="gm-jokers-header"
        aria-expanded={!collapsed}
        aria-controls="gm-jokers-body"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="gm-jokers-header-title">Joker</span>
        <span className="gm-jokers-header-count" aria-hidden="true">
          {usedCount} / {totalCount}
        </span>
        <span className="gm-jokers-header-chevron" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {!collapsed && (
        <div id="gm-jokers-body" className="gm-jokers-body">
          <div className="gm-jokers-teams">
            <JokerTeamCard
              team="team1"
              label="Team 1"
              enabled={enabled}
              used={state.teams.team1JokersUsed}
              locked={locked}
              onToggle={toggle}
            />
            <JokerTeamCard
              team="team2"
              label="Team 2"
              enabled={enabled}
              used={state.teams.team2JokersUsed}
              locked={locked}
              onToggle={toggle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface JokerTeamCardProps {
  team: JokerTeam;
  label: string;
  enabled: string[];
  used: string[];
  locked: boolean;
  onToggle: (team: JokerTeam, jokerId: string, used: boolean) => void;
}

function JokerTeamCard({ team, label, enabled, used, locked, onToggle }: JokerTeamCardProps) {
  return (
    <div className="gm-joker-team">
      <div className="gm-joker-team-label">{label}</div>
      <div className="gm-joker-team-list">
        {enabled.map(id => {
          const def = getJoker(id);
          if (!def) return null;
          const isUsed = used.includes(id);
          // In the last game we mirror the frontend: lock UNUSED jokers (so a
          // team can't activate a fresh one) but still allow reverting a USED
          // one in case the GM marked it by mistake.
          const cannotActivate = locked && !isUsed;
          return (
            <button
              key={id}
              type="button"
              role="switch"
              aria-checked={isUsed}
              disabled={cannotActivate}
              className={`gm-joker-toggle${isUsed ? ' used' : ''}${cannotActivate ? ' disabled' : ''}`}
              title={def.description}
              onClick={() => {
                if (cannotActivate) return;
                onToggle(team, id, !isUsed);
              }}
            >
              <span className="gm-joker-toggle-icon" aria-hidden="true">
                <JokerIcon id={id} size={20} />
              </span>
              <span className="gm-joker-toggle-name">{def.name}</span>
              <span className="gm-joker-toggle-status" aria-hidden="true">
                {isUsed ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Generic control renderer ──

interface ControlRendererProps {
  control: GamemasterControl;
  onCommand: (controlId: string, value?: string | Record<string, string>) => void;
}

function ControlRenderer({ control, onCommand }: ControlRendererProps) {
  switch (control.type) {
    case 'nav':
      return <NavControl control={control} onCommand={onCommand} />;
    case 'button':
      return <ButtonControl control={control} onCommand={onCommand} />;
    case 'button-group':
      return <ButtonGroupControl control={control} onCommand={onCommand} />;
    case 'input-group':
      return <InputGroupControl control={control} onCommand={onCommand} />;
    case 'info':
      return <div className="gm-info">{control.text}</div>;
    default:
      return null;
  }
}

function NavControl({ control, onCommand }: { control: Extract<GamemasterControl, { type: 'nav' }>; onCommand: (id: string) => void }) {
  return (
    <div className="gm-nav-row">
      {!control.hideBack && (
        <button className="gm-btn" onClick={() => onCommand('nav-back')}>
          Zurück
        </button>
      )}
      <button className="gm-btn gm-btn--primary" onClick={() => onCommand('nav-forward')}>
        Weiter
      </button>
    </div>
  );
}

function ButtonControl({ control, onCommand }: {
  control: Extract<GamemasterControl, { type: 'button' }>;
  onCommand: (id: string) => void;
}) {
  const variantClass = control.variant ? ` gm-btn--${control.variant}` : '';
  return (
    <button
      className={`gm-btn${variantClass}`}
      disabled={control.disabled}
      onClick={() => onCommand(control.id)}
    >
      {control.label}
    </button>
  );
}

function ButtonGroupControl({ control, onCommand }: {
  control: Extract<GamemasterControl, { type: 'button-group' }>;
  onCommand: (id: string) => void;
}) {
  return (
    <div className="gm-button-group">
      {control.label && <div className="gm-group-label">{control.label}</div>}
      <div className="gm-button-row">
        {control.buttons.map((btn: GamemasterButtonDef) => {
          const variantClass = btn.variant ? ` gm-btn--${btn.variant}` : '';
          const activeClass = btn.active ? ' gm-btn--active' : '';
          return (
            <button
              key={btn.id}
              className={`gm-btn${variantClass}${activeClass}${btn.sublabel ? ' gm-btn--stacked' : ''}`}
              disabled={btn.disabled}
              onClick={() => onCommand(btn.id)}
            >
              <span className="gm-btn-label">{btn.label}</span>
              {btn.sublabel && <span className="gm-btn-sublabel">{btn.sublabel}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InputGroupControl({ control, onCommand }: {
  control: Extract<GamemasterControl, { type: 'input-group' }>;
  onCommand: (id: string, value?: string | Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset local state when inputs change (new question)
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const input of control.inputs) {
      initial[input.id] = input.value ?? '';
    }
    setValues(initial);
  }, [control.inputs.map((i: GamemasterInputDef) => i.id).join(',')]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onCommand(control.id, values);
  };

  return (
    <form className="gm-input-group" onSubmit={handleSubmit}>
      {control.inputs.map((input: GamemasterInputDef) => (
        <div key={input.id} className="gm-input-field">
          <label className="gm-input-label">{input.label}</label>
          <input
            className="gm-input"
            type={input.inputType}
            placeholder={input.placeholder}
            value={values[input.id] ?? ''}
            onChange={e => {
              const next = { ...values, [input.id]: e.target.value };
              setValues(next);
              if (input.emitOnChange) onCommand(`${control.id}:change`, next);
            }}
          />
        </div>
      ))}
      <button
        type="submit"
        className="gm-btn gm-btn--primary"
        disabled={control.submitDisabled}
      >
        {control.submitLabel}
      </button>
    </form>
  );
}
