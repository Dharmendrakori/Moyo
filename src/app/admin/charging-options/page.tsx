import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAdminChargingOptions } from '@/lib/admin-catalog';
import { CHARGING_HINT, CHARGING_LABEL, CHARGING_OPTIONS } from '@/lib/domain';
import { Notice, PageHeader } from '@/components/admin/DataTable';
import { ChargingOptionControl } from '@/components/admin/ChargingOptionControl';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatINR } from '@/lib/format';

/**
 * CHARGING OPTION ADMINISTRATION
 *
 * The three official charging concepts, presented exactly as the domain model
 * defines them in `src/lib/domain.ts`:
 *
 *   1. Visit Charge     - a published charge for the technician visit
 *   2. Fixed Charge     - a published fixed price for the service
 *   3. Customer Budget  - the customer states a min/max budget and the provider
 *                         confirms what can be delivered within it
 *
 * These concepts are NOT invented here and NOT restated as a new set. They are
 * the values already seeded onto every `ServiceOption` row, read back from the
 * database and grouped for display.
 *
 * NO PRICES ARE INVENTED. The seed deliberately creates all three options per
 * service as INACTIVE with `pricePaise = null`, so until a commercial decision
 * is published this screen honestly reads "Not published" and the customer site
 * shows its neutral "on request" state.
 *
 * This screen configures availability and budget bounds ONLY. Publishing a price
 * is a separate action on /admin/pricing with its own schema and its own audit
 * action, because enabling an option must never expose a price by accident.
 */
export const dynamic = 'force-dynamic';

export default async function AdminChargingOptionsPage() {
  await requireAdminPage('/admin/charging-options');

  let options: Awaited<ReturnType<typeof listAdminChargingOptions>>;
  try {
    options = await listAdminChargingOptions();
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Charging options"
          description="Visit Charge, Fixed Charge and Customer Budget."
        />
        <ErrorState description="Charging options could not be loaded. Please try again." />
      </div>
    );
  }

  const offered = options.filter((o) => o.isActive).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Charging options"
        description="Which charging options MOYO offers on each service, and the customer budget range where that applies. Prices are managed separately under Pricing."
        actions={
          <Link
            href="/admin/pricing"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Manage pricing
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryTile label="Option rows" value={options.length} />
        <SummaryTile label="Currently offered" value={offered} />
        <SummaryTile label="Not offered" value={options.length - offered} />
        <SummaryTile
          label="Services covered"
          value={new Set(options.filter((o) => o.isActive).map((o) => o.serviceId)).size}
        />
      </div>

      <Notice tone="info">
        These three concepts are the official charging model and are preserved as they are. This
        screen controls availability and the Customer Budget range only. A published price is set
        on the Pricing screen, so enabling an option never exposes a price by itself.
      </Notice>

      {options.length === 0 ? (
        <div className="rounded-card border border-ink-200 bg-white">
          <EmptyState
            icon="receipt"
            title="No charging options in the database"
            description="Charging options are created when the catalogue is seeded."
          />
        </div>
      ) : (
        CHARGING_OPTIONS.map((charging) => {
          const rows = options.filter((o) => o.charging === charging);
          const label = CHARGING_LABEL[charging];
          const enabled = rows.filter((r) => r.isActive).length;

          return (
            <section key={charging} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink-900">{label}</h2>
                  <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-500">
                    {CHARGING_HINT[charging]}
                  </p>
                </div>
                <StatusBadge
                  label={`${enabled} of ${rows.length} offered`}
                  tone={enabled > 0 ? 'success' : 'neutral'}
                />
              </div>

              {rows.length === 0 ? (
                <div className="rounded-card border border-ink-200 bg-white">
                  <EmptyState
                    icon="receipt"
                    title="Not configured"
                    description={`No service currently defines ${label}.`}
                    className="py-8"
                  />
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                  {rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-col rounded-card border border-ink-200 bg-white p-3 shadow-card transition-colors hover:border-ink-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/admin/services/${row.serviceId}`}
                            title={row.serviceName}
                            className="block truncate text-sm font-semibold text-ink-900 transition hover:text-brand-600"
                          >
                            {row.serviceName}
                          </Link>
                          <p
                            title={`${row.categoryName} · ${row.subCategoryName}`}
                            className="truncate text-xs text-ink-400"
                          >
                            {row.categoryName} · {row.subCategoryName}
                          </p>
                        </div>
                        <StatusBadge
                          label={row.isActive ? 'On' : 'Off'}
                          tone={row.isActive ? 'success' : 'neutral'}
                          dot
                          className="shrink-0"
                        />
                      </div>

                      {row.charging === 'CUSTOMER_BUDGET' && (
                        <p className="mt-1.5 truncate text-xs tabular-nums text-ink-600">
                          {row.budgetMinPaise != null && row.budgetMaxPaise != null
                            ? `${formatINR(row.budgetMinPaise)} – ${formatINR(row.budgetMaxPaise)}`
                            : 'Budget range not set'}
                        </p>
                      )}

                      {!row.serviceActive && (
                        <p className="mt-1.5 text-[11px] font-medium text-warning">
                          Service is deactivated, so this option is not reachable by customers.
                        </p>
                      )}

                      <div className="mt-2 border-t border-ink-100 pt-2">
                        <ChargingOptionControl
                          optionId={row.id}
                          charging={row.charging}
                          isActive={row.isActive}
                          budgetMinPaise={row.budgetMinPaise}
                          budgetMaxPaise={row.budgetMaxPaise}
                          serviceName={row.serviceName}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-3 shadow-card">
      <p className="truncate text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
