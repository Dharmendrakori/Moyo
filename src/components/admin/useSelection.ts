'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * ROW SELECTION STATE
 *
 * Tracks which rows on the CURRENT page are selected, plus an explicit flag for
 * "every matching record" so the toolbar can be honest about scope.
 *
 * Select-all is deliberately page-scoped: the server table is paginated, so the
 * browser only ever holds the current page's ids. Acting on "all matching"
 * records would require trusting a count the client cannot verify, so instead
 * the toggle selects exactly the ids it can see and the label says so. This
 * keeps every mutation scoped to records the operator can actually point at.
 */
export function useSelection<T>(rows: T[], rowKey: (row: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const pageIds = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const pageIdSet = useMemo(() => new Set(pageIds), [pageIds]);

  const selectedOnPage = useMemo(
    () => Array.from(selected).filter((id) => pageIdSet.has(id)),
    [selected, pageIdSet],
  );

  const allOnPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someOnPageSelected = selectedOnPage.length > 0;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageIds.length > 0 && pageIds.every((id) => next.has(id))) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [pageIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected: selectedOnPage,
    count: selectedOnPage.length,
    isSelected: (id: string) => selected.has(id),
    allOnPageSelected,
    someOnPageSelected,
    toggle,
    toggleAllOnPage,
    clear,
  };
}

export type Selection<T> = ReturnType<typeof useSelection<T>>;
