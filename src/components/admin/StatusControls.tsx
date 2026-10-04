'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/States';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

/**
 * CATALOG ACTIVATION TOGGLE
 *
 * Activation and DEACTIVATION both take effect on the customer catalogue
 * immediately, so both go through a confirmation step. Deactivating is styled
 * as the destructive direction because it withdraws work from customers without
 * deleting any history.
 *
 * The control renders only a button. Whether the action succeeds is decided
 * entirely by the server, and the table is re-rendered from the database
 * afterwards - the badge never flips optimistically.
 */
export function CategoryStatusControl({
  categoryId,
  isActive,
  name,
}: {
  categoryId: string;
  isActive: boolean;
  name: string;
}) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [confirming, setConfirming] = useState(false);
  const next = !isActive;

  async function apply() {
    setConfirming(false);
    await run(`/api/admin/categories/${categoryId}`, { isActive: next });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setConfirming(true))}
        disabled={busy}
        className={
          isActive
            ? 'rounded-lg px-2.5 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/30 transition hover:bg-danger-bg disabled:opacity-50'
            : 'rounded-lg px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/30 transition hover:bg-success-bg disabled:opacity-50'
        }
      >
        {busy ? 'Saving…' : isActive ? 'Deactivate' : 'Activate'}
      </button>

      <ConfirmDialog
        open={confirming}
        tone={isActive ? 'danger' : 'default'}
        title={isActive ? `Deactivate ${name}?` : `Activate ${name}?`}
        description={
          isActive
            ? 'It will disappear from the customer catalogue. Existing bookings and all catalogue records are kept.'
            : 'It will appear in the customer catalogue and become bookable.'
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        busy={busy}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />

      {error && <InlineError message={error} />}
    </>
  );
}

/** Service activation toggle. Same guarantees as the category control. */
export function ServiceStatusControl({
  serviceId,
  isActive,
  name,
}: {
  serviceId: string;
  isActive: boolean;
  name: string;
}) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [confirming, setConfirming] = useState(false);
  const next = !isActive;

  async function apply() {
    setConfirming(false);
    await run(`/api/admin/services/${serviceId}`, { isActive: next });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setConfirming(true))}
        disabled={busy}
        className={
          isActive
            ? 'rounded-lg px-2.5 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/30 transition hover:bg-danger-bg disabled:opacity-50'
            : 'rounded-lg px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/30 transition hover:bg-success-bg disabled:opacity-50'
        }
      >
        {busy ? 'Saving…' : isActive ? 'Deactivate' : 'Activate'}
      </button>

      <ConfirmDialog
        open={confirming}
        tone={isActive ? 'danger' : 'default'}
        title={isActive ? `Deactivate ${name}?` : `Activate ${name}?`}
        description={
          isActive
            ? 'Customers will no longer be able to book this service. Existing bookings and the published pricing are kept.'
            : 'This service will appear in the customer catalogue and become bookable.'
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        busy={busy}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />

      {error && <InlineError message={error} />}
    </>
  );
}

/**
 * Server-rendered error text.
 *
 * Rendered as a React text node, never as HTML, so the API's generic message
 * text cannot inject markup even if it were ever attacker-influenced.
 */
export function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
      <Icon name="alert-triangle" size={13} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
