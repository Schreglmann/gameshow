import { useState, useEffect } from 'react';
import type { GamemasterAnswerData } from '@/types/game';

const STORAGE_KEY = 'gamemasterAnswer';

/**
 * Writer hook: broadcasts current answer data to the gamemaster screen via localStorage.
 * Call with `null` when no question is active.
 */
export function useGamemasterSync(data: GamemasterAnswerData | null): void {
  const serialized = JSON.stringify(data);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, serialized);
  }, [serialized]);

  useEffect(() => {
    const clear = () => localStorage.setItem(STORAGE_KEY, 'null');
    window.addEventListener('beforeunload', clear);
    return () => {
      window.removeEventListener('beforeunload', clear);
      clear();
    };
  }, []);
}

/**
 * Reader hook: returns the current answer data from the game tab.
 * Returns `null` when no question is active.
 */
export function useGamemasterAnswer(): GamemasterAnswerData | null {
  const [data, setData] = useState<GamemasterAnswerData | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          setData(JSON.parse(e.newValue || 'null'));
        } catch {
          setData(null);
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return data;
}
