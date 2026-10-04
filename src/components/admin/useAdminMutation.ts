'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readCsrfToken } from '@/components/admin/LogoutButton';

/**
 * SHARED ADMIN MUTATION CLIENT
 *
 * The browser side of an admin write. It is deliberately thin: it sends a
 * request and shows what the SERVER said. It decides nothing.
 *
 * SECURITY NOTES:
 *  - The CSRF token is read from the readable cookie and echoed in a header,
 *    because the server verifies it against the value stored with the session.
 *  - Responses are handled as `{ error: { code, message } }`. The API returns
 *    only safe, generic text - never a stack trace or a database message - and
 *    that text is rendered as plain text, so there is nothing here for HTML to
 *    be injected into.
 *  - On success the router is refreshed so the table re-renders from the
 *    database. The client never optimistically invents the new state.
 */
export type AdminMutationResult = { ok: true } | { ok: false; message: string };

export function useAdminMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (url: string, body: unknown): Promise<AdminMutationResult> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': readCsrfToken(),
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          router.refresh();
          return { ok: true };
        }

        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        const message =
          payload?.error?.message ??
          (res.status === 429
            ? 'Too many changes in a short period. Please wait a moment and try again.'
            : 'The change could not be saved. Please try again.');

        setError(message);
        return { ok: false, message };
      } catch {
        // A network failure is reported honestly rather than assumed to have
        // succeeded. The operator must not assume a change landed.
        const message = 'Could not reach the server. The change was not saved.';
        setError(message);
        return { ok: false, message };
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return { run, busy, error, clearError: () => setError(null) };
}

/**
 * Turns a rupee amount typed by an operator into integer paise.
 *
 * Returns null for anything that is not a clean, positive, finite amount with
 * at most two decimal places, so a malformed entry is rejected locally and the
 * server still validates independently.
 */
export function rupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Formats integer paise back into a plain rupee string for an input box. */
export function paiseToRupees(paise: number | null): string {
  if (paise == null) return '';
  return (paise / 100).toFixed(2).replace(/\.00$/, '');
}
