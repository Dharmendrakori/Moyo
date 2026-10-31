'use client';

import { useState } from 'react';
import { Panel } from '@/components/admin/DataTable';
import { ConfirmDialog } from '@/components/ui/States';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

type Features = { adminManagementEnabled: boolean; portalEnabled: boolean };

/**
 * FEATURE CONFIGURATION
 *
 * The only screen that changes the two technician capabilities, and the only way
 * back if management is switched off. It is rendered for ADMINs regardless of
 * either flag, because hiding the switch behind its own off state would require
 * database access to undo.
 *
 * Both toggles are refused server-side for a non-admin, without a CSRF token, and
 * from another origin; the buttons here are convenience only.
 */
export function TechnicianFeaturePanel({ features }: { features: Features }) {
  const { run, busy, error } = useAdminMutation();
  const [confirmPortalOff, setConfirmPortalOff] = useState(false);

  async function apply(key: keyof Features, value: boolean) {
    if (key === 'portalEnabled' && !value) {
      // Turning the portal off revokes every live technician session, so it asks.
      setConfirmPortalOff(true);
      return;
    }
    await run('/api/admin/technician-features', { [key]: value });
  }

  return (
    <Panel
      title="Technician features"
      description="Two independent capabilities. Changes take effect immediately - no redeploy - and never delete technicians, accounts or assignment history."
    >
      <div className="space-y-4">
        <FeatureRow
          title="Admin technician management"
          description="The roster screens and their write APIs: create, edit, activate, availability and account provisioning."
          enabled={features.adminManagementEnabled}
          busy={busy}
          onToggle={() => apply('adminManagementEnabled', !features.adminManagementEnabled)}
        />

        <FeatureRow
          title="Technician portal"
          description="Technician sign-in and the /technician portal. When off, technicians cannot sign in even if an account exists, and open sessions are revoked."
          enabled={features.portalEnabled}
          busy={busy}
          onToggle={() => apply('portalEnabled', !features.portalEnabled)}
        />

        {!features.adminManagementEnabled && !features.portalEnabled && (
          <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
            Technician operations are disabled. Dispatch still works: existing technicians can be
            assigned to confirmed bookings, and every historical record is preserved.
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmPortalOff}
        tone="danger"
        title="Switch the technician portal off?"
        description="Technicians will not be able to sign in, and every live technician session is revoked immediately. Accounts, profiles and booking history are kept, and the portal can be switched back on at any time."
        confirmLabel="Switch off"
        busy={busy}
        onConfirm={async () => {
          setConfirmPortalOff(false);
          await run('/api/admin/technician-features', { portalEnabled: false });
        }}
        onCancel={() => setConfirmPortalOff(false)}
      />
    </Panel>
  );
}

function FeatureRow({
  title,
  description,
  enabled,
  busy,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-200 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={
            enabled
              ? 'rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success ring-1 ring-inset ring-success/20'
              : 'rounded-full bg-neutral-bg px-2 py-0.5 text-[11px] font-semibold text-neutral ring-1 ring-inset ring-ink-200'
          }
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={enabled}
          className={
            enabled
              ? 'rounded-lg px-2.5 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/30 transition hover:bg-danger-bg disabled:opacity-50'
              : 'rounded-lg px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/30 transition hover:bg-success-bg disabled:opacity-50'
          }
        >
          {busy ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  );
}
