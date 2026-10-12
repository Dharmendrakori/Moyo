'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/admin/DataTable';
import { ServiceStatusControl } from '@/components/admin/StatusControls';
import { BulkButton, BulkCheckbox, BulkResultBanner, BulkToolbar } from '@/components/admin/BulkControls';
import { BulkEditServiceDialog } from '@/components/admin/BulkEditServiceDialog';
import { CreateServicesDialog, type CategoryTree } from '@/components/admin/CreateServicesDialog';
import { useSelection } from '@/components/admin/useSelection';
import { useBulkAction } from '@/components/admin/useBulkAction';
import { ConfirmDialog } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';
import { CHARGING_LABEL, SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/domain';
import type { AdminServiceListItem } from '@/lib/admin-catalog';

type Result =
  | { tone: 'success' | 'warning' | 'danger'; title: string; details?: string[] }
  | null;

/**
 * SERVICE TABLE WITH BULK MANAGEMENT
 *
 * Wraps the dense server-rendered service table with row selection and a bulk
 * toolbar supporting activate, deactivate, edit, delete and create.
 *
 * EVERY mutation goes through the server (`POST /api/admin/services/bulk` or
 * `POST /api/admin/services`), which re-validates every id and field, enforces
 * the admin session/CSRF/Origin, and audits the change. The table then
 * re-renders from the database, so a badge never flips optimistically.
 *
 * DELETE is the sensitive one: the server refuses to remove any service that is
 * referenced by a booking and reports it back, and the confirmation dialog says
 * so up front. The result banner lists exactly which records were protected.
 */
export function ServiceBulkTable({
  rows,
  tree,
  hasFilters,
}: {
  rows: AdminServiceListItem[];
  tree: CategoryTree;
  hasFilters: boolean;
}) {
  const selection = useSelection(rows, (s) => s.id);
  const { run, busy, error, clearError } = useBulkAction();
  const [confirm, setConfirm] = useState<null | 'ACTIVATE' | 'DEACTIVATE' | 'DELETE'>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function status(action: 'ACTIVATE' | 'DEACTIVATE') {
    setConfirm(null);
    const res = await run<{ result: { affected: number; notFound: string[] } }>('/api/admin/services/bulk', {
      ids: selection.selected,
      action,
    });
    if (res.ok) {
      const { affected, notFound } = res.data.result;
      setResult({
        tone: affected > 0 ? 'success' : 'warning',
        title: `${affected} service${affected === 1 ? '' : 's'} ${action === 'ACTIVATE' ? 'activated' : 'deactivated'}.`,
        details: notFound.length > 0 ? [`${notFound.length} record(s) no longer exist and were skipped.`] : [],
      });
      selection.clear();
    }
  }

  async function remove() {
    setConfirm(null);
    const res = await run<{
      result: { affected: number; notFound: string[]; protected?: Array<{ name: string; reason: string }> };
    }>('/api/admin/services/bulk', { ids: selection.selected, action: 'DELETE' });
    if (res.ok) {
      const { affected, notFound, protected: protectedRecords } = res.data.result;
      const details: string[] = [];
      (protectedRecords ?? []).forEach((p) => details.push(`${p.name} — ${p.reason}`));
      if (notFound.length > 0) details.push(`${notFound.length} record(s) no longer exist and were skipped.`);
      setResult({
        tone: affected > 0 && (protectedRecords ?? []).length === 0 ? 'success' : 'warning',
        title:
          (protectedRecords ?? []).length > 0
            ? `${affected} deleted, ${(protectedRecords ?? []).length} protected.`
            : `${affected} service${affected === 1 ? '' : 's'} deleted.`,
        details,
      });
      selection.clear();
    }
  }

  async function edit(patch: {
    serviceType?: ServiceType;
    description?: string;
    includedWork?: string;
  }) {
    const res = await run<{ result: { affected: number; notFound: string[] } }>('/api/admin/services/bulk', {
      ids: selection.selected,
      action: 'EDIT',
      patch,
    });
    if (res.ok) {
      const { affected, notFound } = res.data.result;
      setEditing(false);
      setResult({
        tone: 'success',
        title: `Updated ${affected} service${affected === 1 ? '' : 's'}.`,
        details: notFound.length > 0 ? [`${notFound.length} record(s) no longer exist and were skipped.`] : [],
      });
      selection.clear();
    }
  }

  async function create(
    services: Array<{ subCategoryId: string; name: string; serviceType: string; isActive: boolean }>,
  ) {
    const res = await run<{
      result: { created?: Array<{ name: string }>; skipped?: Array<{ name: string; reason: string }> };
    }>('/api/admin/services', { services });
    if (res.ok) {
      const created = res.data.result.created ?? [];
      const skipped = res.data.result.skipped ?? [];
      setCreating(false);
      setResult({
        tone: created.length > 0 ? 'success' : 'warning',
        title: `Created ${created.length} service${created.length === 1 ? '' : 's'}${
          skipped.length > 0 ? `, ${skipped.length} skipped` : ''
        }.`,
        details: skipped.map((s) => `${s.name} — ${s.reason}`),
      });
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
        <BulkButton icon={<Icon name="edit" size={13} />} disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </BulkButton>
        <BulkButton
          tone="danger"
          icon={<Icon name="trash" size={13} />}
          disabled={busy}
          onClick={() => setConfirm('DELETE')}
        >
          Delete
        </BulkButton>
      </BulkToolbar>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Icon name="plus" size={15} />
          Add services
        </button>
      </div>

      <ServiceTable rows={rows} hasFilters={hasFilters} selection={selection} />

      <ConfirmDialog
        open={confirm === 'ACTIVATE' || confirm === 'DEACTIVATE'}
        tone={confirm === 'DEACTIVATE' ? 'danger' : 'default'}
        title={
          confirm === 'DEACTIVATE'
            ? `Deactivate ${selection.count} service${selection.count === 1 ? '' : 's'}?`
            : `Activate ${selection.count} service${selection.count === 1 ? '' : 's'}?`
        }
        description={
          confirm === 'DEACTIVATE'
            ? 'Customers will no longer be able to book these services. Existing bookings and published pricing are kept.'
            : 'These services will appear in the customer catalogue and become bookable.'
        }
        confirmLabel={confirm === 'DEACTIVATE' ? 'Deactivate' : 'Activate'}
        busy={busy}
        onConfirm={() => (confirm === 'DEACTIVATE' ? status('DEACTIVATE') : status('ACTIVATE'))}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'DELETE'}
        tone="danger"
        title={`Delete ${selection.count} service${selection.count === 1 ? '' : 's'}?`}
        description="Any selected service that is referenced by an existing booking will be kept and reported - it can never be deleted. Services with no booking history are removed permanently."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />

      <BulkEditServiceDialog
        open={editing}
        count={selection.count}
        busy={busy}
        error={error}
        onClose={() => setEditing(false)}
        onApply={edit}
      />

      <CreateServicesDialog
        open={creating}
        busy={busy}
        error={error}
        tree={tree}
        onClose={() => setCreating(false)}
        onCreate={create}
      />
    </div>
  );
}

/** The presentational table with a leading selection column. */
function ServiceTable({
  rows,
  hasFilters,
  selection,
}: {
  rows: AdminServiceListItem[];
  hasFilters: boolean;
  selection: ReturnType<typeof useSelection<AdminServiceListItem>>;
}) {
  return (
    <DataTable
      caption="Service catalogue with category, status and pricing coverage"
      rows={rows}
      rowKey={(s) => s.id}
      empty={
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-semibold text-ink-800">No services match these filters</p>
          <p className="mt-1 text-sm text-ink-500">
            {hasFilters ? 'Try clearing the search or filters.' : 'The catalogue contains no services yet.'}
          </p>
        </div>
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
          cell: (s) => (
            <BulkCheckbox
              checked={selection.isSelected(s.id)}
              onChange={() => selection.toggle(s.id)}
              label={`Select ${s.name}`}
            />
          ),
        },
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
            <StatusBadge label={s.isActive ? 'Active' : 'Inactive'} tone={s.isActive ? 'success' : 'neutral'} dot />
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
  );
}
