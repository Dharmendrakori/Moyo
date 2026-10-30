'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/States';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

/**
 * ADMIN BOOKING CONFIRMATION
 *
 * Renders only for bookings in the REQUESTED state. Clicking confirms the
 * booking through POST /api/admin/bookings/:id/confirm, where the server
 * resolves REQUESTED -> CONFIRMED through the booking state machine. The
 * client never sends or invents a status - it requests the action and the
 * server decides. On success the page is refreshed from the database (no
 * optimistic update), so the UI can never disagree with the server.
 */
export function ConfirmBookingButton({
  booking,
}: {
  booking: { id: string; reference: string; status: string };
}) {
  const router = useRouter();
  const { run, busy, error, clearError } = useAdminMutation();
  const [confirming, setConfirming] = useState(false);

  const eligible = booking.status === 'REQUESTED';

  async function apply() {
    setConfirming(false);
    const result = await run(`/api/admin/bookings/${booking.id}/confirm`, {}, 'POST');
    if (result.ok) router.refresh();
  }

  if (!eligible) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setConfirming(true))}
        disabled={busy}
        aria-label={`Confirm booking ${booking.reference}`}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white ring-1 ring-inset ring-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? 'Confirming…' : 'Confirm'}
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Confirm ${booking.reference}?`}
        description="Moves this booking from Requested to Confirmed. The server decides whether the transition is allowed."
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}
