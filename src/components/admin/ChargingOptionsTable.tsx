'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/admin/DataTable';
import { BulkButton, BulkCheckbox, BulkResultBanner, BulkToolbar } from '@/components/admin/BulkControls';
import { useBulkAction } from '@/components/admin/useBulkAction';
import { useSelection } from '@/components/admin/useSelection';
import { ConfirmDialog, EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';
import { ServiceChargingDialog, type ServiceChargingOptionState } from '@/components/admin/ServiceChargingDialog';
import { CHARGING_LABEL, CHARGING_OPTIONS, type ChargingOption } from '@/lib/domain';
import { formatINR } from '@/lib/format';
import type { AdminChargingServiceRow } from '@/lib/admin-catalog';

type BulkAction = 'ENABLE' | 'DISABLE';

type Result =
  | { tone: 'success' | 'warning' | 'danger'; title: string; details?: string[] }
  | null;

/**
 * UNIFIED CHARGING-OPTIONS TABLE WITH BULK MANAGEMENT
 *
 * Each service appears exactly once with its three charging states side by
 * side. The Configure button opens one dialog whose three tabs each PATCH a
 * single `ServiceOption` row through the existing endpoint, so settings stay
 * independent. Horizontally scrollable on narrow screens via DataTable.
 *
 * Wraps the dense table with row selection and a bulk toolbar that enables or
 * disables ONE charging type across the selected services, following the
 * Services and Categories bulk tables. EVERY bulk mutation goes through
 * `POST /api/admin/charging-options/bulk`, which re-validates every id, writes
 * only `isActive` of the named charging type and audits the change; the table
 * then re-renders from the database, so a badge never flips optimistically.
 * The server may have to skip a row (e.g. Customer Budget with no configured
 * range) - such rows are listed by name in the result banner, and the summary
 * never claims success for a partial batch.
 */
export function ChargingOptionsTable({
  rows,
  hasFilters,
}: {
  rows: AdminChargingServiceRow[];
  hasFilters: boolean;
}) {
  const selection = useSelection(rows, (r) => r.serviceId);
  const { run, busy, error, clearError } = useBulkAction();
  const [charging, setCharging] = useState<ChargingOption>('VISIT_CHARGE');
  const [confirm, setConfirm] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [selected, setSelected] = useState<AdminChargingServiceRow | null>(null);

  async function apply(action: BulkAction) {
    setConfirm(null);
    const res = await run<{
      result: {
        requested: number;
        affected: number;
        notFound: string[];
        skipped?: Array<{ name: string; reason: string }>;
      };
    }>('/api/admin/charging-options/bulk', {
      ids: selection.selected,
      charging,
      action,
    });

    if (res.ok) {
      const { requested, affected, notFound, skipped } = res.data.result;
      const skippedList = skipped ?? [];
      const failed = skippedList.length + notFound.length;

      // Honest accounting: a partially applied batch is reported as a partial
      // batch, never flattened into a generic "done".
      const details: string[] = [];
      skippedList.forEach((s) => details.push(`${s.name} — ${s.reason}`));
      if (notFound.length > 0) {
        details.push(`${notFound.length} record(s) no longer exist and were skipped.`);
      }
      const verb = action === 'ENABLE' ? 'enabled' : 'disabled';
      const label = CHARGING_LABEL[charging];
      setResult({
        tone: failed > 0 ? 'warning' : affected > 0 ? 'success' : 'warning',
        title:
          failed > 0
            ? `${label} ${verb} for ${affected} of ${requested} selected service${requested === 1 ? '' : 's'}.`
            : `${label} ${verb} for ${requested} service${requested === 1 ? '' : 's'}.`,
        details,
      });
      selection.clear();
    }
  }

  return (
    <div className="space-y-3">
      {error && <BulkResultBanner tone="danger" title={error} onDismiss={clearError} />}
      {result && (
        <BulkResultBanner
          tone={result.tone}
          title={result.title}
          details={result.details}
          onDismiss={() => setResult(null)}
        />
      )}

      <BulkToolbar count={selection.count} busy={busy} onClear={selection.clear}>
        <ChargingTypeSelect value={charging} disabled={busy} onChange={setCharging} />
        <BulkButton
          tone="primary"
          icon={<Icon name="check-circle" size={13} />}
          disabled={busy}
          onClick={() => setConfirm('ENABLE')}
        >
          Enable
        </BulkButton>
        <BulkButton
          icon={<Icon name="close" size={13} />}
          disabled={busy}
          onClick={() => setConfirm('DISABLE')}
        >
          Disable
        </BulkButton>
      </BulkToolbar>

      <ChargingTable
        rows={rows}
        hasFilters={hasFilters}
        selection={selection}
        onSelect={setSelected}
      />

      <ConfirmDialog
        open={confirm !== null}
        tone={confirm === 'DISABLE' ? 'danger' : 'default'}
        title={`${confirm === 'ENABLE' ? 'Enable' : 'Disable'} ${CHARGING_LABEL[charging]} for ${selection.count} service${selection.count === 1 ? '' : 's'}?`}
        description={
          (confirm === 'ENABLE'
            ? `${CHARGING_LABEL[charging]} will be offered on every selected service. The other two charging types are untouched and no price is changed.`
            : `Customers will no longer be able to choose ${CHARGING_LABEL[charging]} on the selected services. The other two charging types are untouched and any published price is left as-is.`) +
          (confirm === 'ENABLE' && charging === 'CUSTOMER_BUDGET'
            ? ' Services with no budget range configured are skipped and reported.'
            : '')
        }
        confirmLabel={confirm === 'ENABLE' ? 'Enable' : 'Disable'}
        busy={busy}
        onConfirm={() => confirm && apply(confirm)}
        onCancel={() => setConfirm(null)}
      />

      {selected && (
        <ServiceChargingDialog
          key={selected.serviceId}
          serviceName={selected.serviceName}
          options={selected.options as ServiceChargingOptionState[]}
          open={selected !== null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/**
 * The charging-type picker shown inside the bulk toolbar.
 *
 * Offers exactly the three official charging concepts from `src/lib/domain.ts`
 * - no more, no fewer. Exported so the contract can be pinned by a test.
 */
export function ChargingTypeSelect({
  value,
  disabled,
  onChange,
}: {
  value: ChargingOption;
  disabled: boolean;
  onChange: (charging: ChargingOption) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600">
      <span className="whitespace-nowrap">Charging type</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ChargingOption)}
        aria-label="Charging type to enable or disable"
        className="rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-xs font-semibold text-ink-800 focus:border-brand-500 disabled:opacity-50"
      >
        {CHARGING_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {CHARGING_LABEL[c]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The presentational table with a leading selection column. */
function ChargingTable({
  rows,
  hasFilters,
  selection,
  onSelect,
}: {
  rows: AdminChargingServiceRow[];
  hasFilters: boolean;
  selection: ReturnType<typeof useSelection<AdminChargingServiceRow>>;
  onSelect: (row: AdminChargingServiceRow) => void;
}) {
  return (
    <DataTable
      caption="Charging options per service"
      rows={rows}
      rowKey={(r) => r.serviceId}
      empty={
        <EmptyState
          icon="receipt"
          title="No services match these filters"
          description={
            hasFilters
              ? 'Try clearing the search or filters.'
              : 'The catalogue contains no services yet.'
          }
        />
      }
      columns={[
        {
          key: 'select',
          header: (
            <BulkCheckbox
              checked={selection.allOnPageSelected}
              indeterminate={selection.someOnPageSelected}
              onChange={selection.toggleAllOnPage}
              label={`Select all ${rows.length} services on this page`}
            />
          ),
          className: 'w-10',
          cell: (r) => (
            <BulkCheckbox
              checked={selection.isSelected(r.serviceId)}
              onChange={() => selection.toggle(r.serviceId)}
              label={`Select ${r.serviceName}`}
            />
          ),
        },
        {
          key: 'service',
          header: 'Service',
          cell: (r) => (
            <div className="min-w-0">
              <Link
                href={`/admin/services/${r.serviceId}`}
                title={r.serviceName}
                className="block truncate font-semibold text-ink-900 transition hover:text-brand-600"
              >
                {r.serviceName}
              </Link>
              {!r.serviceActive && (
                <p className="mt-0.5 text-[11px] font-medium text-warning">
                  Service deactivated — options not reachable by customers.
                </p>
              )}
            </div>
          ),
        },
        {
          key: 'category',
          header: 'Category',
          className: 'w-44',
          cell: (r) => (
            <div className="min-w-0">
              <p title={r.categoryName} className="truncate text-ink-700">
                {r.categoryName}
              </p>
              <p title={r.subCategoryName} className="truncate text-xs text-ink-400">
                {r.subCategoryName}
              </p>
            </div>
          ),
        },
        {
          key: 'visit',
          header: 'Visit Charge',
          className: 'w-40',
          cell: (r) => <OptionCell option={optionFor(r, 'VISIT_CHARGE')} />,
        },
        {
          key: 'fixed',
          header: 'Fixed Charge',
          className: 'w-40',
          cell: (r) => <OptionCell option={optionFor(r, 'FIXED_CHARGE')} />,
        },
        {
          key: 'budget',
          header: 'Customer Budget',
          className: 'w-48',
          cell: (r) => <OptionCell option={optionFor(r, 'CUSTOMER_BUDGET')} showBudget />,
        },
        {
          key: 'actions',
          header: 'Actions',
          className: 'w-28',
          cell: (r) => (
            <button
              type="button"
              onClick={() => onSelect(r)}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
            >
              Configure
            </button>
          ),
        },
      ]}
    />
  );
}

function optionFor(row: AdminChargingServiceRow, charging: 'VISIT_CHARGE' | 'FIXED_CHARGE' | 'CUSTOMER_BUDGET') {
  return row.options.find((o) => o.charging === charging);
}

function OptionCell({
  option,
  showBudget = false,
}: {
  option: ReturnType<typeof optionFor>;
  showBudget?: boolean;
}) {
  if (!option || !option.optionId) {
    return <span className="text-xs font-medium text-ink-400">Not configured</span>;
  }
  return (
    <div className="space-y-1">
      <StatusBadge
        label={option.isActive ? 'Enabled' : 'Disabled'}
        tone={option.isActive ? 'success' : 'neutral'}
        dot
      />
      {showBudget ? (
        <p className="whitespace-nowrap text-xs tabular-nums text-ink-600">
          {option.budgetMinPaise != null && option.budgetMaxPaise != null
            ? `${formatINR(option.budgetMinPaise)} – ${formatINR(option.budgetMaxPaise)}`
            : 'Range not set'}
        </p>
      ) : (
        <p className="whitespace-nowrap text-xs tabular-nums text-ink-600">
          {option.pricePaise != null
            ? `${formatINR(option.pricePaise)} published`
            : option.isActive
              ? 'On · price on Pricing screen'
              : 'Not published'}
        </p>
      )}
      <p className="sr-only">{CHARGING_LABEL[option.charging]}</p>
    </div>
  );
}
