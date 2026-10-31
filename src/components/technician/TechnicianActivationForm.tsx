'use client';

import { useState, type FormEvent } from 'react';
import { Field, FormAlert, inputClass } from '@/components/customer/AuthForms';
import { readCsrfToken } from '@/components/admin/LogoutButton';

/**
 * ACTIVATION FORM
 *
 * The technician chooses their own password; the server stores only a bcrypt
 * hash, clears the one-time token and revokes any session minted earlier. The
 * password rules are the platform's single password policy (12+ characters, mixed
 * case, digit, symbol) - enforced here for feedback and again on the server as the
 * authority.
 *
 * The token is posted in the request BODY, never echoed into a URL.
 */
export function TechnicianActivationForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/technician/activate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfToken() },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; fields?: Record<string, string> };
        redirectTo?: string;
      } | null;

      if (!response.ok) {
        setFormError(payload?.error?.message ?? 'Something went wrong. Please try again.');
        if (payload?.error?.fields) setFieldErrors(payload.error.fields);
        return;
      }

      setDone(true);
      // A hard navigation, so no pre-activation state is retained in the client.
      window.location.assign(payload?.redirectTo ?? '/technician/login?activated=1');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-ink-600">
        Your password is set. Taking you to the sign-in page…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <FormAlert message={formError} />}

      <Field
        id="activation-password"
        label="Choose a password"
        error={fieldErrors.password}
        hint="At least 12 characters, with upper and lower case, a number and a symbol."
      >
        <input
          id="activation-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        id="activation-confirm"
        label="Confirm password"
        error={fieldErrors.confirmPassword}
      >
        <input
          id="activation-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set password and continue'}
      </button>
    </form>
  );
}
