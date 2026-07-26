import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/*.ui.test.tsx', '**/node_modules/**', '**/dist/**'],
  },
});
