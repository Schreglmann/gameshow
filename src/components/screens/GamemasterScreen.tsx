import { useCallback, useEffect, useRef, useState } from 'react';
import { useGamemasterAnswer, useGamemasterControls, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { onWsOpen, sendWsControl } from '@/services/useBackendSocket';
import GamemasterView from '@/components/common/GamemasterView';
import InstallButton from '@/components/common/InstallButton';

const LOCK_STORAGE_KEY = 'gm-input-locked';
const SHOW_ANSWER_IMAGES_STORAGE_KEY = 'gm-show-answer-images';

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
        <LockToggleButton locked={locked} onToggle={toggleLock} />
        <AnswerImagesToggleButton showing={showAnswerImages} onToggle={toggleShowAnswerImages} />
        <DeadlineButtons />
      </div>
      <GamemasterView showAnswerImages={showAnswerImages} />
      {!gameActive && <InstallButton variant="gamemaster" label="Gamemaster installieren" />}
    </div>
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

const DEADLINE_DURATIONS = [5, 10, 30, 60] as const;

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

  // Hide the entire row once the answer is revealed — a countdown is
  // meaningless after the players see the solution.
  if (answerRevealed) return null;

  return (
    <div className="gm-deadline-group" role="group" aria-label="Deadline-Timer">
      {DEADLINE_DURATIONS.map(secs => (
        <button
          key={secs}
          type="button"
          className="gm-deadline-btn"
          disabled={!enabled}
          onClick={() => sendCommand(`deadline-${secs}`)}
          title={enabled
            ? `Deadline-Timer von ${secs} Sekunden starten`
            : 'Deadline-Timer ist nur während einer Frage verfügbar'}
        >
          {secs}s
        </button>
      ))}
      {timerActive && (
        <>
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
