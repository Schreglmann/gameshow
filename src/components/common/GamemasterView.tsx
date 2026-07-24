import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand, requestShowReemit } from '@/hooks/useGamemasterSync';
import { useGameContext } from '@/context/GameContext';
import { getJoker } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import type { JokerTeam } from '@/types/jokers';
import type { GamemasterControl, GamemasterButtonDef, GamemasterInputDef } from '@/types/game';
import { PHASE_SCREEN_LABELS } from '@/types/game';
import CorrectAnswersTracker from '@/components/common/CorrectAnswersTracker';
import ScoreHistoryPanel from '@/components/common/ScoreHistoryPanel';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import '@/styles/gamemaster.css';

interface GamemasterViewProps {
  showAnswerImages?: boolean;
  /** When true (default), preview the next question's answer while the current
   *  answer is revealed in the frontend. See specs/gamemaster-next-answer.md. */
  showNextAnswer?: boolean;
}

/**
 * Shared gamemaster view: answer card + controls panel.
 * Used by both /gamemaster (full-screen) and /admin#answers (embedded).
 */
export default function GamemasterView({ showAnswerImages = false, showNextAnswer = true }: GamemasterViewProps = {}) {
  const data = useGamemasterAnswer();
  const controlsData = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();

  const controls = controlsData?.controls ?? [];

  // Desync guard: the answer card mirrors the `gamemaster-answer` channel and
  // the controls/tracker mirror the `gamemaster-controls` channel — two
  // independently-cached streams. If the answer shows a non-game screen label
  // (e.g. "Startseite") while the controls say we're mid-game, the two have
  // drifted apart (a stale emit from a lingering start-page surface, a
  // connect-timing window, etc.). Surface it and offer a one-click resync that
  // asks the active show to re-broadcast its truth. See specs/cross-device-gamemaster.md.
  const phase = controlsData?.phase;
  const screenLabel = data?.screenLabel;
  const desynced = phase != null && !!screenLabel && screenLabel !== PHASE_SCREEN_LABELS[phase];

  // "Letzte Wertungen" is only useful in two moments: on a game's title screen
  // (reviewing/correcting between games) and DURING a game whose scoring changes
  // points live (bet-quiz / quizjagd / final-quiz / wer-kennt-mehr — these set
  // `hideCorrectTracker`, the same "points already reflected inline" signal).
  // For every other game it's clutter mid-play, so it stays hidden until the
  // next title screen. See specs/gamemaster-cockpit.md.
  const pointsChangingGame = controlsData?.hideCorrectTracker === true;
  const showScoreHistory = phase === 'landing' || (phase === 'game' && pointsChangingGame);

  return (
    <div className="gamemaster-content">
      {desynced && (
        <div className="gm-desync-banner" role="alert">
          <div className="gm-desync-text">
            <strong className="gm-desync-title">Anzeige möglicherweise veraltet</strong>
            <span className="gm-desync-detail">
              Die angezeigte Antwort passt nicht zur aktuellen Spielphase. Synchronisiere neu, um die aktuelle Antwort zu laden.
            </span>
          </div>
          <button
            type="button"
            className="gm-btn gm-btn--primary gm-desync-btn"
            onClick={requestShowReemit}
          >
            Jetzt synchronisieren
          </button>
        </div>
      )}
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
            {data.questionImage && showAnswerImages && (
              <GmPreviewImage
                className="gamemaster-question-image"
                src={data.questionImage}
                alt="Aktuelles Bild"
              />
            )}
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
            {data.answerImage && showAnswerImages && (
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
            {showNextAnswer && controlsData?.answerRevealed && data.nextAnswer && (
              <div className="gamemaster-next">
                <div className="gamemaster-next-label">Nächste Frage</div>
                {data.nextAnswer.question && (
                  <div className="gamemaster-next-question">{data.nextAnswer.question}</div>
                )}
                {data.nextAnswer.image && showAnswerImages && (
                  <GmPreviewImage
                    className="gamemaster-next-image"
                    src={data.nextAnswer.image}
                    alt="Nächstes Bild"
                  />
                )}
                <div className="gamemaster-next-answer">{data.nextAnswer.answer}</div>
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

      {showScoreHistory && <ScoreHistoryPanel />}
    </div>
  );
}

// ── Preview image with loading indicator ──

/**
 * A gamemaster preview image (e.g. the random-frame current/next still) that shows a
 * spinner while a new source loads. When the GM re-rolls a frame, the `src` changes to a
 * not-yet-extracted URL; this keeps the previous frame dimmed and overlays a spinner so the
 * host gets immediate feedback that something is happening instead of a frozen-looking image.
 */
function GmPreviewImage({ src, className, alt }: { src: string; className: string; alt: string }) {
  const [loading, setLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    // A frame the GM already previewed (e.g. the re-rolled next image becoming the
    // current image) is served from cache: the browser marks the <img> complete
    // synchronously and never fires onLoad for the new handler, leaving the spinner
    // stuck. Clear it up front in that case; otherwise show the spinner until onLoad.
    if (img && img.complete && img.naturalWidth > 0) {
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [src]);
  return (
    <div className="gamemaster-image-wrap">
      <img
        ref={imgRef}
        className={className}
        src={src}
        alt={alt}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        style={{ opacity: loading ? 0.4 : 1, transition: 'opacity 0.2s ease' }}
      />
      {loading && (
        <div className="gamemaster-image-loading" role="status" aria-live="polite">
          <div className="video-loading-spinner" />
        </div>
      )}
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
  // Joker confirmation: when a joker is turned ON, surface its manual-resolution
  // text so the GM doesn't have to remember each joker's effect. Pure client
  // render off JOKER_CATALOG; auto-clears. See specs/gamemaster-cockpit.md.
  const [lastUsed, setLastUsed] = useState<{ team: JokerTeam; jokerId: string } | null>(null);
  useEffect(() => {
    if (!lastUsed) return;
    const id = window.setTimeout(() => setLastUsed(null), 7000);
    return () => window.clearTimeout(id);
  }, [lastUsed]);

  const enabled = state.settings.enabledJokers ?? [];
  if (enabled.length === 0) return null;

  // Use the WS-broadcast gameIndex/totalGames so the last-game check works on
  // a gamemaster running on a different device (iPad) than the show — the
  // localStorage `currentGame` is per-device, but `controlsData` rides over
  // the WebSocket and reaches every connected gamemaster.
  const ci = controlsData?.gameIndex;
  const tg = controlsData?.totalGames;
  const isLastGame =
    typeof ci === 'number' && typeof tg === 'number' && ci === tg - 1;
  // Match the frontend's TeamJokers behaviour: hide the joker section entirely
  // in the last game unless the gameshow allows jokers there.
  if (isLastGame && state.settings.jokersInLastGame !== true) return null;

  // Comeback joker (Aufholjoker) gating: only the strictly-trailing team may
  // arm it; on a tie neither may. Computed at read time — never stored.
  const { team1Points, team2Points } = state.teams;
  const trailingTeam: JokerTeam | null =
    team1Points < team2Points ? 'team1' : team2Points < team1Points ? 'team2' : null;

  const toggle = (team: JokerTeam, jokerId: string, used: boolean) => {
    dispatch({ type: 'SET_JOKER_USED', payload: { team, jokerId, used } });
    sendCommand('use-joker', { team, jokerId, used: used ? 'true' : 'false' });
    if (jokerId === 'comeback') {
      dispatch(used
        ? { type: 'ARM_DOUBLE_NEXT_GAME', payload: { team } }
        : { type: 'CLEAR_DOUBLE_NEXT_GAME' });
    }
    setLastUsed(used ? { team, jokerId } : null);
  };

  const usedCount =
    state.teams.team1JokersUsed.length + state.teams.team2JokersUsed.length;
  const totalCount = enabled.length * 2;
  const lastUsedDef = lastUsed ? getJoker(lastUsed.jokerId) : undefined;

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
      {lastUsedDef && lastUsed && (
        <div className="gm-joker-confirm" role="status" aria-live="polite">
          <span className="gm-joker-confirm-team">{teamName(state.teams, lastUsed.team === 'team1' ? 1 : 2)}</span>
          <span className="gm-joker-confirm-name">{lastUsedDef.name}</span>
          <span className="gm-joker-confirm-desc">{lastUsedDef.description}</span>
        </div>
      )}
      {!collapsed && (
        <div id="gm-jokers-body" className="gm-jokers-body">
          <div className="gm-jokers-teams">
            {/* GM faces the crowd → mirror the frontend team order. */}
            {teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled).map(teamKey => (
              <JokerTeamCard
                key={teamKey}
                team={teamKey}
                label={teamName(state.teams, teamKey === 'team1' ? 1 : 2)}
                enabled={enabled}
                used={teamKey === 'team1' ? state.teams.team1JokersUsed : state.teams.team2JokersUsed}
                trailingTeam={trailingTeam}
                onToggle={toggle}
              />
            ))}
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
  trailingTeam: JokerTeam | null;
  onToggle: (team: JokerTeam, jokerId: string, used: boolean) => void;
}

function JokerTeamCard({ team, label, enabled, used, trailingTeam, onToggle }: JokerTeamCardProps) {
  const usedCount = enabled.filter(id => used.includes(id)).length;
  return (
    <div className="gm-joker-team">
      <div className="gm-joker-team-label">
        <span>{label}</span>
        <span className="gm-joker-team-remaining" aria-label={`${usedCount} von ${enabled.length} genutzt`}>
          {usedCount} / {enabled.length}
        </span>
      </div>
      <div className="gm-joker-team-list">
        {enabled.map(id => {
          const def = getJoker(id);
          if (!def) return null;
          const isUsed = used.includes(id);
          // Comeback joker locked for the leading team / on a tie unless already used.
          const locked = id === 'comeback' && !isUsed && team !== trailingTeam;
          return (
            <button
              key={id}
              type="button"
              role="switch"
              aria-checked={isUsed}
              disabled={locked}
              className={`gm-joker-toggle${isUsed ? ' used' : ''}${locked ? ' locked' : ''}`}
              title={locked ? `${def.name} — nur das zurückliegende Team` : def.description}
              onClick={() => onToggle(team, id, !isUsed)}
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
  if (control.hideBack && control.hideForward) return null;
  return (
    <div className="gm-nav-row">
      {!control.hideBack && (
        <button className="gm-btn" onClick={() => onCommand('nav-back')}>
          Zurück
        </button>
      )}
      {!control.hideForward && (
        <button className="gm-btn gm-btn--primary" onClick={() => onCommand('nav-forward')}>
          Weiter
        </button>
      )}
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

  // Reset local state when inputs change (new question). For emitOnChange inputs
  // the GM owns the value while typing (it round-trips through the show), so we
  // key only on the input ID — re-seeding on every echoed value would clobber
  // in-progress input. Inputs WITHOUT emitOnChange (e.g. the prefilled
  // assign-teams roster) are show/config-seeded, so we key on their value too:
  // the roster loads asynchronously after the control mounts, so an ID-only key
  // would never pick it up. See specs/team-management.md.
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const input of control.inputs) {
      initial[input.id] = input.value ?? '';
    }
    setValues(initial);
  }, [control.inputs.map((i: GamemasterInputDef) => (i.emitOnChange ? i.id : `${i.id}=${i.value ?? ''}`)).join(',')]);

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
