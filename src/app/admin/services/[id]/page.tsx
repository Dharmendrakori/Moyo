import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { countServiceQuotedBookings, getAdminService } from '@/lib/admin-catalog';
import { CHARGING_LABEL, CHARGING_OPTIONS, SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/domain';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { ServiceStatusControl } from '@/components/admin/StatusControls';
import { ChargingOptionControl } from '@/components/admin/ChargingOptionControl';
import { PriceControl } from '@/components/admin/PriceControl';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';

/**
 * SERVICE DETAIL
 *
 * Everything about one service, read from the database.
 *
 * WHAT IS EDITABLE HERE, AND WHY SO LITTLE:
 * Only two things are operationally changeable, and both are the server's
 * decision, not the browser's:
 *
 *   1. Activation, via `PATCH /api/admin/services/:id` whose `.strict()` schema
 *      carries `isActive` and nothing else.
 *   2. Charging-option configuration and published pricing, through their own
 *      dedicated endpoints with their own schemas and their own audit actions.
 *
 * Name, slug, serviceType, category and sub-category are rendered READ-ONLY.
 * They are absent from every mutation schema, so they cannot be mass-assigned
 * even by a hand-crafted request, let alone from this screen.
 *
 * The "agreed quotes" figure below is informational. It counts bookings that
 * carry a fixed quote for this service so the operator understands the
 * consequence of re-pricing. Publishing a price writes ONLY to `ServiceOption`;
 * those bookings keep the figure they were created with.
 */
export const dynamic = 'force-dynamic';

export default async function AdminServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage('/admin/services');

  const { id } = await params;

  const service = await getAdminService(id);
  // `notFound()` renders the 404 boundary. It is deliberately NOT wrapped in a
  // try/catch: it is navigation control flow, not a read failure, and catching
  // it would replace a correct 404 with a misleading "could not load" message.
  if (!service) notFound();

  const quotedBookings = await countServiceQuotedBookings(id);
  const typeLabel = SERVICE_TYPE_LABEL[service.serviceType as ServiceType] ?? service.serviceType;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/services"
          className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 transition hover:text-brand-600"
        >
          ← All services
        </Link>
      </div>

      <PageHeader
        title={service.name}
        description={`${service.subCategory.category.name} · ${service.subCategory.name}`}
        actions={
          <ServiceStatusControl serviceId={service.id} isActive={service.isActive} name={service.name} />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <DetailTile label="Status">
          <StatusBadge
            label={service.isActive ? 'Active' : 'Inactive'}
            tone={service.isActive ? 'success' : 'neutral'}
            dot
          />
        </DetailTile>
        <DetailTile label="Service type">
          <StatusBadge label={typeLabel} tone="brand" />
        </DetailTile>
        <DetailTile label="Published prices">
          <span className="text-sm font-semibold tabular-nums text-ink-800">
            {service.options.filter((o) => o.isActive && o.pricePaise != null).length} of{' '}
            {service.options.length}
          </span>
        </DetailTile>
      </div>

      <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink-900">Catalogue record</h2>
        <p className="mt-1 text-xs text-ink-500">
          These fields are authoritative and read-only. They are not editable through any admin
          endpoint.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Slug">
            <code className="font-mono text-xs">{service.slug}</code>
          </Field>
          <Field label="Category">
            {service.subCategory.category.name}{' '}
            <span className="text-xs text-ink-400">(position {service.subCategory.category.position})</span>
          </Field>
          <Field label="Sub-category">{service.subCategory.name}</Field>
          <Field label="Created">{formatDate(service.createdAt)}</Field>
          <Field label="Last updated">{formatDateTime(service.updatedAt)}</Field>
          <Field label="Bookings">{service._count.bookings}</Field>
        </dl>
        {service.description && (
          <p className="mt-4 border-t border-ink-100 pt-4 text-sm leading-relaxed text-ink-600">
            {service.description}
          </p>
        )}
        {service.includedWork && (
          <p className="mt-3 text-sm leading-relaxed text-ink-600">
            <span className="font-semibold text-ink-800">Covers: </span>
            {service.includedWork}
          </p>
        )}
      </section>

      {quotedBookings > 0 && (
        <Notice tone="warning">
          {quotedBookings} existing booking{quotedBookings === 1 ? '' : 's'} hold a fixed quote for
          this service. Changing or withdrawing a published price does <strong>not</strong> alter
          them: each booking keeps the price it was created with.
        </Notice>
      )}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Charging options and pricing</h2>
          <p className="mt-1 text-xs text-ink-500">
            The three official charging concepts. Enabling an option and publishing its price are
            separate, separately audited actions.
          </p>
        </div>

        {service.options.length === 0 ? (
          <div className="rounded-card border border-ink-200 bg-white">
            <EmptyState
              icon="receipt"
              title="No charging options configured"
              description="This service has no charging options, so it cannot be quoted."
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {CHARGING_OPTIONS.map((charging) => {
              const option = service.options.find((o) => o.charging === charging);
              const label = CHARGING_LABEL[charging];
              return (
                <li
                  key={charging}
                  className="rounded-card border border-ink-200 bg-white p-4 shadow-card"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 sm:w-64">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink-900">{label}</p>
                        <StatusBadge
                          label={option?.isActive ? 'Offered' : 'Not offered'}
                          tone={option?.isActive ? 'success' : 'neutral'}
                          dot
                        />
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-500">
                        {charging === 'CUSTOMER_BUDGET'
                          ? 'Customer states a budget; the provider confirms scope. No fixed price applies.'
                          : charging === 'VISIT_CHARGE'
                            ? 'A published visit charge applies to the technician visit.'
                            : 'A published fixed price applies for this service.'}
                      </p>
                      {option?.charging === 'CUSTOMER_BUDGET' && (
                        <p className="mt-2 text-xs tabular-nums text-ink-600">
                          Budget range:{' '}
                          {option.budgetMinPaise != null && option.budgetMaxPaise != null
                            ? `${formatINR(option.budgetMinPaise)} – ${formatINR(option.budgetMaxPaise)}`
                            : 'not set'}
                        </p>
                      )}
                      {option?.durationMinMinutes != null && (
                        <p className="mt-1 text-xs text-ink-500">
                          Expected duration: {option.durationMinMinutes} min
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:w-72 sm:items-end">
                      {option ? (
                        <>
                          <div className="sm:text-right">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                              Published price
                            </p>
                            <div className="mt-1">
                              <PriceControl
                                optionId={option.id}
                                chargingLabel={label}
                                pricePaise={option.pricePaise}
                                isActive={option.isActive}
                                disabledReason={
                                  charging === 'CUSTOMER_BUDGET'
                                    ? 'Customer Budget is quoted by scope, not a fixed price.'
                                    : !option.isActive
                                      ? 'Enable this option before publishing a price.'
                                      : !service.isActive
                                        ? 'Activate the service before publishing a price.'
                                        : null
                                }
                              />
                            </div>
                          </div>
                          <ChargingOptionControl
                            optionId={option.id}
                            charging={option.charging}
                            isActive={option.isActive}
                            budgetMinPaise={option.budgetMinPaise}
                            budgetMaxPaise={option.budgetMaxPaise}
                            serviceName={service.name}
                          />
                        </>
                      ) : (
                        <p className="text-xs text-ink-400">Not configured</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DetailTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-1 text-sm text-ink-700">{children}</dd>
    </div>
  );
}
