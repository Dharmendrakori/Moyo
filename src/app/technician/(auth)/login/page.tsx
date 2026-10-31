import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { LoginForm } from '@/components/customer/AuthForms';
import { getCurrentUser } from '@/lib/auth';
import { getTechnicianFeatures } from '@/lib/technician-features';

export const metadata: Metadata = {
  title: 'Technician sign in',
  robots: { index: false, follow: false },
};

/** The portal flag can change at any time, so this page is never cached. */
export const dynamic = 'force-dynamic';

/**
 * TECHNICIAN SIGN IN
 *
 * Two facts decide what this page can do, and both come from the database:
 *
 *  - the portal feature. When it is off, the form is not rendered at all AND
 *    `POST /api/auth/login` refuses a TECHNICIAN account, so a direct POST cannot
 *    bypass this screen;
 *  - the session. A signed-in technician is sent straight to their jobs.
 *
 * The form itself is the platform's existing login form: same POST, same CSRF
 * handling, same lockout and rate limiting. Only the destination differs, and that
 * destination is role-gated server-side in `resolvePostLoginRedirect`.
 */
export default async function TechnicianLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const features = await getTechnicianFeatures();
  const params = await searchParams;
  const activated = firstValue(params.activated) === '1';

  const card = 'rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8';

  if (!features.portalEnabled) {
    return (
      <div className={card}>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-ink-100 text-ink-500">
          <Icon name="lock" size={20} />
        </span>
        <h1 className="mt-4 text-center text-lg font-bold tracking-tight text-ink-900">
          Technician portal unavailable
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-ink-600">
          The technician portal is switched off for this platform, so there is no technician sign-in
          right now. If you are a technician, contact your administrator.
        </p>
        <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">
          This is a configuration state, not an account problem: nothing has been deleted and no
          assigned work has changed.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  const signedInTechnician = user?.role === 'TECHNICIAN';
  if (signedInTechnician) redirect('/technician');

  return (
    <div className={card}>
      <h1 className="text-xl font-bold tracking-tight text-ink-900">Technician sign in</h1>
      <p className="mt-1 text-sm text-ink-500">
        Sign in with the login details your administrator provisioned.
      </p>

      {activated && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg bg-success-bg p-3 text-sm text-success"
        >
          <Icon name="check-circle" size={16} className="mt-0.5 shrink-0" />
          <span>Your password is set. Sign in to see your jobs.</span>
        </div>
      )}

      {user && !signedInTechnician && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg bg-warning-bg p-3 text-sm text-warning"
        >
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>
            You are signed in to a non-technician account. This portal is only for technician
            accounts.
          </span>
        </div>
      )}

      <div className="mt-6">
        <LoginForm nextPath="/technician" />
      </div>

      <p className="mt-6 border-t border-ink-100 pt-4 text-center text-xs text-ink-500">
        Lost or expired activation link? Ask your administrator to re-issue it.
      </p>
      <p className="mt-1 text-center text-xs text-ink-400">
        Customer?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Sign in here
        </Link>
      </p>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
