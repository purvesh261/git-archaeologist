import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration specs read DATABASE_URL; without a .env (e.g. CI) they skip.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
