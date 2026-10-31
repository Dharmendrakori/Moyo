'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useAdminMutation } from '@/components/admin/useAdminMutation';

/**
 * TECHNICIAN DIALOGS
 *
 * Create and edit a roster profile, plus the small chrome they share.
 *
 * The forms send only the fields the operator actually typed. Nothing here
 * decides anything: the server re-validates with the same strict schemas, and the
 * resulting row is re-read from the database (`router.refresh()`), so the screen
 * never shows an optimistic value that was silently rejected.
 *
 * The activation link is shown ONCE, as plain text with a copy control, because
 * only its hash is stored. It is never turned into a link the operator might
 * click, and it is never written to the URL or to a log.
 */

const INPUT =
  'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:opacity-60';

const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-500';

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * Accessible modal shell shared by every technician dialog.
 *
 * THE FOCUS EFFECT RUNS ONCE, ON MOUNT, AND MUST STAY THAT WAY.
 *
 * An earlier version depended on `[onClose]`. Every keystroke in a controlled
 * field re-renders the parent, which creates a new `close` function, so the effect
 * re-ran and called `focus()` on the ✕ button after each character: the caret left
 * the field, and the next Space/Enter activated the close button and dismissed a
 * half-filled form. The latest callbacks are therefore held in refs and the effect
 * has an empty dependency list, so a parent render can never steal focus, reset
 * the form or close the dialog.
 *
 * Also handled here: Escape is ignored while a request is in flight, Tab is trapped
 * inside the dialog, the backdrop cannot dismiss a submitting form, and focus
 * returns to whatever opened the dialog when it closes.
 */
export function ModalShell({
  title,
  description,
  onClose,
  footer,
  children,
  busy = false,
}: {
  title: string;
  description: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  /** While a request is in flight the dialog cannot be dismissed. */
  busy?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  // Refreshed after every render without touching the mount effect below.
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const previouslyFocused = typeof document === 'undefined' ? null : document.activeElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // The dialog container, not a control inside it: focusing the ✕ first made a
    // stray Enter dismiss the form.
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="fixed inset-0 bg-night-950/60"
        aria-hidden
        onClick={() => {
          if (!busyRef.current) onCloseRef.current();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="technician-dialog-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-card border border-ink-200 bg-white shadow-overlay focus:outline-none"
      >
        <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
          <span className="shrink-0 rounded-full bg-brand-50 p-2 text-brand-600">
            <Icon name="user" size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="technician-dialog-title" className="text-base font-semibold text-ink-900">
              {title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="ml-auto rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:opacity-50"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * The one-time activation path.
 *
 * Rendered as text (never a clickable link) with a copy control, because it is a
 * credential: it must be handed over privately and must not be navigated to on
 * the operator's own machine.
 */
export function ActivationLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-success/25 bg-success-bg p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
        <Icon name="check-circle" size={13} /> Login created
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
        Send this one-time activation link to the technician through a private channel. It sets
        their own password and expires in 7 days. It is shown only once and cannot be recovered.
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white/70 px-2 py-1.5 font-mono text-[11px] text-ink-800 ring-1 ring-inset ring-ink-200">
          {path}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}


type CreateResponse = { activationPath?: string | null } | null;

type CreateFormState = {
  displayName: string;
  phone: string;
  headline: string;
  skills: string;
  serviceAreas: string;
  accountEmail: string;
  accountPhone: string;
  isActive: boolean;
  isAvailable: boolean;
};

/**
 * CREATE A TECHNICIAN
 *
 * When the portal is enabled the login identity is required too, because the
 * server provisions an account in the same transaction. When it is disabled no
 * account is created at all - a roster record is still a useful, assignable
 * technician.
 */
export function CreateTechnicianDialog({ portalEnabled }: { portalEnabled: boolean }) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [activationPath, setActivationPath] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>({
    displayName: '',
    phone: '',
    headline: '',
    skills: '',
    serviceAreas: '',
    accountEmail: '',
    accountPhone: '',
    isActive: true,
    isAvailable: false,
  });

  function close() {
    setOpen(false);
    setActivationPath(null);
    clearError();
  }

  async function submit() {
    const payload: Record<string, unknown> = {
      displayName: form.displayName.trim(),
      phone: form.phone.trim(),
      headline: form.headline.trim(),
      skills: form.skills.trim(),
      serviceAreas: form.serviceAreas.trim(),
      isActive: form.isActive,
      isAvailable: form.isAvailable,
    };
    if (portalEnabled) {
      payload.accountEmail = form.accountEmail.trim();
      payload.accountPhone = form.accountPhone.trim();
    }

    const result = await run('/api/admin/technicians', payload, 'POST');
    if (!result.ok) return;

    const data = result.data as CreateResponse;
    if (data?.activationPath) {
      // Keep the dialog open so the ONE-TIME link is visible before it is lost.
      setActivationPath(data.activationPath);
      setForm((prev) => ({ ...prev, accountEmail: '', accountPhone: '' }));
      return;
    }
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800"
      >
        <Icon name="plus" size={15} />
        Add technician
      </button>

      {open && (
        <ModalShell
          title="Add technician"
          description={
            portalEnabled
              ? 'Creates a roster profile and a portal login. The technician chooses their own password from a one-time activation link.'
              : 'Creates a roster profile. The technician portal is off, so no login is created - you can provision one later.'
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
                  disabled={busy || form.displayName.trim().length === 0}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? 'Creating…' : 'Create technician'}
                </button>
              </>
            )
          }
        >
          {activationPath ? (
            <ActivationLink path={activationPath} />
          ) : (
            <CreateFormFields form={form} setForm={setForm} portalEnabled={portalEnabled} error={error} />
          )}
        </ModalShell>
      )}
    </>
  );
}

function CreateFormFields({
  form,
  setForm,
  portalEnabled,
  error,
}: {
  form: CreateFormState;
  setForm: (next: CreateFormState) => void;
  portalEnabled: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg p-2.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <Field id="tech-name" label="Name">
        <input
          id="tech-name"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          maxLength={80}
          className={INPUT}
          placeholder="Full name"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="tech-phone" label="Mobile (optional)">
          <input
            id="tech-phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            maxLength={20}
            className={INPUT}
            placeholder="10-digit number"
          />
        </Field>
        <Field id="tech-headline" label="Headline (optional)">
          <input
            id="tech-headline"
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            maxLength={160}
            className={INPUT}
            placeholder="e.g. AC and refrigeration"
          />
        </Field>
      </div>
      <Field id="tech-skills" label="Skills (optional)">
        <input
          id="tech-skills"
          value={form.skills}
          onChange={(e) => setForm({ ...form, skills: e.target.value })}
          maxLength={300}
          className={INPUT}
          placeholder="Comma separated"
        />
      </Field>
      <Field id="tech-areas" label="Service areas (optional)">
        <input
          id="tech-areas"
          value={form.serviceAreas}
          onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })}
          maxLength={200}
          className={INPUT}
          placeholder="e.g. Bhopal, Indore"
        />
      </Field>

      {portalEnabled && (
        <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Portal login
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field id="tech-email" label="Login email">
              <input
                id="tech-email"
                type="email"
                value={form.accountEmail}
                onChange={(e) => setForm({ ...form, accountEmail: e.target.value })}
                maxLength={254}
                className={INPUT}
              />
            </Field>
            <Field id="tech-account-phone" label="Login mobile">
              <input
                id="tech-account-phone"
                value={form.accountPhone}
                onChange={(e) => setForm({ ...form, accountPhone: e.target.value })}
                maxLength={20}
                className={INPUT}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            The login mobile defaults to the roster mobile above when left blank.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="h-4 w-4 rounded border-ink-300"
          />
          Active on the roster
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={form.isAvailable}
            onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
            className="h-4 w-4 rounded border-ink-300"
          />
          Available for assignment
        </label>
      </div>
    </div>
  );
}

