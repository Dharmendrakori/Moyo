import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { telLink } from '@/lib/format';
import type { TechnicianRow } from '@/lib/technicians';
import { TechnicianRowControls } from './TechnicianRowControls';

/**
 * ROSTER TABLE
 *
 * A server component: every value comes from `listTechnicians()`, which selects
 * named columns only. The controls beside each row are the only client code, and
 * they merely send a request - the server decides whether it is allowed.
 *
 * "Account" separates the three facts an operator needs to keep straight: the
 * profile exists, the profile is active, and a login exists (and is usable).
 */
export function TechnicianTable({
  rows,
  canManage,
  portalEnabled,
  hasFilters,
}: {
  rows: TechnicianRow[];
  canManage: boolean;
  portalEnabled: boolean;
  hasFilters: boolean;
}) {
  return (
    <DataTable
      caption="Technician roster"
      rows={rows}
      rowKey={(row) => row.id}
      empty={
        <EmptyState
          icon="user"
          title={hasFilters ? 'No technicians match this view' : 'No technicians yet'}
          description={
            hasFilters
              ? 'Try a different search term, status or availability filter.'
              : 'Create the first technician profile to make assignments possible. A profile is a roster record; a portal account is optional.'
          }
        />
      }
      columns={[
        {
          key: 'name',
          header: 'Technician',
          cell: (row) => (
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">{row.displayName}</p>
              <p className="truncate text-xs text-ink-500">
                {row.headline ?? 'No headline recorded'}
              </p>
            </div>
          ),
        },
        {
          key: 'contact',
          header: 'Contact',
          secondary: true,
          cell: (row) => {
            const href = telLink(row.phone);
            if (!row.phone) return <span className="text-ink-400">Not provided</span>;
            return href ? (
              <a href={href} className="font-medium text-brand-700 hover:underline">
                {row.phone}
              </a>
            ) : (
              row.phone
            );
          },
        },
        {
          key: 'skills',
          header: 'Skills / areas',
          secondary: true,
          cell: (row) => (
            <div className="max-w-[16rem] space-y-0.5 text-xs">
              <p className="truncate text-ink-700">{row.skills ?? 'No skills recorded'}</p>
              <p className="truncate text-ink-400">{row.serviceAreas ?? 'No areas recorded'}</p>
            </div>
          ),
        },
        {
          key: 'assignment',
          header: 'Assignment',
          cell: (row) => (
            <StatusBadge
              label={
                row.eligibility === 'ASSIGNABLE'
                  ? 'Can be assigned'
                  : row.eligibility === 'INACTIVE'
                    ? 'Deactivated'
                    : 'Unavailable'
              }
              tone={
                row.eligibility === 'ASSIGNABLE'
                  ? 'success'
                  : row.eligibility === 'INACTIVE'
                    ? 'danger'
                    : 'warning'
              }
              dot
            />
          ),
        },
        {
          key: 'account',
          header: 'Portal account',
          secondary: true,
          cell: (row) => {
            if (!row.account) {
              return <span className="text-xs text-ink-400">No login</span>;
            }
            return (
              <div className="space-y-1">
                <p className="max-w-[14rem] truncate text-xs text-ink-700">{row.account.email}</p>
                {row.account.activationPending ? (
                  <StatusBadge label="Invitation pending" tone="warning" />
                ) : row.account.isActive ? (
                  <StatusBadge label="Active login" tone="success" />
                ) : (
                  <StatusBadge label="Login disabled" tone="danger" />
                )}
              </div>
            );
          },
        },
        {
          key: 'actions',
          header: 'Actions',
          className: 'text-right',
          cell: (row) => (
            <TechnicianRowControls
              technician={row}
              canManage={canManage}
              portalEnabled={portalEnabled}
            />
          ),
        },
      ]}
    />
  );
}
