'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/States';
import { useAdminMutation } from '@/components/admin/useAdminMutation';
import { EditTechnicianDialog } from './TechnicianDialogs';
import { ProvisionAccountDialog } from './ProvisionAccountDialog';

/**
 * ROW CONTROLS
 *
 * Small, deliberate actions. Each one sends a request and reports what the SERVER
 * said; nothing flips optimistically, and none of these buttons is a security
 * control - the same rules are enforced in the route handlers.
 *
 * Deactivation asks for confirmation because it has three consequences: the
 * technician stops being assignable, their login is disabled, and their live
 * portal sessions are revoked. Availability is reversible and low-risk, so it
 * does not ask.
 */
export type TechnicianControlTarget = {
  id: string;
  displayName: string;
  phone: string | null;
  headline: string | null;
  skills: string | null;
  serviceAreas: string | null;
  isActive: boolean;
  isAvailable: boolean;
  account: { id: string; email: string; isActive: boolean; activationPending: boolean } | null;
};

export function TechnicianRowControls({
  technician,
  canManage,
  portalEnabled,
}: {
  technician: TechnicianControlTarget;
  canManage: boolean;
  portalEnabled: boolean;
}) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [confirming, setConfirming] = useState(false);
  const next = !technician.isActive;

  if (!canManage) {
    return <span className="text-xs text-ink-400">Read-only</span>;
  }

  async function toggleAvailability() {
    if (error) clearError();
    await run(`/api/admin/technicians/${technician.id}`, { isAvailable: !technician.isAvailable });
  }

  async function applyStatus() {
    setConfirming(false);
    await run(`/api/admin/technicians/${technician.id}`, { isActive: next });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <EditTechnicianDialog technician={technician} />

      <button
        type="button"
        onClick={toggleAvailability}
        disabled={busy || !technician.isActive}
        title={
          technician.isActive
            ? undefined
            : 'Reactivate the technician before changing their availability'
        }
        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {technician.isAvailable ? 'Mark unavailable' : 'Mark available'}
      </button>

      <button
        type="button"
        onClick={() => (error ? clearError() : setConfirming(true))}
        disabled={busy}
        className={
          technician.isActive
            ? 'rounded-lg px-2.5 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/30 transition hover:bg-danger-bg disabled:opacity-50'
            : 'rounded-lg px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/30 transition hover:bg-success-bg disabled:opacity-50'
        }
      >
        {busy ? 'Saving…' : technician.isActive ? 'Deactivate' : 'Activate'}
      </button>

      {portalEnabled && !technician.account && (
        <ProvisionAccountDialog
          technicianId={technician.id}
          displayName={technician.displayName}
          mode="CREATE"
        />
      )}

      {portalEnabled && technician.account?.activationPending && (
        <ProvisionAccountDialog
          technicianId={technician.id}
          displayName={technician.displayName}
          mode="REISSUE"
          defaultEmail={technician.account.email}
        />
      )}

      <ConfirmDialog
        open={confirming}
        tone={technician.isActive ? 'danger' : 'default'}
        title={
          technician.isActive
            ? `Deactivate ${technician.displayName}?`
            : `Reactivate ${technician.displayName}?`
        }
        description={
          technician.isActive
            ? 'They will no longer be assignable to new work, their portal login will be disabled and any signed-in session will be revoked. Existing bookings, assignments and history are kept.'
            : 'They will become assignable again (provided they are also marked available) and their existing login, if any, will be re-enabled.'
        }
        confirmLabel={technician.isActive ? 'Deactivate' : 'Activate'}
        busy={busy}
        onConfirm={applyStatus}
        onCancel={() => setConfirming(false)}
      />

      {error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
