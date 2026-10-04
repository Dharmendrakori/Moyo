'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/States';
import { rupeesToPaise, useAdminMutation } from '@/components/admin/useAdminMutation';
import { InlineError } from '@/components/admin/StatusControls';

/**
 * CHARGING OPTION CONTROL
 *
 * Configures which charging options the provider offers, and the customer
 * budget bounds for Customer Budget.
 *
 * TWO DELIBERATE OMISSIONS:
 *
 *  1. There is no price field here. Publishing a price is a separate action on
 *     `/api/admin/pricing`, and the server rejects `pricePaise` on this
 *     endpoint's schema. Enabling an option therefore can never expose a price
 *     by accident.
 *  2. Budget bounds are only rendered for CUSTOMER_BUDGET. They carry no
 *     meaning for Visit Charge or Fixed Charge, and the server rejects them on
 *     those rows, so the UI does not offer an input that would fail.
 */
export function ChargingOptionControl({
  optionId,
  charging,
  isActive,
  budgetMinPaise,
  budgetMaxPaise,
  serviceName,
}: {
  optionId: string;
  charging: string;
  isActive: boolean;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  serviceName: string;
}) {
  const isBudget = charging === 'CUSTOMER_BUDGET';
  const { run, busy, error, clearError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [nextActive, setNextActive] = useState(isActive);
  const [min, setMin] = useState(budgetMinPaise != null ? String(budgetMinPaise / 100) : '');
  const [max, setMax] = useState(budgetMaxPaise != null ? String(budgetMaxPaise / 100) : '');
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    setConfirming(false);
    setOpen(false);

    const payload: Record<string, unknown> = { isActive: nextActive };

    if (isBudget) {
      const minPaise = min.trim() === '' ? null : rupeesToPaise(min);
      const maxPaise = max.trim() === '' ? null : rupeesToPaise(max);

      if ((min.trim() !== '' && minPaise == null) || (max.trim() !== '' && maxPaise == null)) {
        setLocalError('Enter budget amounts as rupees, for example 500 and 5000.');
        return;
      }
      if (minPaise != null && maxPaise != null && minPaise >= maxPaise) {
        setLocalError('The minimum budget must be below the maximum budget.');
        return;
      }
      payload.budgetMinPaise = minPaise;
      payload.budgetMaxPaise = maxPaise;
    }

    setLocalError(null);
    await run(`/api/admin/charging-options/${optionId}`, payload);
  }

  const shownError = localError ?? error;
  return (
    <div className="space-y-1.5">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            clearError();
            setLocalError(null);
            setNextActive(isActive);
            setOpen(true);
          }}
          disabled={busy}
          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
        >
          Configure
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-2.5">
          <label className="flex items-center gap-2 text-xs font-medium text-ink-700">
            <input
              type="checkbox"
              checked={nextActive}
              onChange={(e) => setNextActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Offer this option
          </label>

          {isBudget && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Min budget
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  placeholder="500"
                  aria-label={`Minimum customer budget in rupees for ${serviceName}`}
                  className="w-full rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Max budget
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  placeholder="5000"
                  aria-label={`Maximum customer budget in rupees for ${serviceName}`}
                  className="w-full rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-xs tabular-nums"
                />
              </label>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setLocalError(null);
              }}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-600 transition hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {shownError && <InlineError message={shownError} />}

      <ConfirmDialog
        open={confirming}
        title={nextActive ? 'Offer this charging option?' : 'Withdraw this charging option?'}
        description={
          nextActive
            ? `Customers will be able to choose this option when booking ${serviceName}.`
            : `Customers will no longer be able to choose this option for ${serviceName}. Any price already published is left untouched.`
        }
        confirmLabel="Save"
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
