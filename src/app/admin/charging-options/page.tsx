import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAdminChargingServices, listCategoryOptions } from '@/lib/admin-catalog';
import { adminChargingServiceQuerySchema } from '@/lib/validation';
import { CHARGING_LABEL, CHARGING_OPTIONS } from '@/lib/domain';
import { Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { ChargingOptionsTable } from '@/components/admin/ChargingOptionsTable';
import { ErrorState } from '@/components/ui/States';

/**
 * CHARGING OPTION ADMINISTRATION (UNIFIED)
 *
 * One row per service with all three official charging concepts side by side:
 * Visit Charge, Fixed Charge and Customer Budget (see `src/lib/domain.ts`).
 * The previous three duplicated grids are replaced by a single searchable,
 * filterable, paginated table; each service's Configure dialog edits the three
 * underlying `ServiceOption` rows independently through the existing PATCH
 * endpoint, so no setting can overwrite another.
 *
 * NO PRICES ARE INVENTED. Availability and budget bounds are configured here;
 * publishing a price stays a separate action on /admin/pricing with its own
 * schema and audit action, because enabling an option must never expose a
 * price by accident.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminChargingOptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/charging-options');

  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = adminChargingServiceQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminChargingServiceQuerySchema.parse({});

  let rows: Awaited<ReturnType<typeof listAdminChargingServices>>;
  let categories: Array<{ slug: string; name: string }>;
  try {
    [rows, categories] = await Promise.all([
      listAdminChargingServices({
        q: query.q,
        category: query.category,
        charging: query.charging,
        status: query.status,
        page: query.page,
        pageSize: PAGE_SIZE,
      }),
      listCategoryOptions(),
    ]);
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

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.charging !== 'ALL') params.set('charging', query.charging);
    if (query.status !== 'ALL') params.set('status', query.status);
    params.set('page', String(page));
    return `/admin/charging-options?${params.toString()}`;
  };

  const enabledOnPage = rows.items.filter((s) => s.options.some((o) => o.isActive)).length;
  const visitOn = rows.items.filter(
    (s) => s.options.find((o) => o.charging === 'VISIT_CHARGE')?.isActive,
  ).length;
  const budgetOn = rows.items.filter(
    (s) => s.options.find((o) => o.charging === 'CUSTOMER_BUDGET')?.isActive,
  ).length;
  const hasFilters = Boolean(
    query.q || query.category || query.charging !== 'ALL' || query.status !== 'ALL',
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Charging options"
        description="Each service once, with Visit Charge, Fixed Charge and Customer Budget side by side. Availability and the Customer Budget range are configured here; prices are managed separately under Pricing."
        actions={
          <Link
            href="/admin/pricing"
            className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            Manage pricing
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryTile label="Services" value={rows.total} />
        <SummaryTile label="Enabled on this page" value={enabledOnPage} />
        <SummaryTile label="Visit Charge on" value={visitOn} />
        <SummaryTile label="Customer Budget on" value={budgetOn} />
      </div>

      <Notice tone="info">
        These three concepts are the official charging model and are preserved as they are. Configure
        opens one dialog per service; each charging type saves to its own record, so changing one
        never overwrites the other two.
      </Notice>

      <Toolbar
        action="/admin/charging-options"
        query={{ q: query.q, category: query.category, pageSize: String(PAGE_SIZE) }}
      >
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Service name…"
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
          name="charging"
          label="Charging type"
          defaultValue={query.charging}
          options={[
            { value: 'ALL', label: 'Any type enabled' },
            ...CHARGING_OPTIONS.map((c) => ({ value: c, label: `${CHARGING_LABEL[c]} on` })),
          ]}
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'Any status' },
            { value: 'ENABLED', label: 'At least one enabled' },
            { value: 'DISABLED', label: 'All disabled' },
          ]}
        />
      </Toolbar>

      <ChargingOptionsTable rows={rows.items} hasFilters={hasFilters} />

      <Pager page={rows.page} pageSize={rows.pageSize} total={rows.total} buildHref={buildHref} />
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
