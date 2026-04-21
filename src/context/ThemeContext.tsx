import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { fetchTheme, saveTheme } from '@/services/api';

export type ThemeId = 'galaxia' | 'harry-potter' | 'dnd' | 'arctic' | 'enterprise' | 'retro' | 'minecraft';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'galaxia', label: 'Galaxia', description: 'Kosmisch & modern' },
  { id: 'harry-potter', label: 'Harry Potter', description: 'Magisch & geheimnisvoll' },
  { id: 'dnd', label: 'D&D', description: 'Dungeon & Abenteuer' },
  { id: 'arctic', label: 'Arctic', description: 'Kühl & minimalistisch' },
  { id: 'enterprise', label: 'Enterprise', description: 'Seriös & professionell' },
  { id: 'retro', label: 'Retro', description: '8-Bit & Pixel-Optik' },
  { id: 'minecraft', label: 'Minecraft', description: 'Blocky Überwelt' },
];

const DEFAULT_THEME: ThemeId = 'galaxia';
const VALID_THEMES = new Set<string>(THEMES.map(t => t.id));
const LS_FRONTEND_KEY = 'gameshow-theme';
const LS_ADMIN_KEY = 'gameshow-theme-admin';

function readCachedTheme(key: string): ThemeId {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return v && VALID_THEMES.has(v) ? (v as ThemeId) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeCachedTheme(key: string, id: ThemeId): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, id);
  } catch { /* ignore */ }
}

// Only update the cache from server fetches if the user already has a cached
// value (i.e. picked a theme before on this device) AND the server disagrees.
// This avoids polluting localStorage for devices that never set a theme while
// still keeping the cache in sync when the user changes themes on another tab.
function syncCachedThemeFromServer(key: string, id: ThemeId): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cached = localStorage.getItem(key);
    if (cached === null) return;
    if (cached === id) return;
    localStorage.setItem(key, id);
  } catch { /* ignore */ }
}

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
  const [theme, setThemeState] = useState<ThemeId>(() => readCachedTheme(LS_FRONTEND_KEY));
  const [adminTheme, setAdminThemeState] = useState<ThemeId>(() => readCachedTheme(LS_ADMIN_KEY));
  const [gameThemeOverride, setGameThemeOverrideState] = useState<ThemeId | null>(null);

  const activeTheme = gameThemeOverride ?? theme;

  // Sync from server after mount — cached value is used for the initial paint
  // to avoid flashing the default theme before the fetch resolves.
  useEffect(() => {
    fetchTheme()
      .then(settings => {
        if (VALID_THEMES.has(settings.frontend)) {
          setThemeState(settings.frontend as ThemeId);
          syncCachedThemeFromServer(LS_FRONTEND_KEY, settings.frontend as ThemeId);
        }
        if (VALID_THEMES.has(settings.admin)) {
          setAdminThemeState(settings.admin as ThemeId);
          syncCachedThemeFromServer(LS_ADMIN_KEY, settings.admin as ThemeId);
        }
      })
      .catch(() => { /* use cached/defaults */ });
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
    writeCachedTheme(LS_FRONTEND_KEY, id);
    saveTheme({ frontend: id }).catch(() => { /* ignore */ });
  }, [triggerTransition]);

  const setAdminTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setAdminThemeState(id);
    writeCachedTheme(LS_ADMIN_KEY, id);
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

/** Safe accessor for consumers that need to read the current frontend theme id
 *  without requiring a ThemeProvider above them (e.g. background music hook in
 *  test harnesses). Returns the default theme when no provider is present. */
export function useCurrentFrontendTheme(): ThemeId {
  const ctx = useContext(ThemeContext);
  return ctx?.theme ?? DEFAULT_THEME;
}
