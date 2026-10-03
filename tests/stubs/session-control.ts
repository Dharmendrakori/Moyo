/**
 * Shared mutable session state for the route-handler tests.
 *
 * `next/headers` is aliased to `next-headers.ts` in `vitest.config.mts`, which
 * reads from here. The state is parked on `globalThis` rather than exported as a
 * plain binding, because a module can be evaluated more than once in a Vite
 * module graph (once for the test file, once for the stub). A `globalThis`
 * singleton guarantees both copies observe the same value.
 */
type SessionState = {
  /** When null, the request is unauthenticated (no session cookie). */
  currentUserId: string | null;
  /** Maps userId -> the CSRF token the server expects. */
  csrfByUserId: Map<string, string>;
};

const KEY = '__moyoTestSessionState';

const globalStore = globalThis as unknown as Record<string, SessionState | undefined>;

export const sessionState: SessionState = (globalStore[KEY] ??= {
  currentUserId: null,
  csrfByUserId: new Map<string, string>(),
});

/** Resets to the signed-out state between tests. */
export function resetSessions(): void {
  sessionState.currentUserId = null;
  sessionState.csrfByUserId.clear();
}

/** Signs a user in with the given CSRF token. */
export function signIn(userId: string, csrf = 'csrf-token'): void {
  sessionState.currentUserId = userId;
  sessionState.csrfByUserId.set(userId, csrf);
}