export type EditableTechnician = {
  id: string;
  displayName: string;
  phone: string | null;
  headline: string | null;
  skills: string | null;
  serviceAreas: string | null;
};

/**
 * EDIT A TECHNICIAN
 *
 * Only the fields the operator actually changed are sent, so the audit record
 * names real changes rather than restating the whole row. Activation and
 * availability have their own inline controls; they are not editable here, which
 * keeps one consequential action in one place.
 */
export function EditTechnicianDialog({ technician }: { technician: EditableTechnician }) {
  const { run, busy, error, clearError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: technician.displayName,
    phone: technician.phone ?? '',
    headline: technician.headline ?? '',
    skills: technician.skills ?? '',
    serviceAreas: technician.serviceAreas ?? '',
  });

  async function submit() {
    const changes: Record<string, unknown> = {};
    if (form.displayName.trim() !== technician.displayName) {
      changes.displayName = form.displayName.trim();
    }
    if (form.phone.trim() !== (technician.phone ?? '')) changes.phone = form.phone.trim();
    if (form.headline.trim() !== (technician.headline ?? '')) {
      changes.headline = form.headline.trim();
    }
    if (form.skills.trim() !== (technician.skills ?? '')) changes.skills = form.skills.trim();
    if (form.serviceAreas.trim() !== (technician.serviceAreas ?? '')) {
      changes.serviceAreas = form.serviceAreas.trim();
    }

    if (Object.keys(changes).length === 0) {
      setOpen(false);
      return;
    }

    const result = await run(`/api/admin/technicians/${technician.id}`, changes);
    if (result.ok) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (error ? clearError() : setOpen(true))}
        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
      >
        Edit
      </button>

      {open && (
        <ModalShell
          title={`Edit ${technician.displayName}`}
          description="Roster details only. Activation, availability and the portal login are managed with their own controls."
          onClose={() => setOpen(false)}
          busy={busy}
          footer={
            <>
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
                onClick={submit}
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-bg p-2.5 text-xs font-medium text-danger"
              >
                {error}
              </p>
            )}
            <Field id="edit-name" label="Name">
              <input
                id="edit-name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                maxLength={120}
                className={INPUT}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="edit-phone" label="Mobile">
                <input
                  id="edit-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  maxLength={20}
                  className={INPUT}
                />
              </Field>
              <Field id="edit-headline" label="Headline">
                <input
                  id="edit-headline"
                  value={form.headline}
                  onChange={(e) => setForm({ ...form, headline: e.target.value })}
                  maxLength={160}
                  className={INPUT}
                />
              </Field>
            </div>
            <Field id="edit-skills" label="Skills">
              <input
                id="edit-skills"
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                maxLength={300}
                className={INPUT}
              />
            </Field>
            <Field id="edit-areas" label="Service areas">
              <input
                id="edit-areas"
                value={form.serviceAreas}
                onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })}
                maxLength={200}
                className={INPUT}
              />
            </Field>
          </div>
        </ModalShell>
      )}
    </>
  );
}
