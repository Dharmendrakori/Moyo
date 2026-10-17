import { cn, telLink, whatsappLink } from '@/lib/format';
import { Icon } from '../ui/Icon';
import { StatusBadge, toneForStatus } from '../ui/StatusBadge';
import { hasAssignedTechnician, projectLifecycle } from '@/lib/booking-tracking';

/**
 * BOOKING STATUS DISPLAY
 *
 * Reusable presentation of the booking lifecycle. Renders ONLY what the backend
 * actually knows: stages up to the current one are complete, the current stage
 * is marked current, and every later stage is explicitly "Pending". Technician
 * details appear only once a technician is really assigned.
 *
 * ACCESSIBILITY: status is conveyed by text and icon as well as colour, and the
 * stage list marks the current item with `aria-current="step"`.
 */

export type TechnicianSummary = {
  displayName: string;
  headline?: string | null;
  phone?: string | null;
} | null;

export type BookingStatusPanelProps = {
  status: string;
  technician?: TechnicianSummary;
  className?: string;
};

/** Label/value pair used across the tracking panels. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink-800">{children}</dd>
    </div>
  );
}

export function StatusHeadline({ status }: { status: string }) {
  const lifecycle = projectLifecycle(status);
  return (
    <div className="rounded-card border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            Current status
          </p>
          <p className="mt-1 text-lg font-bold tracking-tight text-ink-900">
            {lifecycle.currentLabel}
          </p>
          <p className="mt-1 text-sm text-ink-600">{lifecycle.currentHint}</p>
        </div>
        <StatusBadge
          label={lifecycle.isCancelled ? 'Cancelled' : lifecycle.currentLabel}
          tone={lifecycle.isCancelled ? 'danger' : toneForStatus(status)}
          dot
        />
      </div>
      {lifecycle.nextAction && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-info-bg p-3 text-sm text-info">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>{lifecycle.nextAction}</span>
        </p>
      )}
    </div>
  );
}

/** Ordered lifecycle. Pending stages are labelled, never implied as done. */
export function BookingLifecycle({ status }: { status: string }) {
  const lifecycle = projectLifecycle(status);

  if (lifecycle.isCancelled) {
    return (
      <div className="rounded-card border border-danger/20 bg-danger-bg p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger">
          <Icon name="alert-circle" size={16} />
          This booking was cancelled
        </p>
        <p className="mt-1 text-sm text-ink-600">
          The service lifecycle no longer applies. Contact the provider to arrange another visit.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-0" aria-label="Booking progress">
      {lifecycle.stages.map((stage, i) => {
        const isCurrent = stage.state === 'current';
        const isComplete = stage.state === 'complete';
        const isLast = i === lifecycle.stages.length - 1;
        return (
          <li key={stage.status} className="flex gap-3" aria-current={isCurrent ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  isComplete && 'bg-success text-white',
                  isCurrent && 'bg-brand-600 text-white ring-4 ring-brand-100',
                  stage.state === 'pending' && 'bg-ink-100 text-ink-400',
                )}
              >
                {isComplete ? <Icon name="check" size={13} /> : <span aria-hidden>{i + 1}</span>}
              </span>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn('w-0.5 flex-1', isComplete ? 'bg-success/40' : 'bg-ink-200')}
                />
              )}
            </div>
            <div className={cn('min-w-0 flex-1', !isLast && 'pb-4')}>
              <p
                className={cn(
                  'text-sm font-medium',
                  isCurrent && 'text-ink-900',
                  isComplete && 'text-ink-700',
                  stage.state === 'pending' && 'text-ink-400',
                )}
              >
                {stage.label}
              </p>
              {/* Explicit text label: status never depends on colour alone. */}
              <p className="mt-0.5 text-xs">
                {isCurrent ? (
                  <span className="font-semibold text-brand-700">In progress</span>
                ) : isComplete ? (
                  <span className="text-success">Completed</span>
                ) : (
                  <span className="text-ink-400">Pending</span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Technician card.
 *
 * Renders the honest placeholder until the backend assigns someone. There is no
 * fallback name, no "top-rated technician" and no availability claim, because
 * the booking record does not contain those facts.
 */
export function TechnicianCard({ technician }: { technician: TechnicianSummary }) {
  const assigned = hasAssignedTechnician(technician);
  const tel = telLink(technician?.phone);
  const wa = whatsappLink(technician?.phone, 'Hello, regarding my MOYO booking.');

  return (
    <div className="rounded-card border border-ink-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-ink-900">Technician</h3>

      {!assigned ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-500">
          <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-ink-400" />
          Technician details will appear after assignment.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink-800">{technician?.displayName}</p>
          {technician?.headline && <p className="mt-0.5 text-xs text-ink-500">{technician.headline}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {tel && (
              <a
                href={tel}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
              >
                <Icon name="phone" size={14} />
                Call
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white transition hover:bg-success/90"
              >
                <Icon name="whatsapp" size={14} />
                WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Composed tracking panel: headline, lifecycle and technician. */
export function BookingStatusPanel({ status, technician, className }: BookingStatusPanelProps) {
  return (
    <div className={cn('space-y-5', className)}>
      <StatusHeadline status={status} />
      <BookingLifecycle status={status} />
      <TechnicianCard technician={technician ?? null} />
    </div>
  );
}
