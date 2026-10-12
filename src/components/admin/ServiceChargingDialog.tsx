'use client';

import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/States';
import { paiseToRupees, rupeesToPaise, useAdminMutation } from '@/components/admin/useAdminMutation';
import { InlineError } from '@/components/admin/StatusControls';
import { CHARGING_HINT, CHARGING_LABEL, type ChargingOption } from '@/lib/domain';

export type ServiceChargingOptionState = {
  charging: ChargingOption;
  optionId: string;
  isActive: boolean;
  pricePaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  durationMinMinutes: number | null;
};

const TABS: ChargingOption[] = ['VISIT_CHARGE', 'FIXED_CHARGE', 'CUSTOMER_BUDGET'];

/**
 * UNIFIED SERVICE CHARGING DIALOG
 *
 * One Configure action per service, with three independent sections (tabs) for
 * Visit Charge, Fixed Charge and Customer Budget.
 *
 * Each section saves ONLY its own `ServiceOption` row through the existing
 * `PATCH /api/admin/charging-options/:id` endpoint with the existing
 * `adminChargingOptionSchema` payload, so updating one setting can never
 * overwrite the other two. No price field exists here: publication stays on
 * /admin/pricing, and budget bounds are offered for CUSTOMER_BUDGET only.
 */
export function ServiceChargingDialog({
  serviceName,
  options,
  open,
  onClose,
}: {
  serviceName: string;
  options: ServiceChargingOptionState[];
  open: boolean;
  onClose: () => void;
}) {
  const byCharging = useMemo(() => new Map(options.map((o) => [o.charging, o])), [options]);
  const [tab, setTab] = useState<ChargingOption>('VISIT_CHARGE');
  const [confirming, setConfirming] = useState(false);

  // `tab` and `confirming` intentionally start from their initial values on
  // every mount. The parent table only renders this dialog for the currently
  // selected service (and keys it by `serviceId`), so opening a service always
  // mounts a fresh instance - no effect is needed to reset state, and calling
  // setState synchronously inside an effect would trip
  // `react-hooks/set-state-in-effect`.
  if (!open) return null;

  const current = byCharging.get(tab);
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-900/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="charging-dialog-title"
        className="relative flex max-h-[90vh] w-full max-w-lg animate-slide-up flex-col rounded-card bg-white shadow-overlay"
      >
        <div className="border-b border-ink-200 px-4 pt-4 pb-3">
          <h2 id="charging-dialog-title" className="truncate text-base font-semibold text-ink-900">
            Configure charging — {serviceName}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Each charging type saves independently to its own record.
          </p>
          <div role="tablist" aria-label="Charging types" className="mt-3 flex gap-1 rounded-lg bg-ink-100 p-1">
            {TABS.map((charging) => {
              const option = byCharging.get(charging);
              const selected = tab === charging;
              return (
                <button
                  key={charging}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setTab(charging);
                    setConfirming(false);
                  }}
                  className={
                    selected
                      ? 'flex-1 rounded-md bg-white px-2 py-1.5 text-xs font-semibold text-ink-900 shadow-card'
                      : 'flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-ink-500 transition hover:text-ink-800'
                  }
                >
                  {CHARGING_LABEL[charging]}
                  {option && (
                    <span
                      aria-hidden
                      className={
                        option.isActive
                          ? 'ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle'
                          : 'ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink-300 align-middle'
                      }
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {current && (
            <OptionSection
              key={`${current.optionId}-${current.charging}`}
              serviceName={serviceName}
              option={current}
              confirming={confirming}
              onConfirmingChange={setConfirming}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-ink-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-600 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}


function OptionSection({
  serviceName,
  option,
  confirming,
  onConfirmingChange,
}: {
  serviceName: string;
  option: ServiceChargingOptionState;
  confirming: boolean;
  onConfirmingChange: (open: boolean) => void;
}) {
  const isBudget = option.charging === 'CUSTOMER_BUDGET';
  const { run, busy, error, clearError } = useAdminMutation();
  const [nextActive, setNextActive] = useState(option.isActive);
  const [min, setMin] = useState(paiseToRupees(option.budgetMinPaise));
  const [max, setMax] = useState(paiseToRupees(option.budgetMaxPaise));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    nextActive !== option.isActive ||
    (isBudget &&
      (min.trim() !== paiseToRupees(option.budgetMinPaise) ||
        max.trim() !== paiseToRupees(option.budgetMaxPaise)));

  async function save() {
    onConfirmingChange(false);

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
    // One PATCH to ONE option row: the other two rows are never in the payload.
    const result = await run(`/api/admin/charging-options/${option.optionId}`, payload);
    if (result.ok) setSaved(true);
  }

  const shownError = localError ?? error;

  return (
    <div role="tabpanel" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{CHARGING_LABEL[option.charging]}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{CHARGING_HINT[option.charging]}</p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
        <input
          type="checkbox"
          checked={nextActive}
          onChange={(e) => {
            setNextActive(e.target.checked);
            setSaved(false);
          }}
          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        />
        Offer this option
      </label>

      {isBudget && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Min budget (Rs)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={min}
              onChange={(e) => {
                setMin(e.target.value);
                setSaved(false);
              }}
              placeholder="500"
              aria-label={`Minimum customer budget in rupees for ${serviceName}`}
              className="w-full rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Max budget (Rs)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={max}
              onChange={(e) => {
                setMax(e.target.value);
                setSaved(false);
              }}
              placeholder="5000"
              aria-label={`Maximum customer budget in rupees for ${serviceName}`}
              className="w-full rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
      )}

      {dirty && !saved && (
        <p className="text-xs font-medium text-warning" role="status">
          Unsaved changes
        </p>
      )}
      {saved && !dirty && (
        <p className="text-xs font-medium text-success" role="status">
          Saved
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onConfirmingChange(true)}
          disabled={busy || !dirty}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save this option'}
        </button>
        <button
          type="button"
          onClick={() => {
            setNextActive(option.isActive);
            setMin(paiseToRupees(option.budgetMinPaise));
            setMax(paiseToRupees(option.budgetMaxPaise));
            setLocalError(null);
            setSaved(false);
            clearError();
          }}
          disabled={busy || !dirty}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-600 transition hover:text-ink-900 disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {shownError && <InlineError message={shownError} />}

      <ConfirmDialog
        open={confirming}
        title={nextActive ? 'Offer this charging option?' : 'Withdraw this charging option?'}
        description={
          nextActive
            ? `Customers will be able to choose ${CHARGING_LABEL[option.charging]} when booking ${serviceName}. Only this option is changed.`
            : `Customers will no longer be able to choose ${CHARGING_LABEL[option.charging]} for ${serviceName}. The other two options are untouched.`
        }
        confirmLabel="Save"
        busy={busy}
        onConfirm={save}
        onCancel={() => onConfirmingChange(false)}
      />
    </div>
  );
}
