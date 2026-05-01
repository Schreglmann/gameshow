import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { sharedPlugins, sharedResolve, projectRoot } from './vite.config.shared';

export default defineConfig({
  root: path.resolve(projectRoot, 'admin'),
  base: '/admin/',
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
        name: 'Gameshow Admin',
        short_name: 'GS Admin',
        description: 'Gameshow admin backend',
        id: '/admin/',
        start_url: '/admin/',
        scope: '/admin/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1e293b',
        theme_color: '#1e293b',
        icons: [
          { src: '/admin/icons/admin-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/admin/icons/admin-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/admin/icons/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: sharedResolve,
  build: {
    outDir: path.resolve(projectRoot, 'dist/client/admin'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
