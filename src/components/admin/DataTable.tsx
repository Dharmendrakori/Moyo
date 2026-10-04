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
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          {/* Screen-reader context for a wide, dense table. */}
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500',
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
              <tr key={rowKey(row)} className="transition hover:bg-ink-50/70">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2.5 align-middle text-ink-700',
                      col.numeric && 'text-right tabular-nums',
                      col.secondary && 'hidden lg:table-cell',
                    )}
                  >
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
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-500">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Small labelled figure used inside a dense cell or a panel header. */
export function InlineStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink-800">{value}</p>
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
  tone?: 'info' | 'warning' | 'neutral';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-info/20 bg-info-bg text-info',
    warning: 'border-warning/20 bg-warning-bg text-warning',
    neutral: 'border-ink-200 bg-ink-50 text-ink-600',
  } as const;
  return (
    <p className={cn('rounded-lg border px-3 py-2 text-xs leading-relaxed', tones[tone])}>
      {children}
    </p>
  );
}
