import { connection } from 'next/server';
import { DEMONSTRATION_NOTICE, isDemonstrationData } from '@/lib/demonstration';

/**
 * The band that says the football on this site did not happen (T-087).
 *
 * **Why `connection()` is the first line.** `DEMONSTRATION_DATA` reaches the
 * container as a runtime variable; Render does not pass it into `docker build`.
 * A server component that read it while Next.js was prerendering would read
 * nothing, bake "not demonstration data" into the HTML, and ship a page of
 * invented scores with no marker on it — the exact failure, arrived at by being
 * fast. `connection()` is the line that says: this subtree cannot be answered
 * before a request exists.
 *
 * It is called **before** the check rather than after, because a check that
 * runs at build time has already given the wrong answer by the time anything
 * asks what to do with it.
 *
 * The cost is honest and small: 26 of the 29 pages are already
 * `force-dynamic`, and the three that were not — `offline`, `forgot-password`,
 * `reset-password` — carry no football data and no meaningful prerendering
 * saving. (The service worker caches the offline page's *response*, so T-082 is
 * unaffected.) If it ever costs more than that, the fix is a Docker build
 * argument, not a quieter banner.
 *
 * **It cannot be dismissed.** There is no close button and no JavaScript: a
 * marker a reader can turn off is a marker that is off for everybody who turned
 * it off, and on for nobody who shares a screenshot.
 */
export async function DemonstrationBanner() {
  await connection();
  if (!isDemonstrationData()) return null;

  return (
    <aside
      role="note"
      data-testid="demonstration-banner"
      className="border-b-2 border-current bg-current/10 px-4 py-2 text-sm font-medium"
    >
      {DEMONSTRATION_NOTICE}
    </aside>
  );
}
