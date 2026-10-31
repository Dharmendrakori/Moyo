import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { TechnicianActivationForm } from '@/components/technician/TechnicianActivationForm';
import { getTechnicianFeatures } from '@/lib/technician-features';

export const metadata: Metadata = {
  title: 'Activate technician account',
  // A page reached with a one-time credential must never be indexed or followed.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Matches the token format the server issues (base64url, 24 random bytes). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * ACCOUNT ACTIVATION
 *
 * The one-time token arrives as a PATH segment (see `activationPathFor`), which
 * also keeps it out of the query string the edge proxy scrubs. The page itself
 * grants nothing: it renders a form, and `POST /api/technician/activate` decides
 * whether the invitation is real, unexpired, single-use and belongs to an active
 * technician profile.
 *
 * A malformed token is answered without a database lookup, so probing this page
 * costs nothing and reveals nothing.
 */
export default async function TechnicianActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const features = await getTechnicianFeatures();
  if (!features.portalEnabled) notFound();

  const { token } = await params;
  const card = 'rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8';

  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return (
      <div className={card}>
        <h1 className="text-lg font-bold tracking-tight text-ink-900">Activation link not valid</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          This link is malformed. Ask your administrator to issue a new activation link.
        </p>
        <Link
          href="/technician/login"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
        >
          <Icon name="chevron-right" size={14} /> Go to technician sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={card}>
      <h1 className="text-xl font-bold tracking-tight text-ink-900">Activate your account</h1>
      <p className="mt-1 text-sm leading-relaxed text-ink-500">
        Choose a password to finish setting up your technician login. Nobody else - including your
        administrator - will know it.
      </p>
      <div className="mt-6">
        <TechnicianActivationForm token={token} />
      </div>
      <p className="mt-6 border-t border-ink-100 pt-4 text-center text-xs text-ink-400">
        This link works once and expires after 7 days.
      </p>
    </div>
  );
}
