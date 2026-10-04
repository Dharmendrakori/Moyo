import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAdminPricing, listCategoryOptions, pricingStateOf } from '@/lib/admin-catalog';
import { adminPricingQuerySchema } from '@/lib/validation';
import { CHARGING_LABEL, CHARGING_OPTIONS, toChargingOption } from '@/lib/domain';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { PriceControl } from '@/components/admin/PriceControl';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

/**
 * PUBLISHED PRICING ADMINISTRATION
 *
 * The commercial screen. Everything about how it behaves is deliberate:
 *
 * SERVER-AUTHORITATIVE. The price stored here is the figure the booking domain
 * resolves from (`resolveBookingPricing`). A customer's browser never supplies
 * an amount: the quote and booking routes both read this record and ignore any
 * client figure entirely.
 *
 * NOTHING IS INVENTED. The seed creates every option with `pricePaise = null`.
 * Until a price is genuinely published, this table honestly reads "Not
 * published" and the customer service page keeps showing its neutral
 * "On request" state. No sample or illustrative price is seeded to make this
 * screen look populated.
 *
 * HISTORICAL QUOTES ARE PROTECTED. A booking stores the price it was quoted at
 * creation time. This screen writes only to `ServiceOption`, so publishing or
 * withdrawing a price can never retroactively change an agreed quote. The
 * server enforces this too - the mutation path never touches a Booking row.
 *
 * CUSTOMER BUDGET CARRIES NO FIXED PRICE. In that mode the customer states a
 * budget and the provider confirms scope, so the server rejects a price
 * publication for it and the control is disabled with the reason shown.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const STATE_TONE: Record<string, StatusTone> = {
  PUBLISHED: 'success',
  UNPUBLISHED: 'warning',
  DISABLED: 'neutral',
};

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/pricing');

  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = adminPricingQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminPricingQuerySchema.parse({});

  let rows: Awaited<ReturnType<typeof listAdminPricing>>;
  let categories: Array<{ slug: string; name: string }>;
  try {
    [rows, categories] = await Promise.all([listAdminPricing(query), listCategoryOptions()]);
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader title="Pricing" description="Published prices for each charging option." />
        <ErrorState description="Pricing could not be loaded. Please try again." />
      </div>
    );
  }
  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.state !== 'ALL') params.set('state', query.state);
    if (query.charging !== 'ALL') params.set('charging', query.charging);
    params.set('page', String(page));
    return `/admin/pricing?${params.toString()}`;
  };

  const publishedOnPage = rows.items.filter((r) => r.pricePaise != null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        description="Publish the price customers see and the booking domain quotes. Prices are set here by an administrator and are never taken from the browser."
      />

      <Toolbar action="/admin/pricing" query={{ q: query.q, category: query.category, pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Service name"
        />
        <SelectField
          name="category"
          label="Category"
          defaultValue={query.category ?? ''}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((c) => ({ value: c.slug, label: c.name })),
          ]}
        />
        <SelectField
          name="state"
          label="Publication state"
          defaultValue={query.state}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'UNPUBLISHED', label: 'Not published' },
            { value: 'DISABLED', label: 'Option off' },
          ]}
        />
        <SelectField
          name="charging"
          label="Charging option"
          defaultValue={query.charging}
          options={[
            { value: 'ALL', label: 'Any' },
            ...CHARGING_OPTIONS.map((c) => ({ value: c, label: CHARGING_LABEL[c] })),
          ]}
        />
      </Toolbar>

      <Notice tone="info">
        A published price becomes visible on the customer service page and is used as the
        server-authoritative quote for new bookings. Withdrawing it returns customers to the neutral
        &ldquo;on request&rdquo; message. Neither action changes a price already agreed in an
        existing booking. Customer Budget is quoted by scope and never carries a fixed price.
      </Notice>

      {rows.total > 0 && publishedOnPage === 0 && (
        <Notice tone="warning">
          No price on this page is published. Services here will show customers the neutral
          &ldquo;on request&rdquo; message instead of an amount.
        </Notice>
      )}

      <DataTable
        caption="Published pricing per service and charging option"
        rows={rows.items}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            icon="wallet"
            title="No pricing rows match these filters"
            description={
              query.q || query.category || query.state !== 'ALL' || query.charging !== 'ALL'
                ? 'Try clearing the search or filters.'
                : 'The catalogue contains no pricing rows yet.'
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
                  className="font-semibold text-ink-900 transition hover:text-brand-600"
                >
                  {r.serviceName}
                </Link>
                <p className="truncate text-xs text-ink-400">
                  {r.categoryName} · {r.subCategoryName}
                </p>
              </div>
            ),
          },
          {
            key: 'charging',
            header: 'Charging option',
            className: 'w-44',
            cell: (r) => (
              <StatusBadge
                label={CHARGING_LABEL[toChargingOption(r.charging)]}
                tone={r.charging === 'CUSTOMER_BUDGET' ? 'brand' : 'neutral'}
              />
            ),
          },
          {
            key: 'state',
            header: 'State',
            className: 'w-36',
            cell: (r) => {
              const state = pricingStateOf(r);
              return (
                <StatusBadge
                  label={
                    state === 'PUBLISHED'
                      ? 'Published'
                      : state === 'UNPUBLISHED'
                        ? 'Not published'
                        : 'Option off'
                  }
                  tone={STATE_TONE[state] ?? 'neutral'}
                  dot
                />
              );
            },
          },
          {
            key: 'price',
            header: 'Price',
            className: 'w-64',
            cell: (r) => {
              const charging = toChargingOption(r.charging);
              return (
                <PriceControl
                  optionId={r.id}
                  chargingLabel={CHARGING_LABEL[charging]}
                  pricePaise={r.pricePaise}
                  isActive={r.isActive}
                  disabledReason={
                    charging === 'CUSTOMER_BUDGET'
                      ? 'Quoted by scope, not a fixed price.'
                      : !r.isActive
                        ? 'Enable this option first.'
                        : !r.serviceActive
                          ? 'Activate the service first.'
                          : null
                  }
                />
              );
            },
          },
        ]}
      />

      <Pager page={rows.page} pageSize={rows.pageSize} total={rows.total} buildHref={buildHref} />
    </div>
  );
}
