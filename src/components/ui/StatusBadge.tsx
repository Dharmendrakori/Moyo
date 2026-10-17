import { cn } from '@/lib/format';
import { Icon, type IconName } from './Icon';
import type { ReactNode } from 'react';

/**
 * STATUS BADGE
 *
 * Colour is FUNCTIONAL: it encodes state, never decoration. Every badge pairs
 * colour with text so meaning does not depend on colour vision.
 */

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-neutral-bg text-neutral ring-1 ring-inset ring-ink-200',
  info: 'bg-info-bg text-info ring-1 ring-inset ring-info/20',
  success: 'bg-success-bg text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-bg text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-bg text-danger ring-1 ring-inset ring-danger/20',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200',
};

export type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
  className?: string;
  /** Adds a subtle dot, useful in dense tables. */
  dot?: boolean;
};

export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
  className,
  dot = false,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon && <Icon name={icon} size={12} />}
      {label}
    </span>
  );
}

/**
 * Maps a domain status string to a tone. Unknown values fall back to `neutral`
 * rather than guessing, so a new backend status degrades gracefully.
 */
export function toneForStatus(status: string): StatusTone {
  switch (status) {
    case 'REQUESTED':
    case 'PLACED':
    case 'OPEN':
    case 'QUEUED':
    case 'PENDING':
      return 'info';
    case 'CONFIRMED':
    case 'PACKED':
    case 'TECHNICIAN_ASSIGNED':
    case 'ISSUED':
      return 'brand';
    case 'TECHNICIAN_ON_THE_WAY':
    case 'DISPATCHED':
    case 'ARRIVED':
    case 'SERVICE_IN_PROGRESS':
    case 'INSTALLATION_SCHEDULED':
      return 'warning';
    case 'COMPLETED':
    case 'DELIVERED':
    case 'PAID':
    case 'SUCCEEDED':
    case 'CLOSED':
    case 'INSTALLATION_COMPLETED':
    case 'CREDITED':
      return 'success';
    case 'INVOICE_GENERATED':
    case 'PAYMENT_PENDING':
    case 'FEEDBACK_PENDING':
      return 'warning';
    case 'CANCELLED':
    case 'FAILED':
    case 'VOID':
    case 'REJECTED':
    case 'OVERDUE':
      return 'danger';
    default:
      return 'neutral';
  }
}

export type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  tone?: StatusTone;
  href?: string;
};

/** Dashboard metric tile. Values must come from real aggregates. */
export function StatCard({ label, value, hint, icon, tone = 'neutral', href }: StatCardProps) {
  const accent: Record<StatusTone, string> = {
    neutral: 'text-ink-400 bg-ink-100',
    info: 'text-info bg-info-bg',
    success: 'text-success bg-success-bg',
    warning: 'text-warning bg-warning-bg',
    danger: 'text-danger bg-danger-bg',
    brand: 'text-brand-600 bg-brand-50',
  };

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {icon && (
          <span className={cn('rounded-lg p-2', accent[tone])}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </>
  );

  const className =
    'block rounded-xl border border-ink-200 bg-white p-4 shadow-card transition-all duration-300';

  if (href) {
    return (
      <a
        href={href}
        className={cn(className, 'hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-elevated')}
      >
        {content}
      </a>
    );
  }
  return <div className={className}>{content}</div>;
}