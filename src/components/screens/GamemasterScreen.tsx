import { useEffect } from 'react';
import { useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import GamemasterView from '@/components/common/GamemasterView';

export default function GamemasterScreen() {
  const sendCommand = useSendGamemasterCommand();

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

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (arrowRightHeld) return; // ignore key repeat
        arrowRightHeld = true;
        longPressTriggered = false;
        timer = setTimeout(() => {
          longPressTriggered = true;
          sendCommand('nav-forward-long');
          timer = null;
        }, 500);
      } else if (e.key === ' ') {
        e.preventDefault();
        sendCommand('nav-forward');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
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
      if (wasHeld && !longPressTriggered) {
        sendCommand('nav-forward');
      }
      longPressTriggered = false;
    };

    const onClick = (e: MouseEvent) => {
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
      <GamemasterView />
    </div>
  );
}
