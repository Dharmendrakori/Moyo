'use client';

import { useState } from 'react';
import { BulkButton } from '@/components/admin/BulkControls';
import { ConfirmDialog } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icon';
import { useBulkAction } from '@/components/admin/useBulkAction';
import type { TechnicianRosterRow } from './TechnicianTable';

/**
 * BULK ACTIONS FOR THE ROSTER
 *
 * Rendered inside the shared `BulkToolbar`, so it only exists while rows are
 * selected and always states the selection count and scope.
 *
 * EVERY ACTION IS A REQUEST, NOT A DECISION. The server re-checks the admin role,
 * the CSRF token, the technician-management switch, each id, the active-assignment
 * guard and the availability rules, and answers with a per-record account of what
 * happened. This component shows that answer verbatim; it never reports success on
 * its own.
 *
 * CONSEQUENTIAL ACTIONS CONFIRM FIRST, and the dialog says what the consequence
 * actually is: deactivation also disables the linked login and revokes live
 * sessions; availability controls dispatch eligibility; nothing deletes records.
 *
 * RE-ISSUED INVITATIONS are shown once, in this panel, as text with a copy-all
 * control. They are never put in a URL, a log or an audit row.
 */

type ValueAction = 'ADD_SKILLS' | 'REMOVE_SKILLS' | 'ADD_SERVICE_AREAS' | 'REMOVE_SERVICE_AREAS';
type SimpleAction =
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'SET_AVAILABLE'
  | 'SET_UNAVAILABLE'
  | 'REISSUE_INVITATIONS';
type Action = ValueAction | SimpleAction;

type BulkResultBody = {
  action: string;
  result: {
    requested: number;
    affected: number;
    notFound: string[];
    skipped: Array<{ id: string; name: string; reason: string }>;
    activationLinks?: Array<{ id: string; displayName: string; path: string }>;
  };
};

type Outcome = {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  details: string[];
  links?: Array<{ id: string; displayName: string; path: string }>;
};

const CONFIRM: Record<
  SimpleAction,
  { title: string; body: string; label: string; tone: 'default' | 'danger' }
> = {
  ACTIVATE: {
    title: 'Activate the selected technicians?',
    body: 'Their linked logins are re-enabled. They still need to be marked available before work can be assigned, and existing assignments are untouched.',
    label: 'Activate',
    tone: 'default',
  },
  DEACTIVATE: {
    title: 'Deactivate the selected technicians?',
    body: 'They will no longer be assignable, their portal logins are disabled and any live sessions are revoked. Bookings, assignments and history are kept. Refused outright if any of them still has open work.',
    label: 'Deactivate',
    tone: 'danger',
  },
  SET_AVAILABLE: {
    title: 'Mark the selected technicians available?',
    body: 'They become eligible for dispatch as soon as they are also active. Deactivated technicians in the selection are skipped and reported.',
    label: 'Mark available',
    tone: 'default',
  },
  SET_UNAVAILABLE: {
    title: 'Mark the selected technicians unavailable?',
    body: 'No new work will be assigned to them until they are marked available again. Existing assignments are untouched.',
    label: 'Mark unavailable',
    tone: 'default',
  },
  REISSUE_INVITATIONS: {
    title: 'Re-issue invitations?',
    body: 'Each selected technician with an unactivated login gets a new one-time activation link, and the previous link stops working. The links are shown once; send them privately.',
    label: 'Re-issue',
    tone: 'danger',
  },
};

