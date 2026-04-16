import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type ThemeId = 'galaxia' | 'retro' | 'arctic' | 'enterprise';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'galaxia', label: 'Galaxia', description: 'Kosmisch & modern' },
  { id: 'retro', label: 'Retro', description: 'Warm & klassisch' },
  { id: 'arctic', label: 'Arctic', description: 'Kühl & minimalistisch' },
  { id: 'enterprise', label: 'Enterprise', description: 'Seriös & professionell' },
];

const STORAGE_KEY_FRONTEND = 'gameshow-theme';
const STORAGE_KEY_ADMIN = 'gameshow-theme-admin';
const DEFAULT_THEME: ThemeId = 'galaxia';
const VALID_THEMES = new Set<string>(THEMES.map(t => t.id));

function readStored(key: string): ThemeId {
  try {
    const stored = localStorage.getItem(key);
    if (stored && VALID_THEMES.has(stored)) return stored as ThemeId;
  } catch { /* localStorage may be unavailable */ }
  return DEFAULT_THEME;
}

interface ThemeContextValue {
  /** Frontend (game-facing) theme — applied on <html> */
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** Admin theme — applied on .admin-shell via ref */
  adminTheme: ThemeId;
  setAdminTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => readStored(STORAGE_KEY_FRONTEND));
  const [adminTheme, setAdminThemeState] = useState<ThemeId>(() => readStored(STORAGE_KEY_ADMIN));

  // Apply frontend theme on <html>
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const triggerTransition = useCallback(() => {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 600);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setThemeState(id);
    try { localStorage.setItem(STORAGE_KEY_FRONTEND, id); } catch { /* ignore */ }
  }, [triggerTransition]);

  const setAdminTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setAdminThemeState(id);
    try { localStorage.setItem(STORAGE_KEY_ADMIN, id); } catch { /* ignore */ }
  }, [triggerTransition]);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_FRONTEND && e.newValue && VALID_THEMES.has(e.newValue)) {
        setThemeState(e.newValue as ThemeId);
      }
      if (e.key === STORAGE_KEY_ADMIN && e.newValue && VALID_THEMES.has(e.newValue)) {
        setAdminThemeState(e.newValue as ThemeId);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, adminTheme, setAdminTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
