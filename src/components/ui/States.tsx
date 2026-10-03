import { cn } from '@/lib/format';
import { Icon, type IconName } from './Icon';
import type { ReactNode } from 'react';

/**
 * STATE COMPONENTS
 *
 * Every data-backed surface renders one of these rather than an ambiguous blank
 * area, so users always understand why they are looking at something.
 */

// --- EmptyState -------------------------------------------------------------

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon = 'clipboard', action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="rounded-full bg-ink-100 p-3 text-ink-400">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-ink-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// --- LoadingState -----------------------------------------------------------

/**
 * Skeleton placeholder using the shimmer defined in globals.css.
 * `aria-busy` plus a visually hidden label keeps it accessible.
 */
export function LoadingState({
  label = 'Loading',
  rows = 3,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-card border border-ink-200 bg-white p-4">
          <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 rounded" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
            <div className="skeleton h-3 rounded" style={{ width: `${35 + ((i * 17) % 30)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Card-shaped skeleton for dashboards and detail panels. */
export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn('skeleton h-24 rounded-card', className)} aria-hidden />;
}

// --- ErrorState -------------------------------------------------------------

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * Error surface. Never renders a raw exception or stack trace - `description`
 * must be a safe, human sentence.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this information. Please try again.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-danger/20 bg-danger-bg px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <span className="rounded-full bg-danger/10 p-3 text-danger">
        <Icon name="alert-triangle" size={24} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-ink-800">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-600">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// --- ConfirmDialog ----------------------------------------------------------

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Destructive-action confirmation using role="alertdialog".
 * No `innerHTML` is used anywhere in this component.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-ink-900/50"
        onClick={busy ? undefined : onCancel}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-desc' : undefined}
        className="relative w-full max-w-md animate-slide-up rounded-card bg-white p-6 shadow-overlay"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'shrink-0 rounded-full p-2',
              tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-brand-50 text-brand-600',
            )}
          >
            <Icon name={tone === 'danger' ? 'alert-triangle' : 'info'} size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink-900">
              {title}
            </h2>
            {description && (
              <p id="confirm-dialog-desc" className="mt-1 text-sm text-ink-600">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60',
              tone === 'danger' ? 'bg-danger hover:bg-danger/90' : 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Pagination -------------------------------------------------------------

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
};

export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      className={cn('flex flex-col items-center justify-between gap-3 sm:flex-row', className)}
      aria-label="Pagination"
    >
      <p className="text-xs text-ink-500">
        Showing <span className="font-semibold tabular-nums text-ink-700">{from}</span>–
        <span className="font-semibold tabular-nums text-ink-700">{to}</span> of{' '}
        <span className="font-semibold tabular-nums text-ink-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-3 text-xs font-semibold tabular-nums text-ink-600">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}