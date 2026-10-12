'use client';

import { useState } from 'react';
import { DataTable } from '@/components/admin/DataTable';
import { CategoryStatusControl } from '@/components/admin/StatusControls';
import { BulkButton, BulkCheckbox, BulkResultBanner, BulkToolbar } from '@/components/admin/BulkControls';
import { useSelection } from '@/components/admin/useSelection';
import { useBulkAction } from '@/components/admin/useBulkAction';
import { ConfirmDialog } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import type { AdminCategoryRow } from '@/lib/admin-catalog';

/**
 * CATEGORY TABLE WITH BULK ACTIVATION
 *
 * Wraps the dense server-rendered table with row selection and a bulk toolbar.
 *
 * ONLY activation is offered in bulk. The 20 official categories have an
 * authoritative name, code and position that are never edited or deleted; the
 * server schema enforces this, and the UI simply does not present any other
 * bulk action. Selecting rows and toggling availability goes through
 * `POST /api/admin/categories/bulk`, which re-validates every id and audits the
 * change - the table re-renders from the database afterwards, so the badges
 * never flip optimistically.
 */
export function CategoryBulkTable({ rows }: { rows: AdminCategoryRow[] }) {
  const selection = useSelection(rows, (c) => c.id);
  const { run, busy, error, clearError } = useBulkAction();
  const [confirm, setConfirm] = useState<null | 'ACTIVATE' | 'DEACTIVATE'>(null);
  const [result, setResult] = useState<
    | { tone: 'success' | 'warning' | 'danger'; title: string; details?: string[] }
    | null
  >(null);

  async function apply(action: 'ACTIVATE' | 'DEACTIVATE') {
    setConfirm(null);
    const res = await run<{
      result: { requested: number; affected: number; notFound: string[] };
    }>('/api/admin/categories/bulk', { ids: selection.selected, action });

    if (res.ok) {
      const { affected, notFound } = res.data.result;
      const details =
        notFound.length > 0 ? [`${notFound.length} record(s) no longer exist and were skipped.`] : [];
      setResult({
        tone: affected > 0 ? 'success' : 'warning',
        title: `${affected} categor${affected === 1 ? 'y' : 'ies'} ${action === 'ACTIVATE' ? 'activated' : 'deactivated'}.`,
        details,
      });
      selection.clear();
    }
  }

  const activating = confirm === 'ACTIVATE';

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
        <BulkButton
          tone="primary"
          icon={<Icon name="check-circle" size={13} />}
          disabled={busy}
          onClick={() => setConfirm('ACTIVATE')}
        >
          Activate
        </BulkButton>
        <BulkButton
          tone="danger"
          icon={<Icon name="close" size={13} />}
          disabled={busy}
          onClick={() => setConfirm('DEACTIVATE')}
        >
          Deactivate
        </BulkButton>
      </BulkToolbar>

      <CategoryTable rows={rows} selection={selection} />

      <ConfirmDialog
        open={confirm !== null}
        tone={activating ? 'default' : 'danger'}
        title={
          activating
            ? `Activate ${selection.count} categor${selection.count === 1 ? 'y' : 'ies'}?`
            : `Deactivate ${selection.count} categor${selection.count === 1 ? 'y' : 'ies'}?`
        }
        description={
          activating
            ? 'They will appear in the customer catalogue and become bookable. Names, codes and positions are unchanged.'
            : 'They will disappear from the customer catalogue. Existing bookings and all catalogue records are kept.'
        }
        confirmLabel={activating ? 'Activate' : 'Deactivate'}
        busy={busy}
        onConfirm={() => confirm && apply(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** The presentational table with a leading selection column. */
function CategoryTable({
  rows,
  selection,
}: {
  rows: AdminCategoryRow[];
  selection: ReturnType<typeof useSelection<AdminCategoryRow>>;
}) {
  return (
    <DataTable
      caption="Official service categories with service counts and availability"
      rows={rows}
      rowKey={(c) => c.id}
      empty={
        <p className="px-6 py-10 text-center text-sm text-ink-500">
          The database contains no service categories yet.
        </p>
      }
      columns={[
        {
          key: 'select',
          header: (
            <BulkCheckbox
              checked={selection.allOnPageSelected}
              indeterminate={selection.someOnPageSelected}
              onChange={selection.toggleAllOnPage}
              label={`Select all ${rows.length} categories on this page`}
            />
          ),
          className: 'w-10',
          cell: (c) => (
            <BulkCheckbox
              checked={selection.isSelected(c.id)}
              onChange={() => selection.toggle(c.id)}
              label={`Select ${c.name}`}
            />
          ),
        },
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
              <span className="font-semibold tabular-nums text-ink-800">{c.activeServiceCount}</span>
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
            <StatusBadge label={c.isActive ? 'Active' : 'Inactive'} tone={c.isActive ? 'success' : 'neutral'} dot />
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
  );
}
