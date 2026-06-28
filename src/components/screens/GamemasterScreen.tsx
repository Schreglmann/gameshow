import { useCallback, useEffect, useRef, useState } from 'react';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { onWsOpen, sendWsControl, sendWs, useWsChannel } from '@/services/useBackendSocket';
import GamemasterView from '@/components/common/GamemasterView';
import DeadlineTimer from '@/components/common/DeadlineTimer';
import InstallButton from '@/components/common/InstallButton';
import type { ShowHoldState } from '@/types/game';

const LOCK_STORAGE_KEY = 'gm-input-locked';
const SHOW_ANSWER_IMAGES_STORAGE_KEY = 'gm-show-answer-images';
const SHOW_NEXT_ANSWER_STORAGE_KEY = 'gm-show-next-answer';

function readStoredLock(): boolean {
  try {
    return localStorage.getItem(LOCK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readStoredShowAnswerImages(): boolean {
  try {
    return localStorage.getItem(SHOW_ANSWER_IMAGES_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

// Default ON: only an explicit 'false' disables the next-answer preview.
function readStoredShowNextAnswer(): boolean {
  try {
    return localStorage.getItem(SHOW_NEXT_ANSWER_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function GamemasterScreen() {
  const sendCommand = useSendGamemasterCommand();
  const answer = useGamemasterAnswer();
  // "Active game" = the frontend has synced an answer without a screenLabel.
  // screenLabel is set on non-game screens (home/rules/summary), so we hide
  // the install button only while a question is actually being played.
  const gameActive = !!answer && !answer.screenLabel;

  const [locked, setLocked] = useState<boolean>(readStoredLock);
  // Keep the latest value in a ref so the document listeners (registered once
  // below) can read the current state without being torn down/re-attached.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const toggleLock = useCallback(() => {
    setLocked((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LOCK_STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        /* localStorage unavailable — keep in-memory state */
      }
      return next;
    });
  }, []);

  const [showAnswerImages, setShowAnswerImages] = useState<boolean>(readStoredShowAnswerImages);

  const toggleShowAnswerImages = useCallback(() => {
    setShowAnswerImages((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_ANSWER_IMAGES_STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        /* localStorage unavailable — keep in-memory state */
      }
      return next;
    });
  }, []);

  const [showNextAnswer, setShowNextAnswer] = useState<boolean>(readStoredShowNextAnswer);

  const toggleShowNextAnswer = useCallback(() => {
    setShowNextAnswer((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_NEXT_ANSWER_STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        /* localStorage unavailable — keep in-memory state */
      }
      return next;
    });
  }, []);

  // Announce this tab as a GM client so the server can broadcast
  // `gm-presence: connected=true` to the show. Re-announces on every
  // reconnect so a server restart still ends with the show knowing a GM
  // is here.
  useEffect(() => {
    sendWsControl('gm-register');
    return onWsOpen(() => sendWsControl('gm-register'));
  }, []);

  // When embedded in an iframe (e.g. /admin#answers), drop the body's own
  // animated gradient so the parent admin gradient shows through seamlessly.
  useEffect(() => {
    const embedded = window.self !== window.top;
    if (!embedded) return;
    document.body.classList.add('gamemaster-embedded');
    document.documentElement.classList.add('gamemaster-embedded');
    return () => {
      document.body.classList.remove('gamemaster-embedded');
      document.documentElement.classList.remove('gamemaster-embedded');
    };
  }, []);

  // Mirror useKeyboardNavigation + Bandle long-press from the game frontend:
  // ArrowRight short press / Space / click → nav-forward
  // ArrowRight long press (500ms) → nav-forward-long (Bandle: reveal answer)
  // ArrowLeft → nav-back
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let arrowRightHeld = false;
    let longPressTriggered = false;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input') || target.closest('textarea')) return;

      // preventDefault for these three keys regardless of lock state — otherwise
      // Space would scroll the page when the gamemaster has the show locked.
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (lockedRef.current) return;
        if (arrowRightHeld) return; // ignore key repeat
        arrowRightHeld = true;
        longPressTriggered = false;
        timer = setTimeout(() => {
          if (lockedRef.current) {
            timer = null;
            return;
          }
          longPressTriggered = true;
          sendCommand('nav-forward-long');
          timer = null;
        }, 500);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (lockedRef.current) return;
        sendCommand('nav-forward');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (lockedRef.current) return;
        sendCommand('nav-back');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight') return;
      const wasHeld = arrowRightHeld;
      arrowRightHeld = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (lockedRef.current) {
        longPressTriggered = false;
        return;
      }
      if (wasHeld && !longPressTriggered) {
        sendCommand('nav-forward');
      }
      longPressTriggered = false;
    };

    const onClick = (e: MouseEvent) => {
      if (lockedRef.current) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('a') ||
        target.closest('[role="button"]') ||
        target.closest('img')
      ) {
        return;
      }
      sendCommand('nav-forward');
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('click', onClick);
      if (timer) clearTimeout(timer);
    };
  }, [sendCommand]);

  return (
    <div className="gamemaster-screen">
      <div className="gm-toolbar">
        <div className="gm-toggle-group">
          <LockToggleButton locked={locked} onToggle={toggleLock} />
          <AnswerImagesToggleButton showing={showAnswerImages} onToggle={toggleShowAnswerImages} />
          <NextAnswerToggleButton showing={showNextAnswer} onToggle={toggleShowNextAnswer} />
          <HoldToggleButton />
        </div>
        <FullscreenToggleButton />
        <DeadlineButtons />
        <ScrollButtons />
      </div>
      <GamemasterView showAnswerImages={showAnswerImages} showNextAnswer={showNextAnswer} />
      {!gameActive && <InstallButton variant="gamemaster" label="Gamemaster installieren" />}
    </div>
  );
}

