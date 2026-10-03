import { LoginForm } from '@/components/customer/AuthForms';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

export const metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * LOGIN
 *
 * `noindex` because this is an account page. The `next` parameter is validated
 * with safeRedirectPath before use, so it cannot become an open redirect.
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const nextPath = safeRedirectPath(firstValue(params.next), '/account');

  if (user) redirect(nextPath);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">Sign in to MOYO</h1>
        <p className="mt-1 text-sm text-ink-500">
          Access your bookings, invoices and material orders.
        </p>
        <div className="mt-6">
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="mt-6 border-t border-ink-100 pt-4 text-center text-sm text-ink-500">
          New to MOYO?{' '}
          <a href="/register" className="font-semibold text-brand-600 hover:underline">
            Create an account
          </a>
        </p>
      </div>
    </div>
  );
}

/** Search params may arrive as an array; take only the first value. */
function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}