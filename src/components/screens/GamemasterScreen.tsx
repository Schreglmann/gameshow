import { useCallback, useEffect, useRef, useState } from 'react';
import { useGamemasterAnswer, useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import GamemasterView from '@/components/common/GamemasterView';
import InstallButton from '@/components/common/InstallButton';

const LOCK_STORAGE_KEY = 'gm-input-locked';

function readStoredLock(): boolean {
  try {
    return localStorage.getItem(LOCK_STORAGE_KEY) === 'true';
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
      <LockToggleButton locked={locked} onToggle={toggleLock} />
      <GamemasterView />
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
