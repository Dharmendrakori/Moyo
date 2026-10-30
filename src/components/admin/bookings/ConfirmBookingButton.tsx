'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icon';
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
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="check-circle" size={15} />
        {busy ? 'Confirming…' : 'Confirm booking'}
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
