'use client';

import dynamic from 'next/dynamic';

/**
 * The header's search field with its suggestions (T-1844, D-435), kept off
 * every page's first load: the server still draws the whole field, so the
 * plain GET form works at once, and the field's code -- reading the address
 * (T-1850) and the list -- arrives as a chunk of its own (docs/08-load-test.md,
 * "Page budgets": chunks a dynamic import loads are not first-load). The
 * search page imports `SearchCombobox` itself.
 */
export const HeaderSearchFieldLazy = dynamic(
  () => import('@/components/header-search-field').then((m) => m.HeaderSearchField),
  { ssr: true },
);