function HoldToggleButton() {
  // Panic/pause hold: drops a full-screen "Gleich geht's weiter" over the
  // projector. Reflects + drives the cached `show-hold` channel so the button
  // state stays correct across GM reloads. See specs/gamemaster-cockpit.md.
  const [active, setActive] = useState(false);
  useWsChannel<ShowHoldState | null>('show-hold', (next) => setActive(next?.active ?? false));
  const toggle = () => {
    const next = !active;
    setActive(next);
    sendWs('show-hold', { active: next });
  };
  return (
    <button
      type="button"
      className={`gm-hold-toggle${active ? ' gm-hold-toggle--active' : ''}`}
      onClick={toggle}
      aria-pressed={active}
      title={active ? 'Pausen-Bildschirm auf der Show ausblenden.' : 'Pausen-Bildschirm über die Show legen (für Pausen / Klärungen).'}
    >
      {active ? 'Pause beenden' : 'Pause-Bildschirm'}
    </button>
  );
}

function LockToggleButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`gm-lock-toggle${locked ? ' gm-lock-toggle--locked' : ''}`}
      onClick={onToggle}
      aria-pressed={locked}
      title={
        locked
          ? 'Klick- und Tastatursteuerung der Show ist gesperrt. Klicken zum Entsperren.'
          : 'Klicks und Tasten in der Gamemaster-Ansicht sperren, damit nichts versehentlich weitergeschaltet wird. Weiter/Zurück bleiben aktiv.'
      }
    >
      {locked ? 'Steuerung gesperrt' : 'Steuerung sperren'}
    </button>
  );
}

function AnswerImagesToggleButton({ showing, onToggle }: { showing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`gm-images-toggle${showing ? ' gm-images-toggle--showing' : ''}`}
      onClick={onToggle}
      aria-pressed={showing}
      title={
        showing
          ? 'Antwort-Bilder werden angezeigt. Klicken zum Ausblenden.'
          : 'Antwort-Bilder sind ausgeblendet. Klicken zum Einblenden.'
      }
    >
      {showing ? 'Bilder ausblenden' : 'Bilder einblenden'}
    </button>
  );
}

// Inverted highlight vs. the other toggles: the next-answer preview is ON by
// default (the unhighlighted resting state), so the button only lights up once
// the host has actively SUPPRESSED it. Highlight ⟺ preview hidden.
function NextAnswerToggleButton({ showing, onToggle }: { showing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`gm-next-toggle${showing ? '' : ' gm-next-toggle--hidden'}`}
      onClick={onToggle}
      aria-pressed={!showing}
      title={
        showing
          ? 'Die nächste Frage samt Antwort wird beim Auflösen mit angezeigt. Klicken zum Ausblenden.'
          : 'Die nächste Frage ist ausgeblendet. Klicken zum Einblenden.'
      }
    >
      {showing ? 'Nächste Frage ausblenden' : 'Nächste Frage einblenden'}
    </button>
  );
}

// Toolbar-local toggle that opens/closes the fullscreen overlay on the show.
// Rendered between the toggle cluster and the countdown. Shown only while the
// show reports it is displaying enlargeable media (`fullscreenAvailable`).
// See [specs/gamemaster-fullscreen.md](../../specs/gamemaster-fullscreen.md).
function FullscreenToggleButton() {
  const controls = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();
  if (controls?.phase !== 'game' || !controls?.fullscreenAvailable) return null;
  const open = controls?.fullscreenOpen ?? false;
  return (
    <button
      type="button"
      className={`gm-fullscreen-toggle${open ? ' gm-fullscreen-toggle--active' : ''}`}
      onClick={() => sendCommand('toggle-fullscreen')}
      aria-pressed={open}
      title={open ? 'Vollbild auf der Show schließen' : 'Aktuelles Bild/Video auf der Show als Vollbild anzeigen'}
    >
      {open ? 'Vollbild schließen' : 'Vollbild'}
    </button>
  );
}

