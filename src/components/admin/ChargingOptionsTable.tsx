'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ServiceChargingDialog, type ServiceChargingOptionState } from '@/components/admin/ServiceChargingDialog';
import { CHARGING_LABEL } from '@/lib/domain';
import { formatINR } from '@/lib/format';
import type { AdminChargingServiceRow } from '@/lib/admin-catalog';

/**
 * UNIFIED CHARGING-OPTIONS TABLE
 *
 * Each service appears exactly once with its three charging states side by
 * side. The Configure button opens one dialog whose three tabs each PATCH a
 * single `ServiceOption` row through the existing endpoint, so settings stay
 * independent. Horizontally scrollable on narrow screens via DataTable.
 */
export function ChargingOptionsTable({
  rows,
  hasFilters,
}: {
  rows: AdminChargingServiceRow[];
  hasFilters: boolean;
}) {
  const [selected, setSelected] = useState<AdminChargingServiceRow | null>(null);

  return (
    <>
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
                onClick={() => setSelected(r)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
              >
                Configure
              </button>
            ),
          },
        ]}
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
    </>
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
