'use client';

import { useEffect, useRef, useState } from 'react';
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
  const selectRef = useRef<HTMLSelectElement>(null);

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

  // Escape closes the dialog, and focus starts on the only control in it, so
  // the dialog is operable from the keyboard alone.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    selectRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
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
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-ink-800 active:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="user" size={15} />
        {busy ? 'Assigning…' : 'Assign technician'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-dialog-title"
          aria-describedby="assign-dialog-desc"
        >
          <div
            className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-card border border-ink-200 bg-white shadow-overlay">
            <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
              <span className="shrink-0 rounded-full bg-brand-50 p-2 text-brand-600">
                <Icon name="user" size={20} />
              </span>
              <div className="min-w-0">
                <h2 id="assign-dialog-title" className="text-base font-semibold text-ink-900">
                  Assign technician
                </h2>
                <p id="assign-dialog-desc" className="mt-1 text-sm leading-relaxed text-ink-600">
                  Choose a real technician for{' '}
                  <span className="font-mono text-xs">{booking.reference}</span>. Only active
                  technicians can be assigned.
                </p>
              </div>
            </div>

            <div className="px-5 py-4">
              <label
                htmlFor="assign-technician"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-500"
              >
                Technician
              </label>
              <select
                id="assign-technician"
                ref={selectRef}
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value || null)}
                disabled={busy || loading || active.length === 0}
                className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 transition hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:opacity-60"
              >
                <option value="">Select a technician</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                    {t.phone ? ` · ${t.phone}` : ''}
                    {t.skills ? ` · ${t.skills}` : ''}
                  </option>
                ))}
                {active.length === 0 ? <option disabled>No active technicians available</option> : null}
              </select>
              {loading && <p className="mt-2 text-xs text-ink-400">Loading technicians…</p>}
              {!loading && active.length === 0 && (
                <p className="mt-2 text-xs text-ink-400">
                  No active technicians are available to assign.
                </p>
              )}

              {error && (
                <p role="alert" className="mt-2 text-xs font-medium text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy || !selected || active.length === 0}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
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
