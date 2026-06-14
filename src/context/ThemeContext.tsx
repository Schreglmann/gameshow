import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { fetchTheme, saveTheme } from '@/services/api';
import { useWsChannel } from '@/services/useBackendSocket';
import type { ContentChangedPayload } from '@/types/config';

export type ThemeId = 'galaxia' | 'harry-potter' | 'dnd' | 'deepsea' | 'enterprise' | 'retro' | 'minecraft' | 'classical-music' | 'modern-music' | 'movie-quiz' | 'atlas' | 'atlas-light';

export const THEMES: { id: ThemeId; label: string; description: string }[] = [
  { id: 'atlas', label: 'Atlas', description: 'Seekarte in Tiefblau & Gold' },
  { id: 'atlas-light', label: 'Atlas Light', description: 'Helle Seekarte in Elfenbein & Gold' },
  { id: 'galaxia', label: 'Galaxia', description: 'Kosmisch & modern' },
  { id: 'harry-potter', label: 'Harry Potter', description: 'Magisch & geheimnisvoll' },
  { id: 'dnd', label: 'D&D', description: 'Dungeon & Abenteuer' },
  { id: 'deepsea', label: 'Tiefsee', description: 'Biolumineszenz & Lichtstrahlen' },
  { id: 'enterprise', label: 'Enterprise', description: 'Seriös & professionell' },
  { id: 'retro', label: 'Retro', description: '8-Bit & Pixel-Optik' },
  { id: 'minecraft', label: 'Minecraft', description: 'Blocky Überwelt' },
  { id: 'classical-music', label: 'Classical Music', description: 'Notenblatt & Konzertsaal' },
  { id: 'modern-music', label: 'Modern Music', description: 'Neon & DJ-Booth' },
  { id: 'movie-quiz', label: 'Filme', description: 'Kino & roter Teppich' },
];

// Swatch gradient shown as each theme's "color icon" in the admin theme picker
// and the theme-showcase rows. Each is a 3-stop diagonal (base → primary accent
// → signature pop) tuned to the theme's real CSS palette (src/styles/themes.css),
// so the icon previews the actual background + accent + signature colour rather
// than two near-identical background tones. Order matters: stop 1 is the canvas,
// stop 2 the main accent, stop 3 the brightest signature colour.
export const THEME_SWATCHES: Record<ThemeId, string> = {
  atlas: 'linear-gradient(135deg, #0f1f44 0%, #15346e 48%, #ffd45e 100%)',
  'atlas-light': 'linear-gradient(135deg, #efe6cf 0%, #d8a23a 52%, #1a2b55 100%)',
  galaxia: 'linear-gradient(135deg, #4a5bc4 0%, #5a3585 50%, #d84898 100%)',
  'harry-potter': 'linear-gradient(135deg, #1c0b2e 0%, #2a0e3a 46%, #d4af37 100%)',
  dnd: 'linear-gradient(135deg, #15110a 0%, #8b0000 55%, #daa520 100%)',
  enterprise: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #3b82f6 100%)',
  retro: 'linear-gradient(135deg, #1a0538 0%, #d52b1e 50%, #f8b500 100%)',
  minecraft: 'linear-gradient(135deg, #7cb9ff 0%, #5fb932 55%, #fcee4b 100%)',
  'classical-music': 'linear-gradient(135deg, #f4ecd8 0%, #b8941f 50%, #7a1a2e 100%)',
  'modern-music': 'linear-gradient(135deg, #0a0a14 0%, #ff00aa 50%, #00e5ff 100%)',
  'movie-quiz': 'linear-gradient(135deg, #1a0a0d 0%, #e0a008 55%, #f5c518 100%)',
  deepsea: 'linear-gradient(135deg, #021a26 0%, #0ea5e9 55%, #2dd4bf 100%)',
};

// The admin UI offers only a curated subset of themes — the immersive themes
// (Retro, Minecraft, etc.) only apply their palette in the admin (no atmosphere)
// and make a poor CMS work surface. The frontend (gameshow) keeps all THEMES.
// Atlas qualifies: its atmosphere is calm + static (navy + paper grain +
// vignette) and its full --admin-* token family is defined on :root.
// Atlas Light qualifies for the same reasons (calm static ivory atmosphere,
// full light --admin-* family) — it exists for bright environments.
export const ADMIN_THEME_IDS: ThemeId[] = ['atlas', 'atlas-light', 'galaxia', 'deepsea', 'enterprise'];
export const ADMIN_THEMES = THEMES.filter(t => ADMIN_THEME_IDS.includes(t.id));

const DEFAULT_THEME: ThemeId = 'atlas';
// Atlas is in the admin subset, so the admin default matches the app-wide
// default; a saved admin theme outside the subset also falls back here.
const DEFAULT_ADMIN_THEME: ThemeId = 'atlas';
const VALID_THEMES = new Set<string>(THEMES.map(t => t.id));
const VALID_ADMIN_THEMES = new Set<string>(ADMIN_THEME_IDS);
const LS_FRONTEND_KEY = 'gameshow-theme';
const LS_ADMIN_KEY = 'gameshow-theme-admin';

