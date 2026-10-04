import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAdminServices, listCategoryOptions } from '@/lib/admin-catalog';
import { adminServiceQuerySchema } from '@/lib/validation';
import { CHARGING_LABEL, CHARGING_OPTIONS, SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/domain';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { ServiceStatusControl } from '@/components/admin/StatusControls';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';

/**
 * SERVICE ADMINISTRATION
 *
 * The catalogue table: search, filtering, pagination and activation control.
 *
 * EVERYTHING SHOWN IS READ FROM THE DATABASE through `listAdminServices`, whose
 * queries use explicit projections. No password hash, session token, IP hash or
 * unrelated personal column is ever fetched, so none can reach the browser.
 *
 * Search and filters are a plain GET form and paging is real links, so the whole
 * view is expressible as a URL: it can be bookmarked, shared, and reached with
 * the back button, without a second copy of the catalogue in the browser.
 *
 * The page re-checks the admin role server-side in addition to the layout guard.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/services');

  // `.strict()` means an unrecognised query parameter is rejected rather than
  // forwarded into a database filter.
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = adminServiceQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminServiceQuerySchema.parse({});

  let rows: Awaited<ReturnType<typeof listAdminServices>>;
  let categories: Array<{ slug: string; name: string }>;
  try {
    [rows, categories] = await Promise.all([listAdminServices(query), listCategoryOptions()]);
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader title="Services" description="The bookable service catalogue." />
        <ErrorState description="The service list could not be loaded. Please try again." />
      </div>
    );
  }
  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.status !== 'ALL') params.set('status', query.status);
    if (query.charging !== 'ALL') params.set('charging', query.charging);
    params.set('page', String(page));
    return `/admin/services?${params.toString()}`;
  };

  const inactiveCount = rows.items.filter((s) => !s.isActive).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="The bookable service catalogue. Activation, charging options and published pricing are managed from here and from the Pricing screen."
      />

      <Toolbar action="/admin/services" query={{ q: query.q, category: query.category, pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Service name or slug"
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
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
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

      {rows.total > 0 && inactiveCount > 0 && (
        <Notice tone="warning">
          {inactiveCount} service{inactiveCount === 1 ? '' : 's'} on this page{' '}
          {inactiveCount === 1 ? 'is' : 'are'} deactivated and will not appear to customers.
        </Notice>
      )}

      <DataTable
        caption="Service catalogue with category, status and pricing coverage"
        rows={rows.items}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            icon="bolt"
            title="No services match these filters"
            description={
              query.q || query.category || query.status !== 'ALL' || query.charging !== 'ALL'
                ? 'Try clearing the search or filters.'
                : 'The catalogue contains no services yet.'
            }
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Service',
            cell: (s) => (
              <div className="min-w-0">
                <Link
                  href={`/admin/services/${s.id}`}
                  className="font-semibold text-ink-900 transition hover:text-brand-600"
                >
                  {s.name}
                </Link>
                <p className="truncate text-xs text-ink-400">
                  <code className="font-mono">{s.slug}</code>
                </p>
              </div>
            ),
          },
          {
            key: 'category',
            header: 'Category',
            cell: (s) => (
              <div className="min-w-0">
                <p className="truncate text-ink-700">{s.categoryName}</p>
                <p className="truncate text-xs text-ink-400">{s.subCategoryName}</p>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            className: 'w-40',
            cell: (s) => (
              <StatusBadge
                label={SERVICE_TYPE_LABEL[s.serviceType as ServiceType] ?? s.serviceType}
                tone="neutral"
              />
            ),
          },
          {
            key: 'charging',
            header: 'Charging',
            className: 'w-52',
            cell: (s) =>
              s.activeCharging.length === 0 ? (
                <span className="text-xs font-medium text-ink-400">None enabled</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {s.activeCharging.map((c) => (
                    <StatusBadge key={c} label={CHARGING_LABEL[c]} tone="brand" />
                  ))}
                </span>
              ),
          },
          {
            key: 'pricing',
            header: 'Pricing',
            numeric: true,
            className: 'w-28',
            cell: (s) => (
              <span
                className={
                  s.publishedCount > 0
                    ? 'text-xs font-semibold tabular-nums text-success'
                    : 'text-xs font-medium tabular-nums text-ink-400'
                }
              >
                {s.publishedCount} published
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            className: 'w-28',
            cell: (s) => (
              <StatusBadge
                label={s.isActive ? 'Active' : 'Inactive'}
                tone={s.isActive ? 'success' : 'neutral'}
                dot
              />
            ),
          },
          {
            key: 'actions',
            header: 'Action',
            className: 'w-32',
            cell: (s) => <ServiceStatusControl serviceId={s.id} isActive={s.isActive} name={s.name} />,
          },
        ]}
      />

      <Pager page={rows.page} pageSize={rows.pageSize} total={rows.total} buildHref={buildHref} />
    </div>
  );
}
