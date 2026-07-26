import { useEffect, useCallback } from 'react';

interface KeyboardNavigationOptions {
  onNext: () => void;
  onBack?: () => void;
  enabled?: boolean;
}

/**
 * Maps ArrowRight / click -> next, ArrowLeft -> back.
 * Clicks on buttons, inputs, and interactive elements are excluded.
 */
export function useKeyboardNavigation({
  onNext,
  onBack,
  enabled = true,
}: KeyboardNavigationOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      // Don't advance game when lightbox is open
      if (document.getElementById('imageLightbox')) return;
      // Never navigate while the host is typing. The click handler below has
      // always excluded interactive elements, but the key handler did not — so
      // pressing ArrowLeft to fix a digit in a GuessingGame tip field called
      // preventDefault() and onBack(). GuessingGame registers no backNavHandler,
      // so BaseGameWrapper fell through to setPhase('rules'): the projector
      // jumped out of the question and both teams' entered guesses were lost.
      // Space is worse still — it advanced the game mid-word.
      // Matches the guard in useArrowRightLongPress.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && onBack) {
        e.preventDefault();
        onBack();
      }
    },
    [onNext, onBack, enabled]
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;
      const target = e.target as HTMLElement;
      // Don't trigger navigation for interactive elements
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('a') ||
        target.closest('[role="button"]') ||
        target.closest('.music-controls') ||
        target.closest('.bandle-player') ||
        target.closest('#imageLightbox') ||
        target.closest('img')
      ) {
        return;
      }
      onNext();
    },
    [onNext, enabled]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, [handleKeyDown, handleClick]);
}
