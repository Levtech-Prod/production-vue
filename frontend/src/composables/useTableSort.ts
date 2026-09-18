import { computed, ref } from 'vue';

export type SortDir = 'asc' | 'desc';

/** Reads the value a row sorts by for one column. `null`/`undefined` means
 *  "no value" (e.g. an offer column with no quote yet) rather than "sorts
 *  first" or "sorts last" on its own — see `sortedRows` below. */
export type SortAccessor<T> = (row: T) => string | number | null | undefined;

/** The sortable columns of one table, by key. */
export type SortAccessors<T> = Record<string, SortAccessor<T>>;

/**
 * Click-a-header table sort: asc -> desc -> unsorted, one column at a time.
 * Written for the Project Parts table and the offer grid (plan §6.4) — both
 * are a client-side sort over a few hundred rows with a fixed set of typed
 * columns, which is what `accessors` describes once instead of once per
 * table.
 *
 * `PartsTable.vue`'s sort is a different decision that happens to look
 * similar (it orders by a *category-parameter id*, resolved against
 * `stock_parameters` values chosen per category) and is deliberately not
 * rebuilt on top of this (plan §6.4, CLAUDE.md's duplication rule).
 *
 * `rows` is a getter so the caller can hand in a computed (e.g. already
 * filtered) without this composable owning that filtering. `accessors` may be
 * a getter too, for a table whose columns are data: the offer grid's are one
 * per `project_offer_companies` row, added and removed while the page is open.
 */
export function useTableSort<T>(
  rows: () => T[],
  accessors: SortAccessors<T> | (() => SortAccessors<T>),
) {
  const accessorsNow = typeof accessors === 'function' ? accessors : () => accessors;
  const sortKey = ref<string | null>(null);
  const sortDir = ref<SortDir>('asc');

  function toggleSort(key: string) {
    if (!(key in accessorsNow())) return;
    if (sortKey.value !== key) {
      sortKey.value = key;
      sortDir.value = 'asc';
    } else if (sortDir.value === 'asc') {
      sortDir.value = 'desc';
    } else {
      sortKey.value = null;
    }
  }

  const sortedRows = computed(() => {
    const key = sortKey.value;
    const source = rows();
    if (key === null) return source;

    // The column can be gone: an offer column is removed while the grid is
    // sorted by it, and an accessor lookup that came back undefined used to
    // throw on the first comparison.
    const accessor = accessorsNow()[key];
    if (!accessor) return source;
    const dir = sortDir.value === 'asc' ? 1 : -1;

    return [...source].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const aEmpty = av === null || av === undefined;
      const bEmpty = bv === null || bv === undefined;
      // A missing value always sorts last, in both directions — an absent
      // offer quote is not "cheap" just because desc means bigger-first.
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return cmp * dir;
    });
  });

  return { sortKey, sortDir, toggleSort, sortedRows };
}
