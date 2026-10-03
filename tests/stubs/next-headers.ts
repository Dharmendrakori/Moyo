/**
 * Test stub for `next/headers`.
 *
 * Next.js's real `cookies()` throws outside a request scope, so route-handler
 * tests alias this module in `vitest.config.mts`. It implements just enough of
 * the cookie-jar surface (`get`) for `src/lib/auth.ts` to work, reading its
 * state from `session-control.ts`.
 *
 * Test-only; never part of the application bundle.
 */
import { sessionState } from './session-control';

export const SESSION_COOKIE = 'moyo_session';
export const CSRF_COOKIE = 'moyo_csrf';

export async function cookies() {
  return {
    get(name: string) {
      if (name === SESSION_COOKIE) {
        return sessionState.currentUserId
          ? { name, value: `token-${sessionState.currentUserId}` }
          : undefined;
      }
      if (name === CSRF_COOKIE) {
        const userId = sessionState.currentUserId;
        const token = userId ? sessionState.csrfByUserId.get(userId) : undefined;
        return token ? { name, value: token } : undefined;
      }
      return undefined;
    },
    delete: () => undefined,
    set: () => undefined,
  };
}

export async function headers() {
  return new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '10.0.0.1' });
}
