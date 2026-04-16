import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { fetchTheme, saveTheme } from '@/services/api';

export type ThemeId = 'galaxia' | 'harry-potter' | 'dnd' | 'arctic' | 'enterprise';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'galaxia', label: 'Galaxia', description: 'Kosmisch & modern' },
  { id: 'harry-potter', label: 'Harry Potter', description: 'Magisch & geheimnisvoll' },
  { id: 'dnd', label: 'D&D', description: 'Dungeon & Abenteuer' },
  { id: 'arctic', label: 'Arctic', description: 'Kühl & minimalistisch' },
  { id: 'enterprise', label: 'Enterprise', description: 'Seriös & professionell' },
];

const DEFAULT_THEME: ThemeId = 'galaxia';
const VALID_THEMES = new Set<string>(THEMES.map(t => t.id));

interface ThemeContextValue {
  /** Frontend (game-facing) theme — applied on <html> */
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** Admin theme — applied on .admin-shell via ref */
  adminTheme: ThemeId;
  setAdminTheme: (id: ThemeId) => void;
  /** Temporary per-game theme override (not persisted). Set to null to clear.
   *  Pass immediate=true to skip the animation (e.g. on initial page load). */
  setGameThemeOverride: (id: ThemeId | null, immediate?: boolean) => void;
  /** The currently active frontend theme (gameThemeOverride ?? theme) */
  activeTheme: ThemeId;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [adminTheme, setAdminThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [gameThemeOverride, setGameThemeOverrideState] = useState<ThemeId | null>(null);

  const activeTheme = gameThemeOverride ?? theme;

  // Load initial theme from server
  useEffect(() => {
    fetchTheme()
      .then(settings => {
        if (VALID_THEMES.has(settings.frontend)) setThemeState(settings.frontend as ThemeId);
        if (VALID_THEMES.has(settings.admin)) setAdminThemeState(settings.admin as ThemeId);
      })
      .catch(() => { /* use defaults */ });
  }, []);

  // Apply frontend theme on <html> (respects game override)
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
  }, [activeTheme]);

  const triggerTransition = useCallback(() => {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 1000);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setThemeState(id);
    saveTheme({ frontend: id }).catch(() => { /* ignore */ });
  }, [triggerTransition]);

  const setAdminTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setAdminThemeState(id);
    saveTheme({ admin: id }).catch(() => { /* ignore */ });
  }, [triggerTransition]);

  const setGameThemeOverride = useCallback((id: ThemeId | null, immediate?: boolean) => {
    if (id !== null && !VALID_THEMES.has(id)) return;

    // Skip animation if the effective theme wouldn't change
    const current = gameThemeOverride ?? theme;
    const next = id ?? theme;
    if (immediate || current === next) {
      setGameThemeOverrideState(id);
      return;
    }

    // Pulse animation: content fades out → theme switches at midpoint → fades back in
    const el = document.documentElement;
    el.classList.add('theme-transitioning', 'game-theme-switching');

    // Switch theme at 35% (when content is invisible)
    setTimeout(() => setGameThemeOverrideState(id), 315);

    // Clean up classes after animation completes
    setTimeout(() => el.classList.remove('theme-transitioning', 'game-theme-switching'), 900);
  }, [gameThemeOverride, theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, adminTheme, setAdminTheme, setGameThemeOverride, activeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
