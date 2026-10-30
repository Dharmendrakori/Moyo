'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icon';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

/**
 * ISSUE AN INVOICE
 *
 * Rendered by the booking detail page only while the server-side eligibility
 * check says the booking qualifies. Clicking asks the server to issue the
 * invoice; the client sends NO amount and NO line item - the price comes from
 * the persisted booking, and the server decides everything else.
 *
 * Repeat safety: after a successful issue the booking is no longer COMPLETED, so
 * this control disappears on refresh, and the API refuses a second attempt even if
 * a stale page posts again.
 */
export function GenerateInvoiceButton({
  booking,
  amountLabel,
}: {
  booking: { id: string; reference: string };
  /** Server-formatted amount, shown as a confirmation of what will be billed. */
  amountLabel: string;
}) {
  const router = useRouter();
  const { run, busy, error, clearError } = useAdminMutation();
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState(false);

  async function apply() {
    setConfirming(false);
    const result = await run(`/api/admin/bookings/${booking.id}/invoice`, {}, 'POST');
    if (result.ok) {
      setIssued(true);
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setConfirming(true))}
        disabled={busy || issued}
        aria-label={`Issue an invoice for booking ${booking.reference}`}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="receipt" size={15} />
        {busy ? 'Issuing…' : issued ? 'Invoice issued' : 'Issue invoice'}
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Issue an invoice for ${booking.reference}?`}
        description={`This bills ${amountLabel} from the amount recorded against the booking and moves it to Invoice generated. An issued invoice cannot be edited.`}
        confirmLabel="Issue invoice"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />

      {issued && (
        <Link
          href="/admin/invoices"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 underline underline-offset-2"
        >
          Open the invoice ledger
        </Link>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}
