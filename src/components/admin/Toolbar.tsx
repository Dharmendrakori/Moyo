import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/**
 * SERVER-SIDE PAGINATION AND FILTER BAR
 *
 * Rendering rather than fetching: search and filters are a plain GET form, and
 * paging is real links. That means the entire current view is expressible as a
 * URL, so an operator can bookmark or share a filtered view, the back button
 * works, and no catalogue data is duplicated into a client-side store.
 */

/** Shared field styling so every admin input, select and filter looks the same. */
const FIELD_CLASS =
  'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 shadow-xs transition placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

const LABEL_CLASS =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-500';

export function Toolbar({
  action,
  query,
  children,
}: {
  action: string;
  /** Current parameter values, so the inputs render pre-filled. */
  query: Record<string, string | undefined>;
  children: React.ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-col gap-3 rounded-card border border-ink-200 bg-white p-3 shadow-card lg:flex-row lg:flex-wrap lg:items-end"
    >
      {children}
      <div className="flex items-center gap-2 lg:ml-auto">
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800"
        >
          Apply
        </button>
        <Link
          href={action}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-600 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 hover:text-ink-800"
        >
          Reset
        </Link>
      </div>
      {/* Preserved across a filter change unless the field is re-submitted. */}
      <input type="hidden" name="page" value={query.page ?? '1'} />
      {query.pageSize && <input type="hidden" name="pageSize" value={query.pageSize} />}
    </form>
  );
}

/** Labelled text input for the toolbar. */
export function SearchField({
  name,
  defaultValue,
  placeholder,
  label,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="w-full lg:w-72">
      <label htmlFor={name} className={LABEL_CLASS}>
        {label}
      </label>
      <div className="relative">
        <Icon
          name="search"
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
        />
        <input
          id={name}
          name={name}
          type="search"
          defaultValue={defaultValue ?? ''}
          placeholder={placeholder}
          maxLength={80}
          className={`${FIELD_CLASS} pl-9`}
        />
      </div>
    </div>
  );
}

/** Labelled select for the toolbar. */
export function SelectField({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="w-full lg:w-56">
      <label htmlFor={name} className={LABEL_CLASS}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className={`${FIELD_CLASS} cursor-pointer appearance-none pr-9`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 9l7 7 7-7'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.65rem center',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Link-based pager. Buttons are real links, so the view stays URL-addressable. */
export function Pager({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Receives a target page number and returns the href that preserves filters. */
  buildHref: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const linkClass =
    'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 hover:text-ink-900 hover:ring-ink-400';
  const disabledClass =
    'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-300 ring-1 ring-inset ring-ink-200';

  return (
    <nav
      className="flex flex-col items-center justify-between gap-3 rounded-card border border-ink-200 bg-white px-4 py-3 shadow-card sm:flex-row"
      aria-label="Pagination"
    >
      <p className="text-xs text-ink-500">
        Showing <span className="font-semibold tabular-nums text-ink-700">{from}</span>–
        <span className="font-semibold tabular-nums text-ink-700">{to}</span> of{' '}
        <span className="font-semibold tabular-nums text-ink-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} rel="prev" className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass}>Previous</span>
        )}
        <span className="px-2 text-xs font-semibold tabular-nums text-ink-600">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={buildHref(page + 1)} rel="next" className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass}>Next</span>
        )}
      </div>
    </nav>
  );
}
