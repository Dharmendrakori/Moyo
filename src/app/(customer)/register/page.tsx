import { RegisterForm } from '@/components/customer/AuthForms';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

export const metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** REGISTRATION */
export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const raw = params.next;
  const nextPath = safeRedirectPath(Array.isArray(raw) ? raw[0] : raw, '/account');

  if (user) redirect(nextPath);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">Create your MOYO account</h1>
        <p className="mt-1 text-sm text-ink-500">
          Track bookings, download invoices and order materials.
        </p>
        <div className="mt-6">
          <RegisterForm nextPath={nextPath} />
        </div>
        <p className="mt-6 border-t border-ink-100 pt-4 text-center text-sm text-ink-500">
          Already have an account?{' '}
          <a href="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}