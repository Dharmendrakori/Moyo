import { CustomerHeader, CustomerFooter, BottomNav } from '@/components/customer/Shell';

/**
 * CUSTOMER ROUTE GROUP
 *
 * Layout for every public and customer-facing page:
 *   /, /categories, /services/*, /bookings, /orders, /account, /support, ...
 *
 * The bottom nav is fixed on mobile, so the main column carries bottom padding
 * to keep the last row of content clear of it.
 */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <CustomerHeader />

      <main id="main" className="flex-1 pb-24 md:pb-0">
        {children}
      </main>

      <CustomerFooter />
      <BottomNav />
    </div>
  );
}