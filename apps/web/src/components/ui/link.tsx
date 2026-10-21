import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * The site's internal link (T-1456): `next/link` with viewport prefetching
 * off unless a caller asks for it.
 *
 * By default Next prefetches every link that scrolls into view. GTmetrix
 * counted about forty-five such requests on the homepage on 2026-10-21, each
 * twice (the route tree, then its segment), every one a dynamic render of the
 * layout on a two-core server, and on a slow connection they compete with the
 * page itself. What they bought was little: no route has a `loading.js`, so a
 * dynamic route's prefetch stops at the root layout the reader already has,
 * and the page's data is fetched on the click either way.
 *
 * `eslint.config.mjs` refuses `next/link` everywhere else, so a new link
 * gets this default without anyone remembering it.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
