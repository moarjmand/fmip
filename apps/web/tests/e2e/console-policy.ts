import type { Page } from '@playwright/test';

/**
 * What the agents console's specs share (T-1881): the enforced content policy
 * a console page must answer with, and a watch on everything a browser
 * refuses under it.
 */

/** The console's host in the e2e server (`playwright.config.ts`); Chromium resolves it to this machine. */
export const CONSOLE_HOST = 'agents.localhost';

/**
 * The policy of a console page, whole, its nonce captured. `style-src` has
 * no nonce on purpose: Next (16.4.5 as 16.3.4) writes the stylesheet
 * `experimental.inlineCss` inlines without one (`src/lib/console-headers.ts`).
 */
export const CONSOLE_POLICY =
  /^default-src 'self'; script-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'$/;

interface Watched {
  __refused?: string[];
}

/**
 * Everything the browser refuses under a page's policy from now on, on this
 * page and every document it moves to: the `securitypolicyviolation` events,
 * heard from before any of the page's scripts run, and Chromium's own
 * console errors about the policy. Call the result after each page; it
 * answers what has been refused so far.
 */
export async function watchPolicy(page: Page): Promise<() => Promise<string[]>> {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text()))
      refused.push(`${new URL(page.url()).pathname}: ${message.text()}`);
  });
  // Outside the page's policy: an init script is the browser's, not the page's.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (globalThis as unknown as Watched).__refused = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(
        `${location.pathname}: ${event.effectiveDirective} refused ${event.blockedURI || 'inline'}`,
      );
    });
  });
  return async () => {
    const events = await page.evaluate(() => (globalThis as unknown as Watched).__refused ?? []);
    for (const event of events) if (!refused.includes(event)) refused.push(event);
    return [...refused];
  };
}
