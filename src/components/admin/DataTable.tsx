import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * ADMIN TABLE PRIMITIVES
 *
 * Dense, server-rendered building blocks for the operations console.
 *
 * There is no client data table and no charting dependency here on purpose: the
 * data is fetched server-side and rendered as HTML, so there is no second copy
 * of the catalogue in the browser and no third-party script to trust.
 */

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Cell renderer. Kept as a function so columns stay declarative. */
  cell: (row: T) => ReactNode;
  /** Tailwind width classes for the header and body cells. */
  className?: string;
  /** Right-align numeric columns so digits line up. */
  numeric?: boolean;
  /** Hidden below `lg` to keep narrow screens readable. */
  secondary?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  rowHref,
  rowLabel,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty: ReactNode;
  /**
   * Makes the whole row a link to this record. The first cell's content is
   * painted by the overlay anchor, so the row is clickable, focusable and
   * announces its destination to assistive technology.
   *
   * shortcut: the stretched anchor relies on `position: relative` on `<tr>`,
   * which every current browser honours; if that ever fails the anchor is
   * contained by the scroll wrapper instead. Upgrade to a list-of-links layout
   * if legacy browsers must be supported.
   */
  rowHref?: (row: T) => string;
  /** Accessible name for the row link, e.g. "Open booking SERIC-2026-000123". */
  rowLabel?: (row: T) => string;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          {/* Screen-reader context for a wide, dense table. */}
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500',
                    col.numeric && 'text-right',
                    col.secondary && 'hidden lg:table-cell',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'relative transition-colors',
                  rowHref ? 'group cursor-pointer hover:bg-brand-50/60' : 'hover:bg-ink-50/70',
                )}
              >
                {columns.map((col, index) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3 align-middle text-ink-700',
                      col.numeric && 'text-right tabular-nums',
                      col.secondary && 'hidden lg:table-cell',
                    )}
                  >
                    {index === 0 && rowHref && (
                      <Link
                        href={rowHref(row)}
                        aria-label={rowLabel?.(row) ?? 'Open record'}
                        className="absolute inset-0 z-0 rounded focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600"
                      />
                    )}
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && empty}
    </div>
  );
}

/** Page heading with an optional supporting line. Used at the top of each screen. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-ink-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-500">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A grouped section of the console: a titled surface with optional actions.
 * Used so every screen shares one card language (border, radius, shadow, header)
 * instead of each page inventing its own.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-ink-200 bg-white shadow-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Labelled figure used inside a dense cell or a panel header. */
export function InlineStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink-800">{value}</p>
    </div>
  );
}

/**
 * Honest, inline notice.
 *
 * Used for real constraints (an unpublished price, a disabled option) rather
 * than as decoration. Never renders raw HTML.
 */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'neutral' | 'success';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-info/20 bg-info-bg text-info',
    warning: 'border-warning/20 bg-warning-bg text-warning',
    neutral: 'border-ink-200 bg-ink-50 text-ink-600',
    success: 'border-success/20 bg-success-bg text-success',
  } as const;
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed',
        tones[tone],
      )}
    >
      {children}
    </p>
  );
}

