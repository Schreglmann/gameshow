import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { sharedPlugins, sharedResolve, projectRoot } from './vite.config.shared';

export default defineConfig({
  root: path.resolve(projectRoot, 'gamemaster'),
  base: '/gamemaster/',
  publicDir: path.resolve(projectRoot, 'public'),
  plugins: [
    ...sharedPlugins,
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      injectRegister: 'auto',
      workbox: {
        globPatterns: [],
        navigateFallback: null,
        runtimeCaching: [],
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Gameshow Gamemaster',
        short_name: 'GS GM',
        description: 'Gameshow gamemaster view',
        id: '/gamemaster/',
        start_url: '/gamemaster/',
        scope: '/gamemaster/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1c1917',
        theme_color: '#1c1917',
        icons: [
          { src: '/gamemaster/icons/gamemaster-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/gamemaster/icons/gamemaster-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/gamemaster/icons/gamemaster-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: sharedResolve,
  build: {
    outDir: path.resolve(projectRoot, 'dist/client/gamemaster'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
