import { SericFullPageLoader } from '@/components/ui/SericLoader';

/**
 * ROUTE LOADING FALLBACK (App Router `loading` boundary)
 *
 * Shown by Next.js while a client-side navigation suspends (the route's RSC
 * payload is still being fetched or the segment is still rendering). Once
 * the destination is ready the boundary swaps it out for the real page, so
 * fast, already-prefetched navigations never show it - by design.
 *
 * This is the application's branded loader and is unrelated to the Next.js
 * development indicator (the framework's own "Rendering" pill in dev mode).
 *
 * Server component by design: no hooks and no artificial delay, so the
 * branded screen paints in the boundary's HTML immediately rather than
 * flashing an empty backdrop first. `SericFullPageLoader` owns the
 * `role="status"` announcement and respects `prefers-reduced-motion`.
 */
export default function RootLoading() {
  return <SericFullPageLoader label="Loading" />;
}
