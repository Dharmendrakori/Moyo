'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { InlineError } from '@/components/admin/StatusControls';
import { SERVICE_TYPES, SERVICE_TYPE_LABEL } from '@/lib/domain';

export type ServiceEditPatch = {
  serviceType?: (typeof SERVICE_TYPES)[number];
  description?: string;
  includedWork?: string;
};

/**
 * BULK EDIT DIALOG (services)
 *
 * Lets an operator change the SUPPORTED, non-identity fields of the selected
 * services in one pass. Only `serviceType`, `description` and `includedWork`
 * are offered - name, slug, placement and price are deliberately absent, since
 * editing them is either identity-changing or has its own audited endpoint.
 *
 * A field is only sent when the operator ticks its "change" box, so an
 * untouched field is never clobbered across the whole selection. The server
 * re-validates independently; this is UX only.
 */
export function BulkEditServiceDialog({
  open,
  count,
  busy,
  error,
  onClose,
  onApply,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (patch: ServiceEditPatch) => void;
}) {
  const [changeType, setChangeType] = useState(false);
  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>('REPAIR');
  const [changeDesc, setChangeDesc] = useState(false);
  const [description, setDescription] = useState('');
  const [changeWork, setChangeWork] = useState(false);
  const [includedWork, setIncludedWork] = useState('');

  // `open` is managed by the parent, which always remounts the dialog via
  // `key={editing ? 'open' : 'closed'}`. State therefore re-initializes to the
  // defaults above on every open. Relying on a `useEffect` that calls `set*`
  // synchronously would trip `react-hooks/set-state-in-effect`, so the reset is
  // achieved by mounting a fresh instance.

  if (!open) return null;

  const anyChange = changeType || changeDesc || changeWork;
  function submit() {
    const patch: ServiceEditPatch = {};
    if (changeType) patch.serviceType = serviceType;
    if (changeDesc) patch.description = description;
    if (changeWork) patch.includedWork = includedWork;
    onApply(patch);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-900/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-title"
        className="relative flex max-h-[90vh] w-full max-w-lg animate-slide-up flex-col rounded-card bg-white shadow-overlay"
      >
        <div className="border-b border-ink-200 px-4 pt-4 pb-3">
          <h2 id="bulk-edit-title" className="text-base font-semibold text-ink-900">
            Edit {count} service{count === 1 ? '' : 's'}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Tick a field to change it for every selected service. Unticked fields are left unchanged.
          </p>
        </div>
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <ChangeToggle checked={changeType} onChange={setChangeType} label="Change service type">
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as (typeof SERVICE_TYPES)[number])}
              className="mt-2 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
            >
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SERVICE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </ChangeToggle>

          <ChangeToggle checked={changeDesc} onChange={setChangeDesc} label="Change description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Leave empty to clear the description."
              className="mt-2 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
            />
          </ChangeToggle>

          <ChangeToggle checked={changeWork} onChange={setChangeWork} label="Change included work">
            <textarea
              value={includedWork}
              onChange={(e) => setIncludedWork(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Leave empty to clear the included work."
              className="mt-2 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
            />
          </ChangeToggle>

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
            disabled={busy || !anyChange}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-50"
          >
            <Icon name="edit" size={14} />
            {busy ? 'Saving…' : 'Apply to selected'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A checkbox-gated field group: the field only applies when ticked. */
function ChangeToggle({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-ink-200 p-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-ink-300 accent-brand-600"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {checked && children}
    </fieldset>
  );
}
