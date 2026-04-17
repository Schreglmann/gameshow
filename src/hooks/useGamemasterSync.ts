import { useState, useEffect, useCallback, useRef } from 'react';
import type { GamemasterAnswerData, GamemasterControl, GamemasterControlsData, GamemasterCommand } from '@/types/game';

const STORAGE_KEY = 'gamemasterAnswer';
const CONTROLS_KEY = 'gamemasterControls';
const COMMAND_KEY = 'gamemasterCommand';

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

// ── Controls channel (game → gamemaster) ──

/**
 * Writer hook: broadcasts available controls to the gamemaster screen via localStorage.
 * Call with `null` when no controls are active.
 */
export function useGamemasterControlsSync(
  controls: GamemasterControl[] | null,
  phase?: 'landing' | 'rules' | 'game' | 'points',
  gameIndex?: number,
): void {
  const serialized = JSON.stringify(controls ? { controls, phase, gameIndex } : null);

  useEffect(() => {
    localStorage.setItem(CONTROLS_KEY, serialized);
  }, [serialized]);

  useEffect(() => {
    const clear = () => localStorage.setItem(CONTROLS_KEY, 'null');
    window.addEventListener('beforeunload', clear);
    return () => {
      window.removeEventListener('beforeunload', clear);
      clear();
    };
  }, []);
}

/**
 * Reader hook: returns the current controls data from the game tab.
 * Returns `null` when no controls are active.
 */
export function useGamemasterControls(): GamemasterControlsData | null {
  const [data, setData] = useState<GamemasterControlsData | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(CONTROLS_KEY) || 'null');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === CONTROLS_KEY) {
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

// ── Command channel (gamemaster → game) ──

/**
 * Returns a function to send commands from the gamemaster to the game tab.
 */
export function useSendGamemasterCommand(): (controlId: string, value?: string | Record<string, string>) => void {
  return useCallback((controlId: string, value?: string | Record<string, string>) => {
    const cmd: GamemasterCommand = { controlId, value, timestamp: Date.now() };
    localStorage.setItem(COMMAND_KEY, JSON.stringify(cmd));
  }, []);
}

/**
 * Listener hook: watches for commands from the gamemaster tab.
 * Uses timestamp-based deduplication to prevent double-execution.
 */
export function useGamemasterCommandListener(handler: (cmd: GamemasterCommand) => void): void {
  const lastTimestampRef = useRef(0);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== COMMAND_KEY || !e.newValue) return;
      try {
        const cmd: GamemasterCommand = JSON.parse(e.newValue);
        if (cmd.timestamp > lastTimestampRef.current) {
          lastTimestampRef.current = cmd.timestamp;
          handlerRef.current(cmd);
        }
      } catch {
        // ignore malformed commands
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
