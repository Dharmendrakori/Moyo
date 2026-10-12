'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readCsrfToken } from '@/components/admin/LogoutButton';

/**
 * BULK MUTATION CLIENT
 *
 * The browser side of a bulk write. Like `useAdminMutation`, it is deliberately
 * thin: it sends the request with the session CSRF token, shows what the SERVER
 * reported, and refreshes the table from the database afterwards. It decides
 * nothing about whether an action is allowed.
 *
 * The response is a rich result object (requested / affected / notFound /
 * protected / skipped), which the caller turns into an honest summary. A partial
 * success is therefore surfaced as such, never flattened into a generic "done".
 */
export type BulkResponse<T = unknown> = { ok: true; data: T } | { ok: false; message: string };

export function useBulkAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(url: string, body: unknown): Promise<BulkResponse<T>> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': readCsrfToken(),
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json()) as T;
          router.refresh();
          return { ok: true, data };
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
