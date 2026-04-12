import { useState, useEffect, type FormEvent } from 'react';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import type { GamemasterControl, GamemasterButtonDef, GamemasterInputDef } from '@/types/game';
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
            <div className="gamemaster-answer">{data.answer}</div>
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
              className={`gm-btn${variantClass}${activeClass}`}
              disabled={btn.disabled}
              onClick={() => onCommand(btn.id)}
            >
              {btn.label}
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
            onChange={e => setValues(prev => ({ ...prev, [input.id]: e.target.value }))}
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
