import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { fetchTheme, saveTheme } from '@/services/api';

export type ThemeId = 'galaxia' | 'harry-potter' | 'dnd' | 'arctic' | 'enterprise' | 'retro' | 'minecraft' | 'classical-music' | 'modern-music';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'galaxia', label: 'Galaxia', description: 'Kosmisch & modern' },
  { id: 'harry-potter', label: 'Harry Potter', description: 'Magisch & geheimnisvoll' },
  { id: 'dnd', label: 'D&D', description: 'Dungeon & Abenteuer' },
  { id: 'arctic', label: 'Arctic', description: 'Kühl & minimalistisch' },
  { id: 'enterprise', label: 'Enterprise', description: 'Seriös & professionell' },
  { id: 'retro', label: 'Retro', description: '8-Bit & Pixel-Optik' },
  { id: 'minecraft', label: 'Minecraft', description: 'Blocky Überwelt' },
  { id: 'classical-music', label: 'Classical Music', description: 'Notenblatt & Konzertsaal' },
  { id: 'modern-music', label: 'Modern Music', description: 'Neon & DJ-Booth' },
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

export function ThemeProvider({ children, rootTheme = 'frontend' }: { children: ReactNode; rootTheme?: 'frontend' | 'admin' }) {
  const [theme, setThemeState] = useState<ThemeId>(() => readCachedTheme(LS_FRONTEND_KEY));
  const [adminTheme, setAdminThemeState] = useState<ThemeId>(() => readCachedTheme(LS_ADMIN_KEY));
  const [gameThemeOverride, setGameThemeOverrideState] = useState<ThemeId | null>(null);
  const overrideAnimRef = useRef<{
    switchTimer: number | null;
    classTimer: number | null;
    pendingTarget: ThemeId | null;
  } | null>(null);

  const activeTheme = gameThemeOverride ?? theme;
  const htmlTheme = rootTheme === 'admin' ? adminTheme : activeTheme;

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

  // Apply theme on <html>. Frontend entries use the frontend theme (respecting game override);
  // admin entry uses the admin theme — otherwise the frontend theme's atmosphere layers
  // (clouds, horizon, stars) would leak onto the admin page from html[data-theme].
  useEffect(() => {
    document.documentElement.dataset.theme = htmlTheme;
  }, [htmlTheme]);

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

    const el = document.documentElement;

    // Skip animation if the effective theme wouldn't change
    const current = gameThemeOverride ?? theme;
    const next = id ?? theme;
    if (immediate || current === next) {
      if (overrideAnimRef.current) {
        if (overrideAnimRef.current.switchTimer) clearTimeout(overrideAnimRef.current.switchTimer);
        if (overrideAnimRef.current.classTimer) clearTimeout(overrideAnimRef.current.classTimer);
        overrideAnimRef.current = null;
        el.classList.remove('theme-transitioning', 'game-theme-switching');
      }
      setGameThemeOverrideState(id);
      return;
    }

    // Coalesce back-to-back override changes (e.g. an unmount cleanup
    // setting null immediately followed by the next game's mount setting B):
    // run a single pulse and let the latest target win, so the pulse never
    // briefly lands on the persisted theme between two overrides.
    if (overrideAnimRef.current) {
      overrideAnimRef.current.pendingTarget = id;
      return;
    }

    // Pulse animation: content fades out → theme switches at midpoint → fades back in
    el.classList.add('theme-transitioning', 'game-theme-switching');

    const ref: { switchTimer: number | null; classTimer: number | null; pendingTarget: ThemeId | null } = {
      switchTimer: null,
      classTimer: null,
      pendingTarget: id,
    };
    overrideAnimRef.current = ref;

    ref.switchTimer = window.setTimeout(() => {
      setGameThemeOverrideState(ref.pendingTarget);
      ref.switchTimer = null;
    }, 315);

    ref.classTimer = window.setTimeout(() => {
      el.classList.remove('theme-transitioning', 'game-theme-switching');
      ref.classTimer = null;
      if (overrideAnimRef.current === ref) overrideAnimRef.current = null;
    }, 900);
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

/** Safe accessor for consumers that need to read the currently-active frontend
 *  theme id (including any per-game override) without requiring a ThemeProvider
 *  above them (e.g. background music hook in test harnesses). Returns the
 *  default theme when no provider is present. */
export function useCurrentFrontendTheme(): ThemeId {
  const ctx = useContext(ThemeContext);
  return ctx?.activeTheme ?? DEFAULT_THEME;
}
