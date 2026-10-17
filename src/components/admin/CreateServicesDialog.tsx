'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { InlineError } from '@/components/admin/StatusControls';
import { SERVICE_TYPES, SERVICE_TYPE_LABEL } from '@/lib/domain';

export type CategoryTree = Array<{
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  subCategories: Array<{ id: string; name: string; slug: string; isActive: boolean }>;
}>;

type DraftRow = { id: number; name: string; serviceType: (typeof SERVICE_TYPES)[number] };

/**
 * ADD SERVICES DIALOG
 *
 * Creates one or more services under a real, existing subcategory chosen from
 * the database-backed category tree. The operator picks a category, then a
 * subcategory, then lists the service names to add - each row gets a service
 * type, and rows can be added or removed.
 *
 * WHAT IS NOT HERE IS DELIBERATE: there is no price field. Publishing a price is
 * a commercial decision made through its own audited endpoint, and every new
 * service is created with its three charging options disabled and unpriced,
 * exactly as the seed does. The server derives the slug and re-validates every
 * row; this dialog is UX only.
 */
export function CreateServicesDialog({
  open,
  busy,
  error,
  tree,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  tree: CategoryTree;
  onClose: () => void;
  onCreate: (services: Array<{ subCategoryId: string; name: string; serviceType: string; isActive: boolean }>) => void;
}) {


  const [categoryId, setCategoryId] = useState(() => tree[0]?.id ?? '');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<DraftRow[]>([{ id: 1, name: '', serviceType: 'REPAIR' }]);
  const [nextId, setNextId] = useState(2);



  const subCategories = useMemo(
    () => tree.find((c) => c.id === categoryId)?.subCategories ?? [],
    [tree, categoryId],
  );

  if (!open) return null;

  const validRows = rows.filter((r) => r.name.trim().length > 0);
  const canSubmit = subCategoryId.length > 0 && validRows.length > 0 && !busy;

  function addRow() {
    setRows((prev) => [...prev, { id: nextId, name: '', serviceType: 'REPAIR' }]);
    setNextId((n) => n + 1);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function updateRow(id: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function submit() {
    if (!canSubmit) return;
    onCreate(
      validRows.map((r) => ({
        subCategoryId,
        name: r.name.trim(),
        serviceType: r.serviceType,
        isActive,
      })),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-900/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-services-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl animate-slide-up flex-col rounded-card bg-white shadow-overlay"
      >
        <div className="border-b border-ink-200 px-4 pt-4 pb-3">
          <h2 id="create-services-title" className="text-base font-semibold text-ink-900">
            Add services
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Place one or more services under an existing subcategory. Pricing and charging options are
            configured afterwards on each service.
          </p>
        </div>
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Category
              </span>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubCategoryId('');
                }}
                className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
              >
                {tree.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Subcategory
              </span>
              <select
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
              >
                <option value="">Select a subcategory…</option>
                {subCategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Services to add
              </span>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50"
              >
                <Icon name="plus" size={13} />
                Add another
              </button>
            </div>

            {rows.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-xs tabular-nums text-ink-400">{index + 1}.</span>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  maxLength={80}
                  placeholder="Service name"
                  aria-label={`Service ${index + 1} name`}
                  className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
                />
                <select
                  value={row.serviceType}
                  onChange={(e) => updateRow(row.id, { serviceType: e.target.value as (typeof SERVICE_TYPES)[number] })}
                  aria-label={`Service ${index + 1} type`}
                  className="w-44 rounded-lg border border-ink-300 bg-white px-2 py-2 text-sm text-ink-800 focus:border-brand-500"
                >
                  {SERVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SERVICE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length <= 1}
                  aria-label={`Remove service ${index + 1}`}
                  className="rounded-lg p-1.5 text-ink-400 transition hover:bg-danger-bg hover:text-danger disabled:opacity-30"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Activate immediately (bookable in the customer catalogue)
          </label>

          {error && <InlineError message={error} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-50"
          >
            <Icon name="plus" size={14} />
            {busy ? 'Creating…' : `Create ${validRows.length || ''} service${validRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