export function TechnicianBulkBar({
  selectedRows,
  portalEnabled,
  onDone,
}: {
  selectedRows: TechnicianRosterRow[];
  portalEnabled: boolean;
  onDone: () => void;
}) {
  const { run, busy, error } = useBulkAction();
  const [confirming, setConfirming] = useState<SimpleAction | null>(null);
  const [valueAction, setValueAction] = useState<ValueAction | null>(null);
  const [valueText, setValueText] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const ids = selectedRows.map((row) => row.id);

  async function send(action: Action, values?: string[]) {
    setConfirming(null);
    setOutcome(null);

    const res = await run<BulkResultBody>('/api/admin/technicians/bulk', {
      ids,
      action,
      ...(values ? { values } : {}),
    });

    if (!res.ok) {
      setOutcome({ tone: 'danger', title: 'Nothing was changed', details: [res.message] });
      return;
    }

    const { affected, notFound, skipped, activationLinks } = res.data.result;
    const details: string[] = [];
    skipped.slice(0, 5).forEach((item) => details.push(`${item.name} — ${item.reason}`));
    if (skipped.length > 5) details.push(`…and ${skipped.length - 5} more skipped.`);
    if (notFound.length > 0) details.push(`${notFound.length} selected record(s) no longer exist.`);

    setOutcome({
      tone: affected > 0 && skipped.length === 0 && notFound.length === 0 ? 'success' : 'warning',
      title:
        affected > 0
          ? `${affected} technician${affected === 1 ? '' : 's'} updated.`
          : 'No technician needed changing.',
      details,
      links: activationLinks,
    });
    setValueAction(null);
    setValueText('');
  }

  function submitValues() {
    if (!valueAction) return;
    const values = Array.from(
      new Set(
        valueText
          .split(',')
          .map((value) => value.trim().replace(/\s+/g, ' '))
          .filter(Boolean),
      ),
    ).slice(0, 10);

    if (values.length === 0) return;
    void send(valueAction, values);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <BulkButton
        icon={<Icon name="check-circle" size={13} />}
        onClick={() => setConfirming('ACTIVATE')}
      >
        Activate
      </BulkButton>
      <BulkButton
        tone="danger"
        icon={<Icon name="lock" size={13} />}
        onClick={() => setConfirming('DEACTIVATE')}
      >
        Deactivate
      </BulkButton>
      <BulkButton onClick={() => setConfirming('SET_AVAILABLE')}>Available</BulkButton>
      <BulkButton onClick={() => setConfirming('SET_UNAVAILABLE')}>Unavailable</BulkButton>
      <BulkButton onClick={() => setValueAction('ADD_SKILLS')}>Add skills</BulkButton>
      <BulkButton onClick={() => setValueAction('REMOVE_SKILLS')}>Remove skills</BulkButton>
      <BulkButton onClick={() => setValueAction('ADD_SERVICE_AREAS')}>Add areas</BulkButton>
      <BulkButton onClick={() => setValueAction('REMOVE_SERVICE_AREAS')}>Remove areas</BulkButton>
      {portalEnabled && (
        <BulkButton onClick={() => setConfirming('REISSUE_INVITATIONS')}>
          Re-issue invites
        </BulkButton>
      )}
      <a
        href={`/api/admin/technicians/export?ids=${encodeURIComponent(ids.join(','))}`}
        download
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-white"
      >
        <Icon name="download" size={13} /> Export CSV
      </a>
      {outcome && (
        <BulkButton onClick={onDone} disabled={busy}>
          Done
        </BulkButton>
      )}
      {error && !outcome && <span className="text-xs font-medium text-danger">{error}</span>}

      {valueAction && (
        <BulkValuePanel
          action={valueAction}
          selectedRows={selectedRows}
          valueText={valueText}
          onValueChange={setValueText}
          busy={busy}
          onApply={submitValues}
          onCancel={() => {
            setValueAction(null);
            setValueText('');
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          open
          tone={CONFIRM[confirming].tone}
          title={CONFIRM[confirming].title}
          description={`${CONFIRM[confirming].body} ${selectedRows.length} technician${
            selectedRows.length === 1 ? '' : 's'
          } selected: ${selectedRows
            .slice(0, 4)
            .map((row) => row.displayName)
            .join(', ')}${selectedRows.length > 4 ? ` and ${selectedRows.length - 4} more` : ''}.`}
          confirmLabel={CONFIRM[confirming].label}
          busy={busy}
          onConfirm={() => void send(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}

      {outcome && <BulkOutcome outcome={outcome} onDismiss={() => setOutcome(null)} />}
    </div>
  );
}

const VALUE_COPY: Record<ValueAction, { title: string; hint: string; verb: string }> = {
  ADD_SKILLS: {
    title: 'Add skills',
    hint: 'Existing skills are kept. Values already present are ignored.',
    verb: 'add',
  },
  REMOVE_SKILLS: {
    title: 'Remove skills',
    hint: 'Only the values you name are removed; everything else is kept.',
    verb: 'remove',
  },
  ADD_SERVICE_AREAS: {
    title: 'Add service areas',
    hint: 'Existing areas are kept. Changing areas never moves an existing booking.',
    verb: 'add',
  },
  REMOVE_SERVICE_AREAS: {
    title: 'Remove service areas',
    hint: 'Only the areas you name are removed. Existing bookings keep their address.',
    verb: 'remove',
  },
};

/**
 * Value editor for the tag actions: a preview plus an explicit Apply.
 *
 * Deliberately not a `window.prompt`/`confirm`: it shows exactly which technicians
 * and which values will be affected before anything is sent.
 */
function BulkValuePanel({
  action,
  selectedRows,
  valueText,
  onValueChange,
  busy,
  onApply,
  onCancel,
}: {
  action: ValueAction;
  selectedRows: TechnicianRosterRow[];
  valueText: string;
  onValueChange: (value: string) => void;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const copy = VALUE_COPY[action];
  const values = Array.from(
    new Set(
      valueText
        .split(',')
        .map((value) => value.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  ).slice(0, 10);
  const names = selectedRows.map((row) => row.displayName);

  return (
    <div className="mt-2 w-full rounded-lg border border-ink-200 bg-white p-3">
      <label htmlFor="technician-bulk-values" className="block text-xs font-semibold text-ink-800">
        {copy.title}
      </label>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{copy.hint}</p>
      <input
        id="technician-bulk-values"
        value={valueText}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="e.g. Refrigeration, Electrical repair"
        maxLength={300}
        className="mt-2 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <p className="mt-1 text-[11px] text-ink-400">
        Comma-separated, up to 10 values per operation.
      </p>

      {values.length > 0 && (
        <p className="mt-2 text-xs text-ink-700">
          Will {copy.verb}:{' '}
          <span className="font-semibold text-ink-900">{values.join(', ')}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <p className="text-xs text-ink-500">
          Applies to {selectedRows.length} technician{selectedRows.length === 1 ? '' : 's'}:{' '}
          {names.slice(0, 4).join(', ')}
          {names.length > 4 ? ` and ${names.length - 4} more` : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy || values.length === 0}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The server's own accounting, including the one-time activation links. */
function BulkOutcome({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  const tones = {
    success: 'border-success/20 bg-success-bg text-success',
    warning: 'border-warning/20 bg-warning-bg text-warning',
    danger: 'border-danger/20 bg-danger-bg text-danger',
  } as const;
  const icon =
    outcome.tone === 'success'
      ? 'check-circle'
      : outcome.tone === 'danger'
        ? 'alert-triangle'
        : 'alert-circle';

  return (
    <div
      role="status"
      className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs leading-relaxed ${tones[outcome.tone]}`}
    >
      <div className="flex items-start gap-2">
        <Icon name={icon} size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{outcome.title}</p>
          {outcome.details.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {outcome.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}

          {outcome.links && outcome.links.length > 0 && (
            <div className="mt-2 rounded-lg border border-success/25 bg-white/70 p-2">
              <p className="font-semibold text-ink-800">One-time activation links</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                Shown once and never stored in readable form. Send each one privately.
              </p>
              <ul className="mt-1 space-y-1">
                {outcome.links.map((link) => (
                  <li key={link.id} className="break-all font-mono text-[11px] text-ink-800">
                    {link.displayName}: {link.path}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    outcome.links
                      ?.map((link) => `${link.displayName}: ${link.path}`)
                      .join('\n') ?? '',
                  );
                }}
                className="mt-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
              >
                Copy all
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 transition hover:bg-black/5"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  );
}
