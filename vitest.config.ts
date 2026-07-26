/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      'tests/contracts/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e'],
    css: false,
    // Must stay comfortably ABOVE the `asyncUtilTimeout` set in tests/setup.ts —
    // otherwise vitest aborts the test before `waitFor` gets its full budget and
    // the failure reads as a generic timeout instead of the actual assertion.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
