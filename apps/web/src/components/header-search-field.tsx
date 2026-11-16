'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { type ComponentProps } from 'react';
import { SearchCombobox } from '@/components/search-combobox';

/**
 * The header's search field (T-1850, D-435's design, option B): on a search
 * results page it holds the term asked, since from 1280px the page draws no
 * field of its own, and it is drawn afresh on every page the reader opens,
 * so a term typed on one page is not left in the field on the next.
 */
export function HeaderSearchField(
  props: Omit<ComponentProps<typeof SearchCombobox>, 'variant' | 'defaultValue'>,
) {
  const path = usePathname() ?? '';
  const params = useSearchParams();
  const onResults = /^\/[^/]+\/search\/?$/.test(path);
  const term = onResults ? (params?.get('q') ?? '').trim().replace(/\s+/g, ' ') : '';
  return <SearchCombobox key={`${path}?${term}`} variant="header" defaultValue={term} {...props} />;
}
