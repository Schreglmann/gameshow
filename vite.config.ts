import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/audio-guess': 'http://localhost:3000',
      '/image-guess': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
      '/audio': 'http://localhost:3000',
      '/background-music': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
});