function readCachedTheme(key: string, valid: Set<string> = VALID_THEMES, fallback: ThemeId = DEFAULT_THEME): ThemeId {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return v && valid.has(v) ? (v as ThemeId) : fallback;
  } catch {
    return fallback;
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
  const [adminTheme, setAdminThemeState] = useState<ThemeId>(() => readCachedTheme(LS_ADMIN_KEY, VALID_ADMIN_THEMES, DEFAULT_ADMIN_THEME));
  const [gameThemeOverride, setGameThemeOverrideState] = useState<ThemeId | null>(null);
  const overrideAnimRef = useRef<{
    switchTimer: number | null;
    classTimer: number | null;
    pendingTarget: ThemeId | null;
  } | null>(null);

  const activeTheme = gameThemeOverride ?? theme;
  const htmlTheme = rootTheme === 'admin' ? adminTheme : activeTheme;

  // Latest values for the live-sync handler to read without re-creating the
  // callback (which would otherwise re-run the mount fetch effect).
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const adminThemeRef = useRef(adminTheme);
  adminThemeRef.current = adminTheme;
  const gameOverrideRef = useRef(gameThemeOverride);
  gameOverrideRef.current = gameThemeOverride;

  const triggerTransition = useCallback(() => {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 1000);
  }, []);

  // Live theme swap (from `content-changed`): dim the page to near-black and
  // back (the `theme-reload-pulse` filter animation) while the swap happens
  // under the darkness. The `filter: brightness()` animation forces WebKit/
  // Safari (the iPad gamemaster) to re-rasterize the atmosphere ::before/::after
  // layers and the custom-property colors — a plain `data-theme` swap, a reflow,
  // or a `theme-transitioning` colour cross-fade do NOT, so the previous theme's
  // colours lingered until a manual reload. Dimming to dark (not fading to
  // transparent like the per-game pulse) avoids flashing the bright white canvas.
  const repaintPulse = useCallback(() => {
    const el = document.documentElement;
    el.classList.add('theme-reload-pulse');
    window.setTimeout(() => el.classList.remove('theme-reload-pulse'), 640);
  }, []);

  // Fetch the server theme and apply it. `animate` runs the repaint pulse — but
  // only when the theme VISIBLE on this entry actually changes, so the tab that
  // just set the theme (and receives its own `content-changed` echo) does not
  // pulse a second time, and a global theme change while a per-game override
  // masks it does not pulse for nothing.
  const syncThemeFromServer = useCallback((animate: boolean) => {
    fetchTheme()
      .then(settings => {
        const ov = gameOverrideRef.current;
        const prevVisible = rootTheme === 'admin' ? adminThemeRef.current : (ov ?? themeRef.current);
        let nextVisible = prevVisible;
        if (VALID_THEMES.has(settings.frontend)) {
          setThemeState(settings.frontend as ThemeId);
          syncCachedThemeFromServer(LS_FRONTEND_KEY, settings.frontend as ThemeId);
          if (rootTheme !== 'admin') nextVisible = ov ?? (settings.frontend as ThemeId);
        }
        if (VALID_ADMIN_THEMES.has(settings.admin)) {
          setAdminThemeState(settings.admin as ThemeId);
          syncCachedThemeFromServer(LS_ADMIN_KEY, settings.admin as ThemeId);
          if (rootTheme === 'admin') nextVisible = settings.admin as ThemeId;
        }
        if (animate && nextVisible !== prevVisible) repaintPulse();
      })
      .catch(() => { /* use cached/defaults */ });
  }, [rootTheme, repaintPulse]);

  // Sync from server after mount — cached value is used for the initial paint
  // to avoid flashing the default theme before the fetch resolves.
  useEffect(() => {
    syncThemeFromServer(false);
  }, [syncThemeFromServer]);

  // Live theme reload: re-fetch when theme-settings.json changes on disk, so an
  // admin theme switch (or a direct file edit) applies to a running show or the
  // gamemaster with a repaint pulse and no reload. See specs/live-config-reload.md.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (payload?.theme) syncThemeFromServer(true);
  });

  // Apply theme on <html>. Frontend entries use the frontend theme (respecting game override);
  // admin entry uses the admin theme — otherwise the frontend theme's atmosphere layers
  // (clouds, horizon, stars) would leak onto the admin page from html[data-theme].
  useEffect(() => {
    document.documentElement.dataset.theme = htmlTheme;
  }, [htmlTheme]);

  const setTheme = useCallback((id: ThemeId) => {
    if (!VALID_THEMES.has(id)) return;
    triggerTransition();
    setThemeState(id);
    writeCachedTheme(LS_FRONTEND_KEY, id);
    saveTheme({ frontend: id }).catch(() => { /* ignore */ });
  }, [triggerTransition]);

  const setAdminTheme = useCallback((id: ThemeId) => {
    if (!VALID_ADMIN_THEMES.has(id)) return;
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
