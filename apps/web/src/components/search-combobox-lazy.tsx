'use client';

import dynamic from 'next/dynamic';

/**
 * The header's search field with its suggestions (T-1844, D-435), kept off
 * every page's first load: the server still draws the whole field, so the
 * plain GET form works at once, and the list's code arrives as a chunk of its
 * own (docs/08-load-test.md, "Page budgets": chunks a dynamic import loads
 * are not first-load). The search page imports `SearchCombobox` itself.
 */
export const SearchComboboxLazy = dynamic(
  () => import('@/components/search-combobox').then((m) => m.SearchCombobox),
  { ssr: true },
);
