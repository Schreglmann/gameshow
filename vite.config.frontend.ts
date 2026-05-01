import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { sharedPlugins, sharedResolve, projectRoot } from './vite.config.shared';

export default defineConfig({
  root: path.resolve(projectRoot, 'show'),
  base: '/show/',
  publicDir: path.resolve(projectRoot, 'public'),
  plugins: [
    ...sharedPlugins,
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: path.resolve(projectRoot, 'src'),
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      injectRegister: 'auto',
      injectManifest: { injectionPoint: undefined, rollupFormat: 'iife' },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Game Show',
        short_name: 'Game Show',
        description: 'Live-event gameshow player view',
        id: '/show/',
        start_url: '/show/',
        scope: '/show/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0b14',
        theme_color: '#0b0b14',
        icons: [
          { src: '/show/icons/frontend-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/show/icons/frontend-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/show/icons/frontend-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: sharedResolve,
  build: {
    outDir: path.resolve(projectRoot, 'dist/client/show'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
