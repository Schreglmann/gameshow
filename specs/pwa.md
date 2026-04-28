# Spec: Progressive Web Apps (Frontend / Admin / Gamemaster)

## Goal
Make each of the three surfaces — player frontend, admin backend, gamemaster view — independently installable as its own PWA (separate manifest, icons, service worker, install entry), served from a single Express origin at `/show/`, `/admin/`, `/gamemaster/`. Root `/` redirects to `/show/`.

## Acceptance criteria
- [ ] `npm run build` produces three independently bundled apps under `dist/client/` (`show/`, `admin/`, `gamemaster/`), each with its own `index.html`, `manifest.webmanifest`, `sw.js`, and icon assets.
- [ ] Root `/` issues a 302 redirect to `/show/` so old bookmarks and entry points still land on the player view. Legacy frontend paths (`/rules`, `/game`, `/summary`, `/theme-showcase`) redirect to `/show/rules`, `/show/game`, etc.
- [ ] Visiting `/show`, `/admin`, and `/gamemaster` in production each load their dedicated bundle (verified via distinct JS entry chunks in the Network tab).
- [ ] All three apps are separately installable in Chromium browsers. Because the three PWA scopes are fully disjoint (`/show/`, `/admin/`, `/gamemaster/`), installing one does not suppress the install prompt for the others.
- [ ] Each app's service worker registers at its own scope (`/show/`, `/admin/`, `/gamemaster/`) and status is "activated" in DevTools → Application → Service Workers.
- [ ] No offline behavior: service workers do not precache or runtime-cache assets. Reloading with the server down fails (expected).
- [ ] The admin Answers tab still iframes `/gamemaster` and keyboard controls inside the iframe still function.
- [ ] Cross-app links (admin → `/` home, admin → `/theme-showcase`) still work — they use plain anchor navigation so the browser does a full page load across PWA boundaries.
- [ ] localStorage IPC between frontend game tab and gamemaster (answer counts, controls, commands) keeps working unchanged — same origin is preserved.
- [ ] Responsive at 375 / 768 / 1024 / 1920 px on all three apps.
- [ ] Each app exposes an in-app "install" button: frontend (small, bottom of landing page), admin (small, next to the Server heading in the System tab), gamemaster (small, bottom-right corner, hidden when iframed inside admin).
- [ ] On Chromium browsers the button triggers the native install prompt via the `beforeinstallprompt` event. The button only renders after the event has fired and the app is not already installed.
- [ ] On Safari (iOS and macOS 17+) and Firefox for Android the button renders immediately and, when clicked, opens a small popover with German step-by-step instructions for the browser's built-in install action.
- [ ] On Firefox desktop (no install support) the button does not render at all.
- [ ] When the app is already installed (`display-mode: standalone` or `navigator.standalone`) the button is hidden on all platforms.

## State / data changes
- No `AppState` changes.
- No new API endpoints.
- No new localStorage keys.

## UI behaviour
- Frontend, admin, and gamemaster render identically to today. The only visible changes:
  - Browser install prompt (omnibox install icon) appears on each when first visited.
  - Each app has its own favicon / app icon / title / theme color when installed.
  - `<meta name="theme-color">` set per app influences the mobile address-bar color.
- Admin's "← Home" link and ConfigTab's "Vorschau aller Komponenten" link navigate across PWA boundaries via full page load (plain `<a href>`), not client-side routing.

## Technical notes
- **Tooling:** `vite-plugin-pwa` (one plugin instance per Vite config, three configs total). No runtime dependencies added.
- **Build:** three sequential `vite build --config vite.config.{frontend,admin,gamemaster}.ts`. Only frontend config empties `dist/client/`; the other two write into subdirs with `emptyOutDir: false`.
- **Dev:** single Vite dev server (`vite.config.dev.ts`) with three HTML inputs so `localhost:5173/`, `/admin/`, `/gamemaster/` all work. PWA disabled in dev (`devOptions.enabled: false`).
- **Service worker scope:** each SW is served from its own subpath, so narrower scopes take precedence over the frontend's `/` scope automatically.
- **Server:** SPA fallback in [server/index.ts](../server/index.ts) routes `/admin*` → `dist/client/admin/index.html`, `/gamemaster*` → `dist/client/gamemaster/index.html`, `/show*` → `dist/client/show/index.html`. Every other path (including `/`) redirects 302 to `/show` + the original path. New middleware sets `Cache-Control: no-cache` on `sw.js` and `Content-Type: application/manifest+json` on `*.webmanifest`.
- **Disjoint scopes:** frontend lives under `/show/` specifically so its manifest scope does not contain `/admin/` or `/gamemaster/`. Chrome treats PWAs on one origin as independently installable only when scopes do not overlap.
- **Icons:** placeholder icons per app (192, 512, maskable-512) live under `public/icons/{frontend,admin,gamemaster}/`. User can supply final art later.

## Out of scope
- Offline functionality (precaching, runtime caching, offline fallback pages).
- Push notifications.
- Background sync.
- Splitting the apps onto separate subdomains or origins.
- Extracting shared code into a separate package — the shared modules stay in `src/` and are imported by each entry directly.
- Updating PWA branding / icon artwork beyond placeholders.
