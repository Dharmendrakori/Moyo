'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FormAlert, inputClass } from '@/components/customer/AuthForms';
import { readCsrfToken } from '@/components/admin/LogoutButton';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';

export type AccountProfile = {
  name: string;
  email: string;
  phone: string;
  role: string;
  roleLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export type AccountAddress = {
  label: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  area: string;
  city: string;
  state: string;
  pincode: string;
} | null;

type FieldErrors = Record<string, string>;

/**
 * ACCOUNT MANAGER (client interactivity for /account)
 *
 * Server-rendered profile/address arrive as props; every mutation goes to the
 * session-scoped account APIs with the double-submit CSRF token. No user id
 * is ever sent - the server resolves identity from the session.
 */
export function AccountManager({
  profile,
  address,
}: {
  profile: AccountProfile;
  address: AccountAddress;
}) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <ProfileCard profile={profile} />
      <div className="space-y-4 lg:col-span-2">
        <AddressCard address={address} />
        <PasswordCard />
      </div>
    </div>
  );
}

function cardClass(extra = ''): string {
  return `rounded-card border border-ink-200 bg-white p-5 ${extra}`.trim();
}

async function apiJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; data: unknown; formError: string | null; fields: FieldErrors }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': readCsrfToken(),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return { ok: false, data: null, formError: 'Could not reach the server.', fields: {} };
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const shape = data as { error?: { message?: string; fields?: FieldErrors } } | null;
    return {
      ok: false,
      data: null,
      formError: shape?.error?.message ?? 'Something went wrong. Please try again.',
      fields: shape?.error?.fields ?? {},
    };
  }
  return { ok: true, data, formError: null, fields: {} };
}

