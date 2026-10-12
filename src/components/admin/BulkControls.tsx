'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/format';

/**
 * Accessible row / header checkbox used by the bulk tables.
 *
 * A real `<input type="checkbox">` with an associated label so it is reachable
 * and operable by keyboard and screen reader. The header variant renders the
 * indeterminate state to signal "some, but not all, rows on this page".
 */
export function BulkCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center', className)} title={label}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-ink-300 text-brand-600 accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate && !checked;
        }}
        aria-label={label}
        onChange={onChange}
      />
      <span className="sr-only">{label}</span>
    </label>
  );
}

/**
 * COMPACT BULK-ACTION TOOLBAR
 *
 * Appears only when rows are selected. It states the selection scope plainly
 * ("N selected on this page") and offers the provided actions. It is intentionally
 * unobtrusive: hidden when nothing is selected, with a single dismiss control.
 */
export function BulkToolbar({
  count,
  scopeNote = 'on this page',
  busy,
  children,
  onClear,
}: {
  count: number;
  scopeNote?: string;
  busy?: boolean;
  children: ReactNode;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-col gap-2 rounded-card border border-brand-200 bg-brand-50 px-3 py-2.5 shadow-card sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-2 text-xs font-bold tabular-nums text-white">
          {count}
        </span>
        <p className="text-sm font-medium text-ink-700">
          selected <span className="text-ink-500">{scopeNote}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-600 transition hover:bg-white disabled:opacity-50"
        >
          <Icon name="close" size={13} />
          Clear
        </button>
      </div>
    </div>
  );
}

/** Small toolbar button matching the admin design language. */
export function BulkButton({
  tone = 'default',
  icon,
  children,
  ...rest
}: {
  tone?: 'default' | 'primary' | 'danger';
  icon?: ReactNode;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tones = {
    default:
      'text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-white',
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    danger: 'text-danger ring-1 ring-inset ring-danger/30 hover:bg-danger-bg',
  } as const;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50',
        tones[tone],
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Honest, inline result banner for a bulk operation.
 *
 * Renders the server's own accounting: how many were affected, which ids were
 * not found, and - for delete/create - which records were protected or skipped.
 * Text is rendered as React nodes, never as HTML.
 */
export function BulkResultBanner({
  tone,
  title,
  details,
  onDismiss,
}: {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  details?: string[];
  onDismiss?: () => void;
}) {
  const tones = {
    success: 'border-success/20 bg-success-bg text-success',
    warning: 'border-warning/20 bg-warning-bg text-warning',
    danger: 'border-danger/20 bg-danger-bg text-danger',
  } as const;
  const icon = tone === 'success' ? 'check-circle' : tone === 'danger' ? 'alert-triangle' : 'alert-circle';

  return (
    <div
      role="status"
      className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed', tones[tone])}
    >
      <Icon name={icon} size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {details && details.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 transition hover:bg-black/5"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}
