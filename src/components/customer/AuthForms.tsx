'use client';

import { useState, type FormEvent, type ReactNode, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { readCsrfToken } from '@/components/admin/LogoutButton';

/**
 * AUTHENTICATION FORMS
 *
 * Client-side validation here is UX only. The server re-validates everything with
 * the same rules in src/lib/validation.ts and is the sole authority.
 *
 * Error text comes from the API response, which never leaks internals.
 */

type FieldErrors = Record<string, string>;

function useAuthSubmit(endpoint: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit(payload: Record<string, unknown>, nextPath: string) {
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      // Credentials travel ONLY in the POST body. The validated destination
      // path rides along as `?next=` on the API URL - it is a local path, never
      // a credential - and the server re-validates it with safeRedirectPath
      // before echoing back `redirectTo`.
      const url = nextPath
        ? `${endpoint}?next=${encodeURIComponent(nextPath)}`
        : endpoint;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Double-submit CSRF token, read from the readable cookie.
          'x-csrf-token': readCsrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const shape = data as { error?: { message?: string; fields?: FieldErrors } } | null;
        setFormError(shape?.error?.message ?? 'Something went wrong. Please try again.');
        if (shape?.error?.fields) setFieldErrors(shape.error.fields);
        return;
      }

      // The server returns an already-validated redirect target.
      const result = data as { redirectTo?: string } | null;
      router.replace(result?.redirectTo ?? nextPath);
      router.refresh();
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return { submit, pending, formError, fieldErrors };
}

// --- Field primitives -------------------------------------------------------

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 transition-colors duration-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60';

function FormAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-bg p-3 text-sm text-danger"
    >
      <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export { Field, FormAlert, inputClass };

// --- Login ------------------------------------------------------------------

export function LoginForm({ nextPath }: { nextPath: string }) {
  const { submit, pending, formError, fieldErrors } = useAuthSubmit('/api/auth/login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit({ identifier, password }, nextPath);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
    >
      {formError && <FormAlert message={formError} />}

      <Field id="identifier" label="Email or mobile number" error={fieldErrors.identifier}>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field id="password" label="Password" error={fieldErrors.password}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

// --- Register ---------------------------------------------------------------

export function RegisterForm({ nextPath }: { nextPath: string }) {
  const { submit, pending, formError, fieldErrors } = useAuthSubmit('/api/auth/register');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    referralCode: '',
  });

  function update(key: keyof typeof form) {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Only send a referral code when the customer actually entered one.
    const payload: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      password: form.password,
      confirmPassword: form.confirmPassword,
    };
    if (form.referralCode.trim()) payload.referralCode = form.referralCode.trim();
    void submit(payload, nextPath);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
    >
      {formError && <FormAlert message={formError} />}

      <Field id="name" label="Full name" error={fieldErrors.name}>
        <input id="name" name="name" type="text" autoComplete="name" required value={form.name}
          onChange={update('name')} className={inputClass} />
      </Field>

      <Field id="email" label="Email address" error={fieldErrors.email}>
        <input id="email" name="email" type="email" autoComplete="email" required value={form.email}
          onChange={update('email')} className={inputClass} />
      </Field>

      <Field id="phone" label="Mobile number" error={fieldErrors.phone}
        hint="10-digit Indian mobile number">
        <input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" required
          value={form.phone} onChange={update('phone')} className={inputClass} />
      </Field>

      <Field id="password" label="Password" error={fieldErrors.password}
        hint="At least 12 characters, with upper and lower case, a number and a symbol">
        <input id="password" name="password" type="password" autoComplete="new-password" required
          value={form.password} onChange={update('password')} className={inputClass} />
      </Field>

      <Field id="confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
        <input id="confirmPassword" name="confirmPassword" type="password"
          autoComplete="new-password" required value={form.confirmPassword}
          onChange={update('confirmPassword')} className={inputClass} />
      </Field>

      <Field id="referralCode" label="Referral code" error={fieldErrors.referralCode} hint="Optional">
        <input id="referralCode" name="referralCode" type="text" value={form.referralCode}
          onChange={update('referralCode')} className={inputClass} />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated disabled:opacity-60"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}