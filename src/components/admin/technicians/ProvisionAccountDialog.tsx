'use client';

import { useState } from 'react';
import { useAdminMutation } from '@/components/admin/useAdminMutation';
import { ActivationLink, Field, ModalShell } from './TechnicianDialogs';

/**
 * PROVISION OR RE-INVITE A PORTAL LOGIN
 *
 * Two modes, one endpoint:
 *   CREATE   the profile has no account yet - the login identity is required.
 *   REISSUE  the account exists but was never activated - a fresh single-use
 *            token is minted and the old one becomes worthless.
 *
 * An account that has already been activated cannot be reset here: this release
 * has no password-reset flow, so the server refuses rather than pretending. The
 * limitation is stated in SECURITY.md.
 */
export function ProvisionAccountDialog({
  technicianId,
  displayName,
  mode,
  defaultEmail = '',
}: {
  technicianId: string;
  displayName: string;
  mode: 'CREATE' | 'REISSUE';
  defaultEmail?: string;
}) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [activationPath, setActivationPath] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState('');

  function close() {
    setOpen(false);
    setActivationPath(null);
    clearError();
  }

  async function submit() {
    const payload =
      mode === 'REISSUE' ? {} : { email: email.trim(), phone: phone.trim() };
    const result = await run(
      `/api/admin/technicians/${technicianId}/account`,
      payload,
      'POST',
    );
    if (!result.ok) return;

    const data = result.data as { activationPath?: string } | null;
    if (data?.activationPath) setActivationPath(data.activationPath);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setOpen(true))}
        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50 disabled:opacity-50"
      >
        {mode === 'REISSUE' ? 'Re-issue invite' : 'Create login'}
      </button>

      {open && (
        <ModalShell
          title={mode === 'REISSUE' ? `New invite for ${displayName}` : `Portal login for ${displayName}`}
          description={
            mode === 'REISSUE'
              ? 'Issues a new one-time activation link and invalidates the previous one. The account cannot be used until the technician activates it.'
              : 'Creates a TECHNICIAN login with no usable password. The technician sets their own password from a one-time activation link.'
          }
          onClose={close}
          busy={busy}
          footer={
            activationPath ? (
              <button
                type="button"
                onClick={close}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy ? 'Working…' : mode === 'REISSUE' ? 'Issue new link' : 'Create login'}
                </button>
              </>
            )
          }
        >
          {activationPath ? (
            <ActivationLink path={activationPath} />
          ) : (
            <div className="space-y-3">
              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-danger-bg p-2.5 text-xs font-medium text-danger"
                >
                  {error}
                </p>
              )}
              {mode === 'CREATE' ? (
                <>
                  <Field id="account-email" label="Login email">
                    <input
                      id="account-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={254}
                      className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </Field>
                  <Field id="account-phone" label="Login mobile">
                    <input
                      id="account-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={20}
                      className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </Field>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-ink-600">
                  This replaces the outstanding invitation for{' '}
                  <span className="font-semibold text-ink-800">{defaultEmail}</span>. Use it if the
                  technician did not receive the first link or it has expired.
                </p>
              )}
            </div>
          )}
        </ModalShell>
      )}
    </>
  );
}
