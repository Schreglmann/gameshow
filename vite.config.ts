import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    watch: {
      ignored: [
        path.resolve(__dirname, 'games') + '/**',
        path.resolve(__dirname, 'config.json'),
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        ws: true, // Forward WebSocket upgrades to Express
        // Disable response buffering so SSE events stream through immediately
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              // Force chunked transfer and prevent buffering
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      '/images': 'http://localhost:3000',
      '/audio': 'http://localhost:3000',
      '/background-music': 'http://localhost:3000',
      '/videos': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
});
