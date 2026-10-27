import { SericFullPageLoader } from '@/components/ui/SericLoader';

/**
 * CUSTOMER ROUTE GROUP LOADING BOUNDARY
 *
 * Shown during client-side navigation between customer pages
 * (/, /categories, /bookings, /account, ...). The shared CustomerLayout
 * stays mounted, so the root `app/loading.tsx` boundary above it does not
 * catch page-level transitions. This nested boundary wraps the pages and
 * falls back to the branded full-page loader while the RSC payload streams.
 */
export default function CustomerLoading() {
  return <SericFullPageLoader label="Loading" />;
}
