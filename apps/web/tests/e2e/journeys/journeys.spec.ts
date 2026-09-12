import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

/**
 * The blueprint's essential user journeys, the slices of them Phase 1 ships
 * (T-080, D-043), driven through the real web app, API, database and seed:
 *
 *   18.1 a new member predicts a match — sent to sign in, registers, verifies
 *        the e-mail from the real message, submits a prediction that lands in
 *        the history and stays open until kick-off;
 *   18.2 the live match card — the scores list and the match centre stay
 *        current over the stream;
 *   18.3 eligibility for high-rating privileges is a function of rating and
 *        sample, never of points;
 *   18.4 the member follows a team, sees it pinned, and moves team → match →
 *        player → search without a dead end.
 *
 * Runs only in the `journeys` project (E2E_API_URL set). The tests share one
 * member and run in order.
 */
const API = process.env.E2E_API_URL ?? '';
const API_LOG = process.env.API_LOG ?? '';
const RUN = Date.now().toString(36).slice(-6);
const USERNAME = `e2e_${RUN}`;
const EMAIL = `${USERNAME}@example.test`;
const PASSWORD = 'correct horse battery staple';
const OPEN_MATCH = '00000000-0000-4000-8000-000000000902';
const PLAYED_DAY = '2025-01-05';

/** The verification link from the API's mail log for our address (D-026: mail is logged). */
function verifyLink(): string {
  const log = readFileSync(API_LOG, 'utf8');
  const from = log.lastIndexOf(`[mail] to=${EMAIL}`);
  expect(from, 'a verification mail for the new member').toBeGreaterThanOrEqual(0);
  const match = /https?:\/\/\S+\/verify-email\?token=\S+/.exec(log.slice(from));
  expect(match, 'the verification link in the mail').not.toBeNull();
  return match![0];
}

test.describe.configure({ mode: 'serial' });

test.describe('blueprint journeys', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('18.1 a visitor is sent to sign in, registers, verifies and predicts', async () => {
    await page.goto(`/en/match/${OPEN_MATCH}`);
    await expect(page.getByTestId('match-header')).toBeVisible();
    await expect(page.getByTestId('home-team')).toContainText('Liverpool');
    await expect(page.getByTestId('prediction-guest')).toBeVisible();
    await page.getByTestId('prediction-guest').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/en\/login/);

    await page.getByRole('link', { name: 'Register' }).click();
    const form = page.getByTestId('register-form');
    await form.getByLabel('Username').fill(USERNAME);
    await form.getByLabel('Display name').fill('Journey Tester');
    await form.getByLabel('E-mail').fill(EMAIL);
    await form.getByLabel('Password').fill(PASSWORD);
    await form.getByLabel('Country or territory').selectOption({ label: 'England' });
    await form.getByLabel('I accept the platform rules.').check();
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/u/${USERNAME}$`));
    await expect(page.getByTestId('profile-name')).toHaveText('Journey Tester');

    // Signed in but not verified: the form is there, the requirement is named.
    await page.goto(`/en/match/${OPEN_MATCH}`);
    await expect(page.getByTestId('prediction-form')).toBeVisible();
    await expect(page.getByText('Verify your e-mail address before predicting')).toBeVisible();

    await page.goto(verifyLink());
    await expect(page.getByTestId('verify-result')).toBeVisible();

    await page.goto(`/en/match/${OPEN_MATCH}`);
    const prediction = page.getByTestId('prediction-form');
    await prediction.getByLabel('Liverpool', { exact: true }).check();
    await prediction.getByLabel('Liverpool goals').fill('2');
    await prediction.getByLabel('Manchester United goals').fill('1');
    await prediction.getByLabel('Confidence').selectOption('4');
    await prediction.getByRole('button', { name: 'Submit prediction' }).click();
    await expect(page.getByTestId('prediction-state')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('prediction-versions')).toContainText('Version 1');
    await expect(page.getByTestId('prediction')).toContainText('open until kick-off');

    // 18.2: the match centre is kept current over the stream.
    await expect(page.getByTestId('live-state')).toHaveAttribute('data-state', 'live', {
      timeout: 15_000,
    });

    // The prediction is in the member's history, open until kick-off, with no rating yet.
    await page.goto(`/en/u/${USERNAME}`);
    const item = page.getByTestId('history-item').first();
    await expect(item).toContainText('Home win 2–1 · confidence 4/5');
    await expect(item).toContainText('Open until kick-off');
    await expect(page.getByTestId('rating-none')).toBeVisible();
  });

  test('18.3 privileges follow rating and sample, never points', async ({ request }) => {
    const session = (await page.context().cookies()).find((c) => c.name === 'fmip_session');
    expect(session, 'the member session cookie').toBeDefined();
    const headers = { cookie: `fmip_session=${session!.value}` };

    const eligibility = await request.get(`${API}/me/eligibility`, { headers });
    expect(eligibility.status()).toBe(200);
    const body = (await eligibility.json()) as {
      eligibility: { eligible: boolean; reasons: string[]; rules_version: string };
    };
    expect(body.eligibility.eligible).toBe(false);
    expect(body.eligibility.reasons.length).toBeGreaterThan(0);
    expect(body.eligibility.rules_version).toMatch(/^privilege-eligibility@/);

    const points = await request.get(`${API}/me/points`, { headers });
    expect(((await points.json()) as { points: { total: number } }).points.total).toBe(0);

    await page.goto('/en/leaderboard');
    await expect(page.getByTestId('min-sample')).toContainText('30');
    await expect(
      page.getByTestId('leaderboard-empty').or(page.getByTestId('leaderboard')),
    ).toBeVisible();
  });

  test('18.4 follows a team, sees it pinned, and moves team → match → player → search', async () => {
    await page.goto('/en/settings');
    const teamForm = page.locator('form').filter({ has: page.getByLabel('Follow a team') });
    await teamForm.getByLabel('Follow a team').selectOption({ label: 'Liverpool' });
    await teamForm.getByRole('button', { name: 'Follow', exact: true }).click();
    const following = page.getByTestId('following-item').filter({ hasText: 'Liverpool' });
    await expect(following).toBeVisible();
    await following.getByRole('button', { name: 'Make favourite' }).click();
    await expect(following.getByLabel('favourite')).toBeVisible();

    await page.goto(`/en/scores?date=${PLAYED_DAY}`);
    const pinned = page.getByTestId('pinned');
    await expect(pinned).toBeVisible();
    await expect(pinned.getByTestId('score-card').first()).toContainText('Liverpool');
    await expect(page.getByTestId('live-state')).toHaveAttribute('data-state', 'live', {
      timeout: 15_000,
    });

    await pinned.getByTestId('match-link').first().click();
    await expect(page.getByTestId('match-header')).toBeVisible();
    await page.getByTestId('home-team').getByRole('link').click();
    await expect(page).toHaveURL(/\/en\/team\//);
    await expect(page.getByTestId('title')).toHaveText('Liverpool');
    await expect(page.getByTestId('followers')).toContainText(/\d+ follower/);

    await page.getByTestId('squad').getByRole('link', { name: 'Mohamed Salah' }).click();
    await expect(page).toHaveURL(/\/en\/player\//);
    await expect(page.getByTestId('title')).toHaveText('Mohamed Salah');
    await expect(page.getByTestId('current-team')).toContainText('Liverpool');

    await page.goto('/en/search?q=Man%20Utd');
    const hit = page.getByTestId('search-result').first();
    await expect(hit).toContainText('Manchester United');
    await expect(hit.getByTestId('search-alias')).toContainText('also known as Man Utd');
  });
});
