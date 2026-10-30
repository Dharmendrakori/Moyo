'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

type Technician = {
  id: string;
  displayName: string;
  phone: string | null;
  skills: string | null;
  isActive: boolean;
};

/**
 * TECHNICIAN ASSIGNMENT
 *
 * Renders only for CONFIRMED bookings without a technician. Technicians come
 * from GET /api/admin/technicians - real database rows only. Assignment posts
 * to POST /api/admin/bookings/:id/assign-technician, where the server
 * validates the technician and persists CONFIRMED -> TECHNICIAN_ASSIGNED
 * conditionally, so concurrent assignments cannot overwrite one another. On
 * success the page is refreshed from the database.
 */
export function AssignTechnicianDialog({
  booking,
}: {
  booking: { id: string; reference: string; status: string; technician: { id: string; displayName: string } | null };
}) {
  const router = useRouter();
  const { run, busy, error, clearError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const eligible = booking.status === 'CONFIRMED' && !booking.technician;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/admin/technicians', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { technicians?: unknown } | null;
        setTechnicians(res.ok && data?.technicians ? (data.technicians as Technician[]) : []);
      })
      .catch(() => setTechnicians([]))
      .finally(() => setLoading(false));
  }, [open]);

  async function apply() {
    setOpen(false);
    if (!selected) return;
    const result = await run(`/api/admin/bookings/${booking.id}/assign-technician`, { technicianId: selected }, 'POST');
    if (result.ok) router.refresh();
  }

  const active = technicians.filter((t) => t.isActive);

  if (!eligible) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setOpen(true))}
        disabled={busy}
        aria-label={`Assign technician to ${booking.reference}`}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white ring-1 ring-inset ring-brand-600/30 transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? 'Assigning…' : 'Assign technician'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Assign technician">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="bg-white rounded-card border border-ink-200 shadow-card p-5 w-full max-w-md mx-4 sm:mx-0 sm:max-w-lg">
            <div className="flex items-start gap-3">
              <span className="shrink-0 rounded-full p-2 bg-brand-50 text-brand-600">
                <Icon name="user" size={20} />
              </span>
              <div className="min-w-0">
                <h2 id="assign-dialog-title" className="text-base font-semibold text-ink-900">
                  Assign technician
                </h2>
                <p id="assign-dialog-desc" className="mt-1 text-sm text-ink-600">
                  Choose a real technician for <span className="font-mono">{booking.reference}</span>. Only active technicians can be assigned.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <label htmlFor="assign-technician" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Technician
              </label>
              <select
                id="assign-technician"
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value || null)}
                disabled={busy || loading || active.length === 0}
                className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500 disabled:opacity-50 disabled:bg-ink-50"
              >
                <option value="">Select a technician</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}{t.phone ? ` · ${t.phone}` : ''}{t.skills ? ` · ${t.skills}` : ''}
                  </option>
                ))}
                {active.length === 0 ? <option disabled>No active technicians available</option> : null}
              </select>
              {!loading && active.length === 0 && (
                <p className="text-xs text-ink-400">No active technicians are available to assign.</p>
              )}
            </div>

            {error && <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy || !selected || active.length === 0}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition disabled:opacity-60"
              >
                {busy ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
