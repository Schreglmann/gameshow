import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import type { UserConfig } from 'vite';

const ROOT = path.resolve(__dirname);

export const sharedPlugins = [tailwindcss(), react()];

export const sharedResolve: UserConfig['resolve'] = {
  alias: {
    '@': path.resolve(ROOT, 'src'),
  },
};

export const sharedServer: UserConfig['server'] = {
  port: 5173,
  watch: {
    ignored: [
      path.resolve(ROOT, 'games') + '/**',
      path.resolve(ROOT, 'config.json'),
    ],
  },
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      ws: true,
      configure: (proxy) => {
        proxy.on('proxyRes', (proxyRes) => {
          if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
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
};

export const projectRoot = ROOT;
