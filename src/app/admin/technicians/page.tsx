import { requireAdminPage } from '@/lib/admin-page-guard';
import { listTechnicians } from '@/lib/technicians';
import { adminTechnicianQuerySchema, normaliseSearchParams } from '@/lib/validation';
import { getTechnicianFeatures } from '@/lib/technician-features';
import { Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { ErrorState } from '@/components/ui/States';
import { TechnicianTable } from '@/components/admin/technicians/TechnicianTable';
import { CreateTechnicianDialog } from '@/components/admin/technicians/TechnicianDialogs';
import { TechnicianFeaturePanel } from '@/components/admin/technicians/TechnicianFeaturePanel';

/**
 * TECHNICIAN ROSTER
 *
 * The directory: search, active/availability filters, server-side paging, and -
 * while technician management is enabled - creation, editing, activation,
 * availability and account provisioning.
 *
 * THREE INDEPENDENT LAYERS, and none of them is a hidden button:
 *   - this page re-checks the ADMIN role server-side (`requireAdminPage`);
 *   - when management is switched off the page renders the roster read-only AND
 *     every management API refuses the call server-side;
 *   - assignment eligibility is re-decided by the assign endpoint, so a stale
 *     page cannot dispatch work to someone who has since been made unavailable.
 *
 * The feature panel is ALWAYS rendered, even with management off: it is the only
 * way to switch it back on without database access.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminTechniciansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/technicians');

  // `.strict()` means an unrecognised query parameter is rejected rather than
  // forwarded into a database filter.
  const raw = normaliseSearchParams(await searchParams);
  const parsed = adminTechnicianQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminTechnicianQuerySchema.parse({});

  const features = await getTechnicianFeatures();

  let rows: Awaited<ReturnType<typeof listTechnicians>>;
  try {
    rows = await listTechnicians(query);
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader title="Technicians" description="The field roster." />
        <ErrorState description="The technician roster could not be loaded. Please try again." />
        <TechnicianFeaturePanel features={features} />
      </div>
    );
  }


  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.status !== 'ALL') params.set('status', query.status);
    if (query.availability !== 'ALL') params.set('availability', query.availability);
    params.set('page', String(page));
    return `/admin/technicians?${params.toString()}`;
  };

  const hasFilters = Boolean(query.q) || query.status !== 'ALL' || query.availability !== 'ALL';
  const assignable = rows.items.filter((t) => t.eligibility === 'ASSIGNABLE').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technicians"
        description="The field roster: who exists, whether they are active, whether they can take new work, and whether they have a portal login."
        actions={
          features.adminManagementEnabled ? (
            <CreateTechnicianDialog portalEnabled={features.portalEnabled} />
          ) : (
            <span className="rounded-lg bg-neutral-bg px-3 py-2 text-xs font-semibold text-neutral ring-1 ring-inset ring-ink-200">
              Management switched off
            </span>
          )
        }
      />

      {!features.adminManagementEnabled && (
        <Notice tone="warning">
          Technician management is switched off in the platform configuration. This roster is
          read-only, creation and editing are refused by the server, and{' '}
          <strong>existing technicians, assignments and booking history are untouched</strong>.
          Turn it back on in the configuration panel below.
        </Notice>
      )}

      {!features.portalEnabled && (
        <Notice tone="neutral">
          The technician portal is switched off, so no technician can sign in and no new login
          accounts are provisioned. Roster records and assignment keep working.
        </Notice>
      )}

      <Toolbar action="/admin/technicians" query={{ q: query.q, pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Name, phone, skill or area"
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Deactivated' },
          ]}
        />
        <SelectField
          name="availability"
          label="Assignment"
          defaultValue={query.availability}
          options={[
            { value: 'ALL', label: 'Any' },
            { value: 'AVAILABLE', label: 'Available' },
            { value: 'UNAVAILABLE', label: 'Unavailable' },
          ]}
        />
      </Toolbar>

      {rows.total > 0 && (
        <p className="text-xs text-ink-500">
          <span className="font-semibold tabular-nums text-ink-700">{assignable}</span> of{' '}
          <span className="font-semibold tabular-nums text-ink-700">{rows.items.length}</span> on
          this page can currently take new work.
        </p>
      )}

      <TechnicianTable
        rows={rows.items}
        canManage={features.adminManagementEnabled}
        portalEnabled={features.portalEnabled}
        hasFilters={hasFilters}
      />

      <Pager page={rows.page} pageSize={rows.pageSize} total={rows.total} buildHref={buildHref} />

      <TechnicianFeaturePanel features={features} />
    </div>
  );
}
