'use client';

import { BulkCheckbox, BulkToolbar } from '@/components/admin/BulkControls';
import { useSelection } from '@/components/admin/useSelection';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { telLink } from '@/lib/format';
import { TechnicianBulkBar } from './TechnicianBulkBar';
import { TechnicianRowControls } from './TechnicianRowControls';

/**
 * ROSTER TABLE WITH SELECTION
 *
 * The server renders the page; this component adds row selection and the bulk
 * toolbar. Selection is deliberately PAGE-SCOPED: `useSelection` only ever holds
 * ids it can see, so a "select all" can never silently include rows on another
 * page or behind a filter the operator has forgotten. The toolbar states the
 * scope in words next to the count.
 *
 * Every mutation is sent to the server as ids + an action; the server re-reads
 * each row, re-checks authorization, the feature switch and assignment
 * eligibility, and reports per-record outcomes. Nothing here decides anything.
 */
export type TechnicianRosterRow = {
  id: string;
  displayName: string;
  headline: string | null;
  phone: string | null;
  skills: string | null;
  serviceAreas: string | null;
  isActive: boolean;
  isAvailable: boolean;
  eligibility: 'ASSIGNABLE' | 'INACTIVE' | 'UNAVAILABLE';
  account: { id: string; email: string; isActive: boolean; activationPending: boolean } | null;
};

const HEAD_CELL =
  'whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500';
const BODY_CELL = 'px-4 py-3 align-middle text-ink-700';

export function TechnicianTable({
  rows,
  canManage,
  portalEnabled,
  hasFilters,
}: {
  rows: TechnicianRosterRow[];
  canManage: boolean;
  portalEnabled: boolean;
  hasFilters: boolean;
}) {
  const selection = useSelection(rows, (row) => row.id);
  const selectedRows = rows.filter((row) => selection.isSelected(row.id));

  return (
    <div className="space-y-3">
      {canManage && (
        <BulkToolbar count={selection.count} scopeNote="on this page" onClear={selection.clear}>
          <TechnicianBulkBar
            selectedRows={selectedRows}
            portalEnabled={portalEnabled}
            onDone={selection.clear}
          />
        </BulkToolbar>
      )}

      <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Technician roster</caption>
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50/80">
                {canManage && (
                  <th scope="col" className="w-10 px-4 py-3">
                    <BulkCheckbox
                      checked={selection.allOnPageSelected}
                      indeterminate={selection.someOnPageSelected}
                      onChange={selection.toggleAllOnPage}
                      label="Select every technician on this page"
                    />
                  </th>
                )}
                <th scope="col" className={HEAD_CELL}>
                  Technician
                </th>
                <th scope="col" className={`${HEAD_CELL} hidden lg:table-cell`}>
                  Contact
                </th>
                <th scope="col" className={`${HEAD_CELL} hidden lg:table-cell`}>
                  Skills / areas
                </th>
                <th scope="col" className={HEAD_CELL}>
                  Assignment
                </th>
                <th scope="col" className={`${HEAD_CELL} hidden lg:table-cell`}>
                  Portal account
                </th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => {
                const selected = selection.isSelected(row.id);
                const href = telLink(row.phone);
                return (
                  <tr
                    key={row.id}
                    className={selected ? 'bg-brand-50/60' : 'transition-colors hover:bg-ink-50/70'}
                  >
                    {canManage && (
                      <td className="px-4 py-3">
                        <BulkCheckbox
                          checked={selected}
                          onChange={() => selection.toggle(row.id)}
                          label={`Select ${row.displayName}`}
                        />
                      </td>
                    )}
                    <td className={BODY_CELL}>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900">{row.displayName}</p>
                        <p className="truncate text-xs text-ink-500">
                          {row.headline ?? 'No headline recorded'}
                        </p>
                      </div>
                    </td>
                    <td className={`${BODY_CELL} hidden lg:table-cell`}>
                      {!row.phone ? (
                        <span className="text-ink-400">Not provided</span>
                      ) : href ? (
                        <a href={href} className="font-medium text-brand-700 hover:underline">
                          {row.phone}
                        </a>
                      ) : (
                        row.phone
                      )}
                    </td>
                    <td className={`${BODY_CELL} hidden lg:table-cell`}>
                      <div className="max-w-[16rem] space-y-0.5 text-xs">
                        <p className="truncate text-ink-700">{row.skills ?? 'No skills recorded'}</p>
                        <p className="truncate text-ink-400">
                          {row.serviceAreas ?? 'No areas recorded'}
                        </p>
                      </div>
                    </td>
                    <td className={BODY_CELL}>
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
                    </td>
                    <td className={`${BODY_CELL} hidden lg:table-cell`}>
                      {!row.account ? (
                        <span className="text-xs text-ink-400">No login</span>
                      ) : (
                        <div className="space-y-1">
                          <p className="max-w-[14rem] truncate text-xs text-ink-700">
                            {row.account.email}
                          </p>
                          {row.account.activationPending ? (
                            <StatusBadge label="Invitation pending" tone="warning" />
                          ) : row.account.isActive ? (
                            <StatusBadge label="Active login" tone="success" />
                          ) : (
                            <StatusBadge label="Login disabled" tone="danger" />
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`${BODY_CELL} text-right`}>
                      <TechnicianRowControls
                        technician={row}
                        canManage={canManage}
                        portalEnabled={portalEnabled}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <EmptyState
            icon="user"
            title={hasFilters ? 'No technicians match this view' : 'No technicians yet'}
            description={
              hasFilters
                ? 'Try a different search term, status, availability, expertise or portal filter.'
                : 'Create the first technician profile to make assignments possible. A profile is a roster record; a portal account is optional.'
            }
          />
        )}
      </div>
    </div>
  );
}
