import { expect, test, type APIResponse } from '@playwright/test';
import { CONSOLE_HOST, CONSOLE_POLICY as POLICY, watchPolicy } from './console-policy';

/**
 * The agents console's answers from the built app (T-1881), under the site's
 * path (`CONSOLE_PATH=/agents`, D-341) and on the console's own host
 * (`CONSOLE_HOST=agents.localhost`, D-340), both set by `playwright.config.ts`:
 * never framed, kept, indexed or a referrer, with the enforced content policy
 * and a nonce on every script; the sign-in page works under it with no
 * violation; `/console/...` is not an address on the site's host, with a file
 * extension or without; and a site page gets none of this.
 *
 * `src/proxy.spec.ts` checks the same rules on the proxy alone. This is the
 * matcher, the rewrite and Next's own headers together, which only a running
 * server shows. The pages behind the sign-in are walked under the policy by
 * `journeys/console-policy.spec.ts`, which has an API to sign in to.
 */

/** The headers every console answer carries, whatever it is. */
function expectConsoleHeaders(response: APIResponse): Record<string, string> {
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy-report-only']).toBeUndefined();
  return headers;
}

const FORMS = [
  { name: 'under the path on the site’s host', host: undefined, login: '/agents/login' },
  { name: 'on the console’s own host', host: CONSOLE_HOST, login: '/login' },
];

for (const form of FORMS) {
  const headers = form.host === undefined ? undefined : { host: form.host };

  test.describe(`the console ${form.name}`, () => {
    test('answers its sign-in page with the headers and a nonce on every script', async ({
      request,
    }) => {
      const response = await request.get(form.login, { headers });
      expect(response.status()).toBe(200);
      const policy = expectConsoleHeaders(response)['content-security-policy']!;
      const nonce = POLICY.exec(policy)?.[1];
      expect(nonce, policy).toBeDefined();

      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`);
      // The inlined stylesheet carries no nonce, which is why `style-src` is
      // `'unsafe-inline'` (seen on Next 16.3.4 and 16.4.5). If this fails after
      // an upgrade, Next has started to write it: put the nonce in `style-src`
      // (`src/lib/console-headers.ts`) and turn this expectation round.
      const styles = html.match(/<style[^>]*>/g) ?? [];
      expect(styles.length).toBeGreaterThan(0);
      for (const style of styles) expect(style).not.toContain('nonce=');
      // A second request gets a nonce of its own.
      const again = await request.get(form.login, { headers });
      expect(POLICY.exec(again.headers()['content-security-policy']!)?.[1]).not.toBe(nonce);
    });

    test('answers a redirect, a route handler, an unknown page and a server action the same', async ({
      request,
    }) => {
      const base = form.login.replace(/\/login$/, '');
      // Without a session: the overview sends to sign-in.
      const overview = await request.get(base === '' ? '/' : base, { headers, maxRedirects: 0 });
      expect(overview.status()).toBe(307);
      expect(overview.headers()['location']).toBe(form.login);
      expectConsoleHeaders(overview);
      // The reminders' service worker, a route handler.
      const worker = await request.get(`${base}/reminders-worker`, { headers });
      expect(worker.status()).toBe(200);
      expect(worker.headers()['content-type']).toContain('text/javascript');
      expectConsoleHeaders(worker);
      // A request picture's address keeps its own policy: nothing loads, nothing runs.
      const picture = await request.get(`${base}/request-images/not-an-id/not-an-id`, { headers });
      expect(picture.status()).toBe(404);
      expect(expectConsoleHeaders(picture)['content-security-policy']).toBe(
        "default-src 'none'; sandbox; frame-ancestors 'none'",
      );
      const unknown = await request.get(`${base}/no-such-page`, { headers });
      expect(unknown.status()).toBe(404);
      expectConsoleHeaders(unknown);
      // A server action's answer (here: an action that does not exist).
      const action = await request.post(form.login, {
        headers: { ...headers, 'next-action': '0000', 'content-type': 'text/plain' },
        data: '[]',
      });
      expectConsoleHeaders(action);
    });
  });
}

test.describe('the console’s sign-in page in a browser', () => {
  const pages = [
    { name: 'under the path', url: '/agents/login' },
    // Chromium resolves every name under `localhost` to this machine.
    { name: 'on its own host', url: (base: string) => base.replace('127.0.0.1', CONSOLE_HOST) },
  ];
  for (const { name, url } of pages) {
    test(`${name}: styled, hydrated and answering its form, with nothing refused`, async ({
      page,
      baseURL,
    }) => {
      const refused = await watchPolicy(page);
      const address = typeof url === 'string' ? url : `${url(baseURL!)}/login`;
      const response = await page.goto(address);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-security-policy']).toMatch(POLICY);

      // The inlined stylesheet applied: the console's font and its dark canvas.
      const body = page.locator('body');
      await expect(body).toHaveCSS('font-family', /Vazirmatn/);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      // The form is a server action: its answer comes back under the policy.
      await page.locator('input[name="username"]').fill('nobody');
      await page.locator('input[name="password"]').fill('not-a-password');
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('form [role="status"] span')).not.toBeEmpty();
      await expect(page).toHaveURL(/\/login$/);

      expect(await refused()).toEqual([]);
    });
  }
});

test.describe('the console’s routes on the site’s host', () => {
  for (const path of [
    '/console',
    '/console/login',
    '/console/agents/security.md',
    '/console/request-images/a.png',
    '/console/reminders-worker.js',
    // Next's other addresses of the same routes: their payload, their segments.
    '/console.rsc',
    '/console/login.rsc',
    '/console.segments/_tree.segment.rsc',
  ]) {
    test(`${path} is a 404 and never the console`, async ({ request }) => {
      // The base header a browser sends is never believed.
      const response = await request.get(path, {
        headers: { 'x-fmip-console-base': '/agents' },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(404);
      expect(await response.text()).toBe('Not found');
      expect(expectConsoleHeaders(response)['content-security-policy']).toBe(
        "frame-ancestors 'none'",
      );
    });
  }
});

test.describe('a site page', () => {
  for (const path of ['/en/about', '/fa/about', '/en/no-such-page']) {
    test(`${path} gets none of the console’s headers`, async ({ request }) => {
      const headers = (await request.get(path)).headers();
      expect(headers['content-security-policy']).toBeUndefined();
      expect(headers['x-frame-options']).toBeUndefined();
      expect(headers['referrer-policy']).toBeUndefined();
    });
  }
});
