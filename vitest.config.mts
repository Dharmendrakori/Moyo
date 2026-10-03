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
 * Alongside the original pure-logic suites, `tests/booking-api.test.ts` drives
 * the REAL booking route handlers. That requires `next/headers` and
 * `server-only` to resolve to the stubs below, which in turn requires Next.js
 * to be inlined rather than externalised - see `server.deps.inline`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    /*
     * `src/lib/env.ts` fails fast when DATABASE_URL / SESSION_SECRET are absent,
     * which is correct in production but means the route-handler tests need
     * placeholder values. These are test-only throwaways: no test connects to a
     * database (Prisma is mocked) and no secret is read from disk.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./tests/.not-used.db',
      SESSION_SECRET: 'test-secret-not-used-outside-the-test-runner-0000000000',
      APP_URL: 'http://localhost:3000',
    },
    server: {
      deps: {
        /*
         * Vitest externalises `node_modules` by default, which bypasses both the
         * `resolve.alias` entries below and `vi.mock()` interception.
         *
         * - `next` must be inlined so `next/headers` resolves to the stub; the
         *   real `cookies()` returns an empty jar outside a request scope, so
         *   every authenticated route test would silently see "no session".
         * - `react` must be inlined so the test's `cache()` override applies.
         *   `getCurrentUser` is wrapped in `cache()`, which memoises across
         *   tests here and would poison every case after the first.
         */
        inline: [/^next\//, /^next$/, /^react$/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
      /*
       * `server-only` is a build-time guard that throws when imported from a
       * Client Component. The Node test environment resolves the throwing entry
       * point, so route-handler tests that legitimately exercise server-only
       * modules would fail to import. Aliasing it to an empty stub keeps the
       * guard intact in the Next.js build while letting the server modules load
       * under Vitest.
       */
      'server-only': path.resolve(process.cwd(), './tests/stubs/server-only.ts'),
      /*
       * Next.js's real `cookies()`/`headers()` throw when called outside a
       * request scope, which is exactly the situation in a unit test. Aliasing
       * the module (rather than `vi.mock`-ing it) is required here because
       * Next's package `exports` map means the bare specifier is not reliably
       * interceptable. The stub is listed in vitest.config.mts.
       */
      'next/headers': path.resolve(process.cwd(), './tests/stubs/next-headers.ts'),
    },
  },
});