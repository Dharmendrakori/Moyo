'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icon';
import { paiseToRupees, rupeesToPaise, useAdminMutation } from '@/components/admin/useAdminMutation';
import { InlineError } from '@/components/admin/StatusControls';

/**
 * PUBLISHED PRICE CONTROL
 *
 * The most sensitive control in the console, so it behaves conservatively:
 *
 *  - Publishing requires a typed confirmation, because a price becomes visible
 *    to customers the moment it is saved.
 *  - Withdrawing requires its own confirmation and is styled as destructive.
 *  - The amount is typed in RUPEES for the operator's benefit and converted to
 *    integer paise before sending. The server re-validates independently, so
 *    this conversion is convenience, never authority.
 *  - No price is invented or prefilled with a sample figure. An unpublished
 *    option starts from an empty box.
 *  - Success is only reported after the server confirms; the table then
 *    refreshes from the database.
 */
export function PriceControl({
  optionId,
  chargingLabel,
  pricePaise,
  isActive,
  disabledReason,
}: {
  optionId: string;
  chargingLabel: string;
  pricePaise: number | null;
  isActive: boolean;
  /** Why publishing is unavailable, in plain words. Null when it is available. */
  disabledReason: string | null;
}) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => paiseToRupees(pricePaise));
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'publish' | 'unpublish' | null>(null);

  const published = pricePaise != null;

  function beginEdit() {
    clearError();
    setLocalError(null);
    setValue(paiseToRupees(pricePaise));
    setEditing(true);
  }

  async function submit() {
    const paise = rupeesToPaise(value);
    if (paise == null) {
      setLocalError('Enter an amount such as 499 or 499.50.');
      return;
    }
    setConfirming(null);
    setEditing(false);
    await run(`/api/admin/pricing/${optionId}`, { action: 'PUBLISH', pricePaise: paise });
  }

  async function unpublish() {
    setConfirming(null);
    await run(`/api/admin/pricing/${optionId}`, { action: 'UNPUBLISH' });
  }

  const shownError = localError ?? error;
  return (
    <div className="space-y-2">
      {editing ? (
        <div className="space-y-2">
          <span className="relative block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">
              &#8377;
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 499"
              aria-label={`${chargingLabel} price in rupees`}
              className="w-32 rounded-lg border border-ink-300 py-1.5 pl-6 pr-2 text-sm tabular-nums focus:border-brand-500"
            />
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setLocalError(null);
              }}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-600 transition hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {published ? (
            <>
              <span className="text-sm font-semibold tabular-nums text-ink-900">
                {new Intl.NumberFormat('en-IN', {
                  style: 'currency',
                  currency: 'INR',
                  maximumFractionDigits: pricePaise % 100 === 0 ? 0 : 2,
                }).format(pricePaise / 100)}
              </span>
              <button
                type="button"
                onClick={beginEdit}
                disabled={busy}
                className="rounded-lg p-1 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
                aria-label={`Edit ${chargingLabel} price`}
                title="Edit price"
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirming('unpublish')}
                disabled={busy}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-danger transition hover:bg-danger-bg disabled:opacity-50"
              >
                Unpublish
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-ink-400">Not published</span>
              <button
                type="button"
                onClick={beginEdit}
                disabled={busy || disabledReason !== null}
                title={disabledReason ?? 'Publish a price'}
                className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300"
              >
                Publish
              </button>
            </>
          )}
        </div>
      )}

      {disabledReason !== null && !published && (
        <p className="text-[11px] leading-relaxed text-ink-400">{disabledReason}</p>
      )}

      {shownError && <InlineError message={shownError} />}

      <ConfirmDialog
        open={confirming === 'publish'}
        title="Publish this price?"
        description={`${chargingLabel} will be shown to customers on the service page and used as the server-authoritative quote for new bookings. Existing bookings keep the price they were created with.`}
        confirmLabel="Publish"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'unpublish'}
        tone="danger"
        title="Withdraw this published price?"
        description={`Customers will stop seeing a price for ${chargingLabel} and will see the neutral "on request" message instead. Bookings that already hold this price are unaffected.`}
        confirmLabel="Withdraw price"
        busy={busy}
        onConfirm={unpublish}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
