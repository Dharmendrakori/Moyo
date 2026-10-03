import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest configuration (`.mts` so Vite always loads it as ESM).
 *
 * `globals: true` is used deliberately: the suites read more clearly without
 * per-file imports, and it avoids a module-resolution edge case in Vitest 5
 * where the named exports of the `vitest` entrypoint are not resolved through
 * the CommonJS interop path.
 *
 * The suites target PURE logic - the booking state machine, the validation
 * schemas and the open-redirect guard - which deliberately have no dependency
 * on `next/headers` or a live database, so they run fast and deterministically.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
    },
  },
});