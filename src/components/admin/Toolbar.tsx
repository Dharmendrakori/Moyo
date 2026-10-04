import Link from 'next/link';

/**
 * SERVER-SIDE PAGINATION AND FILTER BAR
 *
 * Rendering rather than fetching: search and filters are a plain GET form, and
 * paging is real links. That means the entire current view is expressible as a
 * URL, so an operator can bookmark or share a filtered view, the back button
 * works, and no catalogue data is duplicated into a client-side store.
 */
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
      className="flex flex-col gap-3 rounded-card border border-ink-200 bg-white p-3 shadow-card lg:flex-row lg:items-end"
    >
      {children}
      <div className="flex items-center gap-2 lg:ml-auto">
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Apply
        </button>
        <Link
          href={action}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-600 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
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
    <div className="lg:w-72">
      <label htmlFor={name} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="search"
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        maxLength={80}
        className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-500"
      />
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
    <div className="lg:w-56">
      <label htmlFor={name} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 focus:border-brand-500"
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

  return (
    <nav className="flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
      <p className="text-xs text-ink-500">
        Showing <span className="font-semibold tabular-nums text-ink-700">{from}</span>–
        <span className="font-semibold tabular-nums text-ink-700">{to}</span> of{' '}
        <span className="font-semibold tabular-nums text-ink-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            rel="prev"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            Previous
          </Link>
        ) : (
          <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-300 ring-1 ring-inset ring-ink-200">
            Previous
          </span>
        )}
        <span className="px-2 text-xs font-semibold tabular-nums text-ink-600">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            Next
          </Link>
        ) : (
          <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-300 ring-1 ring-inset ring-ink-200">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
