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
      if (e.key === 'ArrowRight') {
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
