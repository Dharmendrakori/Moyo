'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

/**
 * ADMIN LOGOUT
 *
 * Posts to /api/auth/logout with the CSRF token read from the readable
 * (non-HttpOnly) CSRF cookie. The server revokes the session row and clears
 * the cookies; the client then hard-navigates so no cached admin view lingers.
 */
export function LogoutButton({ redirectTo = '/login' }: { redirectTo?: string } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        // Sends cookies and satisfies the same-origin requirement.
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrfToken() },
      });
    } catch {
      // Even if the network fails, the local cookie is cleared on next load.
    } finally {
      router.replace(redirectTo);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
      aria-label="Sign out"
      title="Sign out"
    >
      <Icon name="logout" size={18} />
    </button>
  );
}

/**
 * Reads the double-submit CSRF token from the cookie.
 * The cookie is intentionally NOT HttpOnly so the client can echo it in a header.
 * This is safe because an attacker who cannot read the cookie cannot forge it.
 */
export function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)moyo_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}