const DEADLINE_DURATIONS = [5, 10, 30, 60, 90, 120] as const;

function DeadlineButtons() {
  const controls = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();
  const phase = controls?.phase;
  // `timerActive` covers both the GM deadline AND the per-question `q.timer`
  // so the Pause/Resume button is available for either kind of running timer.
  const timerActive = controls?.timerActive ?? false;
  const timerPaused = controls?.timerPaused ?? false;
  const answerRevealed = controls?.answerRevealed ?? false;
  const enabled = phase === 'game';
  // Mirror the show's absolute deadline on the GM (silent — only the projector
  // makes sound). Correct on reconnect because it's broadcast as an absolute
  // timestamp, not a local counter.
  const deadlineEndsAt = controls?.deadlineEndsAt ?? null;
  const deadlineTotalSeconds = controls?.deadlineTotalSeconds ?? 0;

  // Hide the entire row once the answer is revealed, or when no control here
  // is actionable (no question on screen and no running timer to pause/stop).
  if (answerRevealed) return null;
  if (!enabled && !timerActive) return null;

  return (
    <div className="gm-deadline-group" role="group" aria-label="Deadline-Timer">
      {enabled && (
        <div className="gm-deadline-durations" role="group" aria-label="Countdown-Dauer wählen">
          <div className="gm-deadline-durations-label">Countdown</div>
          <div className="gm-deadline-durations-grid">
            {DEADLINE_DURATIONS.map(secs => (
              <button
                key={secs}
                type="button"
                className="gm-deadline-segment"
                onClick={() => sendCommand(`deadline-${secs}`)}
                title={`Countdown von ${secs} Sekunden starten`}
              >
                {secs}s
              </button>
            ))}
          </div>
        </div>
      )}
      {deadlineEndsAt !== null && (
        <div className="gm-deadline-ring" aria-label="Verbleibende Zeit">
          <DeadlineTimer endsAt={deadlineEndsAt} totalSeconds={deadlineTotalSeconds} paused={timerPaused} silent />
        </div>
      )}
      {timerActive && (
        <>
          {deadlineEndsAt !== null && (
            <button
              type="button"
              className="gm-deadline-btn gm-deadline-btn--extend"
              onClick={() => sendCommand('deadline-extend')}
              title="10 Sekunden hinzufügen"
            >
              +10s
            </button>
          )}
          <button
            type="button"
            className={`gm-deadline-btn${timerPaused ? '' : ' gm-deadline-btn--pause'}`}
            onClick={() => sendCommand(timerPaused ? 'timer-resume' : 'timer-pause')}
            title={timerPaused ? 'Timer fortsetzen' : 'Timer pausieren'}
          >
            {timerPaused ? 'Weiter' : 'Pause'}
          </button>
          <button
            type="button"
            className="gm-deadline-btn gm-deadline-btn--stop"
            onClick={() => sendCommand('timer-stop')}
            title="Timer komplett entfernen"
          >
            Stop
          </button>
        </>
      )}
    </div>
  );
}

// Jump-to-scroll-point buttons. The show reports which anchors are currently
// reachable (only while its card overflows the viewport) via `scrollAnchors`;
// we render one button per anchor and emit a `scroll-to:<id>` command that
// `BaseGameWrapper` applies as a window scroll on the show.
const SCROLL_ANCHOR_META: Record<string, { label: string; title: string }> = {
  top: { label: '⤒ Anfang', title: 'Ganz nach oben scrollen' },
  answer: { label: 'Antwort', title: 'Zur Antwort scrollen' },
  bottom: { label: '⤓ Ende', title: 'Ganz nach unten scrollen' },
};

function ScrollButtons() {
  const controls = useGamemasterControls();
  const sendCommand = useSendGamemasterCommand();
  const anchors = controls?.scrollAnchors ?? [];
  if (controls?.phase !== 'game' || anchors.length === 0) return null;

  return (
    <div className="gm-scroll-group" role="group" aria-label="Show scrollen">
      <div className="gm-scroll-label">Scrollen</div>
      <div className="gm-scroll-grid">
        {anchors.map(anchor => {
          const meta = SCROLL_ANCHOR_META[anchor];
          if (!meta) return null;
          return (
            <button
              key={anchor}
              type="button"
              className="gm-scroll-btn"
              onClick={() => sendCommand(`scroll-to:${anchor}`)}
              title={meta.title}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
