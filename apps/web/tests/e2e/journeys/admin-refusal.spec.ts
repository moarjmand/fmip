import { expect, test } from '@playwright/test';

/**
 * Every page of the administration console, to someone who may not use it
 * (T-813). The API refuses them -- `apps/api/src/security/console-security.http.spec.ts`
 * checks every console route for that -- and this checks what the page does
 * with the refusal: a guest is sent to sign in, a signed-in member without a
 * role is told the page is not theirs (or, for the overview and campaigns,
 * is not told the area exists), and neither is shown any of the console's
 * data or its forms.
 *
 * The member is registered through the API directly, not the form: what is
 * under test is the admin pages, and `journeys.spec.ts` already walks the
 * form. The session cookie the API sets is handed to the browser, which is
 * what signing in through the web app does too.
 */

const API = process.env.E2E_API_URL ?? '';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const USERNAME = `e2e_noadmin_${RUN}`;

/**
 * Pages that say "not for you" in words, by the test id of that sentence.
 * `MEMBER` stands for the member's own username: test titles must be the same
 * in every worker, and the username is not.
 */
const MEMBER = '<member>';
const REFUSING: Record<string, string> = {
  '/en/admin/system': 'system-forbidden',
  '/en/admin/news-sources': 'news-sources-forbidden',
  '/en/admin/data-quality': 'data-quality-forbidden',
  '/en/admin/competitions': 'competition-order-forbidden',
  '/en/admin/rating-thresholds': 'rating-thresholds-forbidden',
  '/en/admin/news-coverage': 'news-coverage-forbidden',
  '/en/admin/model-candidates': 'model-candidates-forbidden',
  '/en/admin/model-accuracy': 'model-accuracy-forbidden',
  '/en/admin/moderation': 'moderation-queue-forbidden',
  [`/en/admin/moderation/${MEMBER}`]: 'moderation-history-forbidden',
  [`/en/admin/members/${MEMBER}`]: 'member-page-forbidden',
  '/en/admin/moderation/groups/no-such-group': 'moderation-group-forbidden',
  '/en/admin/contributors': 'contributors-forbidden',
  '/en/admin/panels': 'panels-forbidden',
  '/en/admin/homepage': 'homepage-features-forbidden',
  '/en/admin/analysis-reviews': 'analysis-queue-forbidden',
  '/en/admin/translations': 'translations-forbidden',
  '/en/admin/news': 'news-desk-forbidden',
  '/en/admin/viewing': 'viewing-console-forbidden',
};
/** Pages that do not admit the area exists to a member without the role. */
const HIDDEN = ['/en/admin', '/en/admin/campaigns'];

test.describe('the admin console to someone without the role', () => {
  let session = '';

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: API });
    const registered = await api.post('/auth/register', {
      data: {
        username: USERNAME,
        display_name: 'Not An Administrator',
        email: `${USERNAME}@example.test`,
        password: 'correct horse battery staple',
        country_id: '00000000-0000-4000-8000-000000000101',
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(registered.status(), await registered.text()).toBe(201);
    session = /fmip_session=([^;]*)/.exec(registered.headers()['set-cookie'] ?? '')?.[1] ?? '';
    expect(session).not.toBe('');
    await api.dispose();
  });

  for (const path of [...Object.keys(REFUSING), ...HIDDEN]) {
    test(`${path}: a guest is sent to sign in`, async ({ page }) => {
      await page.goto(path.replace(MEMBER, USERNAME));
      await expect(page).toHaveURL(/\/en\/login/);
    });
  }

  for (const [path, testId] of Object.entries(REFUSING)) {
    test(`${path}: a member is told it is not theirs, and shown nothing of it`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'fmip_session', value: session, url: baseURL }]);
      const url = path.replace(MEMBER, USERNAME);
      await page.goto(url);
      // Not sent anywhere else: the refusal is on the page that was asked for.
      expect(new URL(page.url()).pathname).toBe(url);
      await expect(page.getByTestId(testId)).toBeVisible();
      // The refusal is the whole page: no table, no list and no form of the console.
      await expect(page.locator('main table, main form, main ul, main ol')).toHaveCount(0);
    });
  }

  for (const path of HIDDEN) {
    test(`${path}: a member is shown the page that does not exist`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'fmip_session', value: session, url: baseURL }]);
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator('main table, main form')).toHaveCount(0);
    });
  }
});