function ProfileCard({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  function startEdit(): void {
    setName(profile.name);
    setPhone(profile.phone);
    setFormError(null);
    setFieldErrors({});
    setSuccess(null);
    setEditing(true);
  }

  async function onSave(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    setSuccess(null);
    const result = await apiJson('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
    });
    setPending(false);
    if (!result.ok) {
      setFormError(result.formError);
      setFieldErrors(result.fields);
      return;
    }
    setSuccess('Profile updated.');
    setEditing(false);
    router.refresh();
  }

  return (
    <section aria-labelledby="profile-heading" className={cardClass()}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="profile-heading" className="text-sm font-semibold text-ink-900">
          Profile
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50"
          >
            <Icon name="edit" size={14} />
            Edit
          </button>
        )}
      </div>
      {success && (
        <p role="status" className="mt-3 rounded-lg bg-success/10 p-2.5 text-sm text-success">
          {success}
        </p>
      )}
      {editing ? (
        <form onSubmit={onSave} noValidate className="mt-4 space-y-4">
          {formError && <FormAlert message={formError} />}
          <Field id="account-name" label="Full name" error={fieldErrors.name}>
            <input
              id="account-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            id="account-phone"
            label="Mobile number"
            hint="10-digit Indian mobile number"
            error={fieldErrors.phone}
          >
            <input
              id="account-phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Name</dt>
            <dd className="mt-0.5 font-medium text-ink-800">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Email</dt>
            <dd className="mt-0.5 font-medium text-ink-800">{profile.email}</dd>
            <dd className="mt-0.5 text-xs text-ink-400">Read-only. Contact support to change it.</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Mobile number
            </dt>
            <dd className="mt-0.5 font-medium text-ink-800">{profile.phone}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">Role</dt>
            <dd className="mt-0.5 font-medium text-ink-800">{profile.roleLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Member since
            </dt>
            <dd className="mt-0.5 font-medium text-ink-800">{formatDate(profile.createdAt)}</dd>
          </div>
          {profile.lastLoginAt && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">
                Last signed in
              </dt>
              <dd className="mt-0.5 font-medium text-ink-800">{formatDate(profile.lastLoginAt)}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function AddressCard({ address }: { address: AccountAddress }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    label: address?.label ?? 'Home',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    landmark: address?.landmark ?? '',
    area: address?.area ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    pincode: address?.pincode ?? '',
  });
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function onSave(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    setSuccess(null);
    const result = await apiJson('/api/account/address', {
      method: 'PUT',
      body: JSON.stringify({
        label: form.label.trim() || undefined,
        line1: form.line1.trim() || undefined,
        line2: form.line2.trim(),
        landmark: form.landmark.trim(),
        area: form.area.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
      }),
    });
    setPending(false);
    if (!result.ok) {
      setFormError(result.formError);
      setFieldErrors(result.fields);
      return;
    }
    setSuccess('Address saved.');
    setEditing(false);
    router.refresh();
  }

  return (
    <section aria-labelledby="address-heading" className={cardClass()}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="address-heading" className="text-sm font-semibold text-ink-900">
          Saved address
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setFieldErrors({});
              setSuccess(null);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50"
          >
            <Icon name="edit" size={14} />
            {address ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
      {success && (
        <p role="status" className="mt-3 rounded-lg bg-success/10 p-2.5 text-sm text-success">
          {success}
        </p>
      )}
      {editing ? (
        <form onSubmit={onSave} noValidate className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {formError && (
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
          )}
          <Field id="addr-label" label="Label" error={fieldErrors.label}>
            <input id="addr-label" value={form.label} onChange={update('label')} className={inputClass} />
          </Field>
          <Field id="addr-pincode" label="PIN code" error={fieldErrors.pincode}>
            <input id="addr-pincode" inputMode="numeric" value={form.pincode} onChange={update('pincode')} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="addr-line1" label="Address line 1" error={fieldErrors.line1}>
              <input id="addr-line1" value={form.line1} onChange={update('line1')} className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="addr-line2" label="Address line 2 (optional)" error={fieldErrors.line2}>
              <input id="addr-line2" value={form.line2} onChange={update('line2')} className={inputClass} />
            </Field>
          </div>
          <Field id="addr-landmark" label="Landmark (optional)" error={fieldErrors.landmark}>
            <input id="addr-landmark" value={form.landmark} onChange={update('landmark')} className={inputClass} />
          </Field>
          <Field id="addr-area" label="Area" error={fieldErrors.area}>
            <input id="addr-area" value={form.area} onChange={update('area')} className={inputClass} />
          </Field>
          <Field id="addr-city" label="City" error={fieldErrors.city}>
            <input id="addr-city" value={form.city} onChange={update('city')} className={inputClass} />
          </Field>
          <Field id="addr-state" label="State" error={fieldErrors.state}>
            <input id="addr-state" value={form.state} onChange={update('state')} className={inputClass} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : address ? (
        <address className="mt-3 text-sm not-italic leading-relaxed text-ink-600">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {address.label}
          </span>
          <br />
          {address.line1}
          {address.line2 ? `, ${address.line2}` : null}
          {address.landmark ? ` (${address.landmark})` : null}, {address.area}, {address.city},{' '}
          {address.state} &ndash; {address.pincode}
        </address>
      ) : (
        <p className="mt-3 text-sm text-ink-500">
          No saved address yet. Add one here or during booking.
        </p>
      )}
    </section>
  );
}

function PasswordCard() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    const result = await apiJson('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      }),
    });
    if (!result.ok) {
      setPending(false);
      setFormError(result.formError);
      setFieldErrors(result.fields);
      return;
    }
    // All sessions revoked server-side: hard-navigate to login so no stale
    // authenticated view lingers. The message tells the user to sign in again.
    router.replace('/login?changed=1');
    router.refresh();
  }

  return (
    <section aria-labelledby="password-heading" className={cardClass()}>
      <h2 id="password-heading" className="text-sm font-semibold text-ink-900">
        Change password
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        You will be signed out everywhere and must sign in again with the new password.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {formError && <FormAlert message={formError} />}
        <Field id="pw-current" label="Current password" error={fieldErrors.currentPassword}>
          <input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          id="pw-new"
          label="New password"
          hint="At least 12 characters, with upper and lower case, a number and a symbol"
          error={fieldErrors.newPassword}
        >
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="pw-confirm" label="Confirm new password" error={fieldErrors.confirmPassword}>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

/**
 * CSRF-protected sign-out for the account page. Posts with the double-submit
 * token (like the admin LogoutButton), then hard-navigates to /login.
 */
export function AccountSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrfToken() },
      });
    } catch {
      // Even on network failure the session cookie is cleared server-side on
      // next load; still navigate away from the authenticated view.
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={busy}
      className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
