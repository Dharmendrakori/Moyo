import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  CreateTechnicianDialog,
  EditTechnicianDialog,
} from '@/components/admin/technicians/TechnicianDialogs';

export const metadata: Metadata = {
  title: 'Technician dialog harness',
  robots: { index: false, follow: false },
};

/**
 * DEVELOPMENT-ONLY COMPONENT HARNESS
 *
 * The technician dialogs are only reachable from `/admin/technicians`, which needs
 * an ADMIN session. The browser regression test for the focus defect (see
 * `e2e/technician-dialog-focus.spec.ts`) needs to drive the REAL components in a
 * REAL browser without a credentialed account, so this page renders them directly.
 *
 * It is inert in production (`notFound()`), reads no data, exposes no records and
 * mutates nothing: the dialogs post to the admin API, which the test intercepts and
 * which would reject an unauthenticated caller anyway.
 */
export default function TechnicianDialogHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <h1 className="text-lg font-bold tracking-tight text-ink-900">Technician dialog harness</h1>
        <p className="mt-1 text-sm text-ink-500">
          Development-only surface for the dialog focus regression test. Not part of any operator
          workflow.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <CreateTechnicianDialog portalEnabled />
        <EditTechnicianDialog
          technician={{
            id: 'ctechnician00000000000001',
            displayName: 'Ravi Kumar',
            phone: '9876500001',
            headline: 'AC and refrigeration',
            skills: 'AC servicing, Refrigeration',
            serviceAreas: 'Bhopal',
          }}
        />
      </div>
    </main>
  );
}
