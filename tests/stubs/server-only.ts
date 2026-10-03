/**
 * Stub for the `server-only` package used by the Vitest environment.
 *
 * The real package throws when a Client Component imports it, which is exactly
 * what we want in the Next.js build. Under Vitest (plain Node) it would also
 * throw for the server-only modules that route-handler tests deliberately
 * exercise, so the alias in `vitest.config.mts` points here instead.
 *
 * This file is test-only and is never part of the application bundle.
 */
export {};
