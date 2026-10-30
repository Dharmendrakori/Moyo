import { LoadingState } from '@/components/ui/States';

/**
 * Streaming placeholder while the invoice ledger is read from the database.
 * `dynamic = 'force-dynamic'` on the page means this really is shown on
 * navigation rather than being pre-rendered away.
 */
export default function InvoicesLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="border-b border-ink-200 pb-5">
        <p className="text-[22px] font-bold tracking-tight text-ink-900">Invoices</p>
        <p className="mt-1.5 text-sm text-ink-500">Loading the invoice ledger…</p>
      </div>
      <LoadingState label="Loading invoices" rows={5} />
    </div>
  );
}
