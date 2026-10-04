import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAdminCategories } from '@/lib/admin-catalog';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { CategoryStatusControl } from '@/components/admin/StatusControls';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/format';

/**
 * CATEGORY ADMINISTRATION
 *
 * The 20 official service categories, READ FROM THE DATABASE. There is no
 * client-side copy of the list anywhere in this file: a duplicated constant
 * would drift from the catalogue and could show a category the database does
 * not contain.
 *
 * Name, code and position are rendered READ-ONLY. They are the authoritative
 * official catalogue identity, are absent from the mutation schema, and are not
 * editable by design. Only availability is operationally changeable, and that
 * goes through `PATCH /api/admin/categories/:id`, which enforces the admin role,
 * CSRF, Origin and rate limiting on the server.
 *
 * The page also re-checks the role itself, so it stays safe even if the layout
 * guard were ever removed.
 */
export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  await requireAdminPage();

  let categories: Awaited<ReturnType<typeof listAdminCategories>>;
  try {
    categories = await listAdminCategories();
  } catch {
    // A generic message only. The underlying error is logged server-side and is
    // never serialized into the response.
    return (
      <div className="space-y-6">
        <PageHeader title="Categories" description="The official MOYO service catalogue." />
        <ErrorState description="The category list could not be loaded. Please try again." />
      </div>
    );
  }

  const activeCount = categories.filter((c) => c.isActive).length;
  const totalServices = categories.reduce((sum, c) => sum + c.serviceCount, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description={`The ${categories.length} official service categories, read from the catalogue database. Names and positions are authoritative and are not editable here.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile label="Categories" value={categories.length} />
        <SummaryTile label="Active" value={activeCount} />
        <SummaryTile
          label="Inactive"
          value={categories.length - activeCount}
          hint={categories.length - activeCount === 0 ? 'All categories are live' : undefined}
        />
        <SummaryTile label="Services in catalogue" value={totalServices} />
      </div>

      <Notice tone="info">
        The category names, codes and positions are the official service specification and are
        preserved as-is. Deactivating a category hides it from customers but keeps every record and
        all booking history intact.
      </Notice>

      <DataTable
        caption="Official service categories with service counts and availability"
        rows={categories}
        rowKey={(c) => c.id}
        empty={
          <EmptyState
            icon="grid"
            title="No categories in the catalogue"
            description="The database contains no service categories yet."
          />
        }
        columns={[
          {
            key: 'position',
            header: '#',
            numeric: true,
            className: 'w-12',
            cell: (c) => <span className="tabular-nums text-ink-400">{c.position}</span>,
          },
          {
            key: 'name',
            header: 'Category',
            cell: (c) => (
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">{c.name}</p>
                <p className="truncate text-xs text-ink-400">
                  <code className="font-mono">{c.slug}</code>
                  <span className="mx-1.5">·</span>
                  <code className="font-mono">{c.code}</code>
                </p>
              </div>
            ),
          },
          {
            key: 'services',
            header: 'Services',
            numeric: true,
            className: 'w-28',
            cell: (c) => (
              <span>
                <span className="font-semibold tabular-nums text-ink-800">
                  {c.activeServiceCount}
                </span>
                <span className="tabular-nums text-ink-400"> / {c.serviceCount}</span>
              </span>
            ),
          },
          {
            key: 'subs',
            header: 'Subcategories',
            numeric: true,
            className: 'w-28',
            secondary: true,
            cell: (c) => <span className="tabular-nums">{c.subCategoryCount}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            className: 'w-28',
            cell: (c) => (
              <StatusBadge
                label={c.isActive ? 'Active' : 'Inactive'}
                tone={c.isActive ? 'success' : 'neutral'}
                dot
              />
            ),
          },
          {
            key: 'updated',
            header: 'Updated',
            secondary: true,
            className: 'w-32',
            cell: (c) => <span className="text-xs text-ink-500">{formatDate(c.updatedAt)}</span>,
          },
          {
            key: 'actions',
            header: 'Action',
            className: 'w-32',
            cell: (c) => <CategoryStatusControl categoryId={c.id} isActive={c.isActive} name={c.name} />,
          },
        ]}
      />
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-ink-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
