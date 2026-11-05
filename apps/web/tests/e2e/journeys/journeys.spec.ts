import { type Page, expect, test } from '@playwright/test';
import { leaveFirstRun, verifyLink } from './members';

/**
 * The blueprint's essential user journeys, the slices of them Phase 1 ships
 * (T-080, D-043), driven through the real web app, API, database and seed:
 *
 *   18.1 a new member predicts a match — picks an outcome on the match page's
 *        pick card (T-1739), is sent to create an account with the way back,
 *        registers, verifies the e-mail from the real message, saves the pick
 *        with one tap and adds a score, which lands in the history and stays
 *        open until kick-off;
 *   18.2 the live match card — the scores list and the match centre stay
 *        current over the stream;
 *   18.3 eligibility for high-rating privileges is a function of rating and
 *        sample, never of points;
 *   18.4 the member follows a team, sees it pinned, and moves team → match →
 *        player → search without a dead end.
 *
 * With two additions from Phase 2. T-135: blueprint 6.6's community consensus,
 * checked at the point it is most dangerous — one member has predicted, and the
 * page must not turn that into what "the community" thinks. T-137: the
 * Predictions page keeps the three products in three sections rather than one
 * ranked feed with a source tag.
 *
 * Runs only in the `journeys` project (E2E_API_URL set). The tests share one
 * member and run in order.
 */
const API = process.env.E2E_API_URL ?? '';
const RUN = Date.now().toString(36).slice(-6);
const USERNAME = `e2e_${RUN}`;
const EMAIL = `${USERNAME}@example.test`;
const PASSWORD = 'correct horse battery staple';
const OPEN_MATCH = '00000000-0000-4000-8000-000000000902';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const PLAYED_DAY = '2025-01-05';

test.describe.configure({ mode: 'serial' });

test.describe('blueprint journeys', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('18.1 a visitor picks an outcome, is sent to create an account, verifies and predicts', async () => {
    await page.goto(`/en/match/${OPEN_MATCH}`);
    await expect(page.getByTestId('match-header')).toBeVisible();
    await expect(page.getByTestId('home-team')).toContainText('Liverpool');
    // The pick card stands directly under the model's card, before the
    // timeline (T-1739, D-360), and is on the page once.
    const card = page.locator('#pick');
    const control = card.getByTestId('pick-control');
    await expect(page.getByTestId('pick-control')).toHaveCount(1);
    await expect(control).toHaveAttribute('data-pick', 'open');
    const model = (await page.getByTestId('forecast-reality').boundingBox())!;
    const pick = (await card.boundingBox())!;
    const timeline = (await page.getByTestId('section-timeline').boundingBox())!;
    expect(pick.y).toBeGreaterThanOrEqual(model.y + model.height);
    expect(pick.y + pick.height).toBeLessThanOrEqual(timeline.y);
    // While the pick is open the Predictions tab leads to it.
    await expect(page.locator('[data-tab-link="predictions"]')).toHaveAttribute('href', '#pick');
    // A guest is told what saving takes in plain words, and that the pick
    // stays the community's.
    await expect(card.getByTestId('match-pick-account')).toContainText(
      'a free account and a confirmed email address',
    );
    await expect(card).not.toContainText(/verified account/i);
    await expect(card.getByTestId('match-pick-separate')).toContainText('community picks only');

    // Coming back with an outcome in the address: it is marked, nothing is
    // stored, and the account is offered with the way back (D-359).
    const back = encodeURIComponent(`/en/match/${OPEN_MATCH}?pick=away#pick`);
    await page.goto(`/en/match/${OPEN_MATCH}?pick=away#pick`);
    await expect(control).toHaveAttribute('data-pick', 'chosen');
    await expect(control.locator('[data-option="away"] a')).toHaveAttribute('aria-current', 'true');
    await expect(control.getByTestId('pick-create')).toHaveAttribute(
      'href',
      `/en/register?next=${back}`,
    );
    await expect(control.getByTestId('pick-sign-in')).toHaveAttribute(
      'href',
      `/en/login?next=${back}`,
    );

    // A guest's outcome is a link to Create account, carrying the way back.
    await control.locator('[data-option="home"] a').click();
    await expect(page).toHaveURL(
      /\/en\/register\?next=%2Fen%2Fmatch%2F[0-9a-f-]+%3Fpick%3Dhome%23pick$/,
    );
    const form = page.getByTestId('register-form');
    // The form asks for what only the reader knows (T-1737, D-358): no display
    // name and no language; the zone is one line with the list behind it.
    await expect(form.getByLabel('Display name')).toHaveCount(0);
    await expect(form.getByLabel('Language')).toHaveCount(0);
    await expect(form.getByTestId('timezone-line')).toContainText('Time zone:');
    await expect(page.getByTestId('register-points').getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('register-email-use')).toBeVisible();
    await form.getByLabel('Username').fill(USERNAME);
    await form.getByLabel('Email').fill(EMAIL);
    // The password can be shown and hidden again before it is sent.
    const password = form.getByLabel('Password', { exact: true });
    await password.fill(PASSWORD);
    await expect(password).toHaveAttribute('type', 'password');
    await form.getByTestId('password-reveal').click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue(PASSWORD);
    await form.getByTestId('password-reveal').click();
    await expect(password).toHaveAttribute('type', 'password');
    await form.getByLabel('Country or territory').selectOption({ label: 'England' });
    await form.getByLabel('I accept the platform rules').check();
    await form.getByRole('button', { name: 'Create account' }).click();
    // The first run is offered once (T-620): skip a step, then "Not now" lands
    // on the way back the outcome link carried (T-1736, D-358): the same match
    // with the outcome still in the address. The homepage does not offer the
    // first run again.
    await leaveFirstRun(page, `/en/match/${OPEN_MATCH}?pick=home#pick`, { skipFirst: true });
    await expect(control).toHaveAttribute('data-pick', 'chosen');
    // The display name is the username until the member chooses one in Settings.
    await page.goto(`/en/u/${USERNAME}`);
    await expect(page.getByTestId('profile-name')).toHaveText(USERNAME);
    await page.goto('/en');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('first-run-offer')).toHaveCount(0);

    // Signed in but not verified, back at the match with the outcome they
    // chose as a guest: it is marked and not stored, the three outcomes are
    // there, and the requirement is named.
    await page.goto(`/en/match/${OPEN_MATCH}?pick=home#pick`);
    await expect(control).toHaveAttribute('data-pick', 'chosen');
    const home = control.locator('button[name="outcome"][value="home"]');
    await expect(home).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Verify your email address before predicting')).toBeVisible();
    await expect(card.getByTestId('match-pick-account')).toHaveCount(0);

    await page.goto(verifyLink(EMAIL));
    await expect(page.getByTestId('verify-result')).toBeVisible();

    await page.goto(`/en/match/${OPEN_MATCH}?pick=home#pick`);
    // The pick control (T-1738, D-359): the outcome from the address is
    // marked, and one tap stores it. Before any pick the members' spread is
    // not on the page.
    await expect(control).toHaveAttribute('data-pick', 'chosen');
    await expect(page.getByTestId('consensus-crowd')).toHaveCount(0);
    await expect(page.getByTestId('community-split')).toHaveCount(0);
    await home.click();
    await expect(control).toHaveAttribute('data-pick', 'saved');
    await expect(control.getByTestId('pick-saved')).toBeVisible();
    await expect(home).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('prediction-versions')).toContainText('Version 1');
    // The optional score and confidence are one disclosure away, and write a
    // new version (blueprint 6.6).
    await control.getByTestId('pick-detail').locator('summary').click();
    const detail = control.getByTestId('pick-detail-form');
    await detail.getByLabel('Liverpool goals').fill('2');
    await detail.getByLabel('Manchester United goals').fill('1');
    await detail.getByLabel('Confidence').selectOption('4');
    await detail.getByRole('button', { name: 'Update prediction' }).click();
    await expect(page.getByTestId('prediction-versions')).toContainText('Version 2');
    await expect(control).toHaveAttribute('data-pick', 'saved');
    await expect(control.getByTestId('pick-lock')).toContainText(/^Locks /);

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

  test('6.6 one member predicting does not become a community consensus', async () => {
    // The member from 18.1 has just predicted this match, and is the only one
    // who has. A page that answered with "100% home" would be reporting one
    // person's opinion as what the community thinks — and, because the sample
    // is one, it would also publish that member's prediction to anyone, which
    // they may have set their history to hide (T-056, D-052).
    await page.goto(`/en/match/${OPEN_MATCH}`);

    const consensus = page.getByTestId('consensus');
    await expect(consensus).toBeVisible();
    await expect(consensus).toHaveAttribute('data-state', 'not_supplied');
    await expect(consensus).toContainText('no consensus to show yet');

    // And the state it must never be in: a distribution on the page.
    await expect(page.getByTestId('consensus-crowd')).toHaveCount(0);
    await expect(page.getByTestId('consensus-weighted')).toHaveCount(0);
  });

  test('2.1 the matches page keeps the three products in their own places', async () => {
    // Blueprint 2.1's Predictions, and the page rule 6 was written for. Since
    // D-268 and D-269 it is the matches page: the model's percentages in each
    // row, the pick and the community's split in the preview, the founder's
    // analysis in its own section. An old /predictions address still lands
    // there, with its day and zone.
    await page.goto(`/en/predictions?date=${PLAYED_DAY}&tz=UTC`);
    await expect(page).toHaveURL(
      (url) => url.pathname === '/en/scores' && url.search === `?date=${PLAYED_DAY}&tz=UTC`,
    );
    await expect(page.getByTestId('title')).toHaveText('Matches');

    // The model's cell in its row, never a blended "prediction".
    await expect(page.getByTestId('row-forecast').first()).toBeVisible();

    // The founder's analysis, in the founder's voice and nobody else's. A
    // section that vanished when empty would leave a reader unable to tell
    // whether nothing is written or the site forgot to ask, so it stays.
    const analysis = page.getByTestId('matches-analysis');
    await expect(analysis).toBeVisible();
    await expect(analysis.locator('[data-voice="founder"]')).toHaveCount(1);
    await expect(analysis.locator('[data-voice="model"], [data-voice="community"]')).toHaveCount(0);
    await expect(analysis.getByTestId('matches-leaderboard-link')).toHaveAttribute(
      'href',
      '/en/leaderboard',
    );
    await expect(analysis.getByTestId('matches-accuracy-link')).toHaveAttribute(
      'href',
      '/en/model-accuracy',
    );

    // The header's Analysis: the old address and its fragment, carried over.
    await page.goto('/en/predictions#analysis');
    await expect(page).toHaveURL(/\/en\/scores#analysis$/);
    await expect(page.locator('#analysis')).toBeInViewport();
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

  test('T-312 the viewing territory is asked for, chosen, and remembered -- never guessed', async () => {
    await page.goto('/en/settings');
    // Registered in England, and still asked: the football country is not the territory.
    await expect(page.getByTestId('territory-state')).toContainText(
      'You have not chosen a territory yet',
    );
    const form = page.getByTestId('territory-form');
    await form.getByLabel('Where you watch from').selectOption({ label: 'United Kingdom' });
    await form.getByRole('button', { name: 'Save viewing territory' }).click();
    await expect(page.getByTestId('territory-state')).toContainText(
      'Viewing options are shown for United Kingdom.',
    );
    await page.reload();
    await expect(page.getByTestId('territory-state')).toContainText('United Kingdom');
    await expect(form.getByLabel('Where you watch from')).toHaveValue('GB');
  });

  test('T-314 where to watch asks a guest for a territory, and answers a member honestly -- never "not available"', async ({
    browser,
  }) => {
    // This run's member chose United Kingdom in T-312, and nobody has declared
    // any coverage there: the sentence names the territory and says nothing is
    // known, which is not the same as nothing to watch.
    await page.goto(`/en/match/${OPEN_MATCH}`);
    const panel = page.getByTestId('viewing');
    await expect(panel).toHaveAttribute('data-state', 'not_supplied');
    await expect(panel.getByTestId('viewing-not-supplied')).toContainText('United Kingdom');
    await expect(panel).not.toContainText('not available');
    await expect(panel.getByTestId('viewing-territory')).toContainText('Change territory');

    // A guest is asked, and the pick travels in the address rather than being
    // read off anything.
    const guest = await browser.newPage();
    await guest.goto(`/en/match/${OPEN_MATCH}`);
    const asked = guest.getByTestId('viewing');
    await expect(asked).toHaveAttribute('data-state', 'ask');
    await asked.getByLabel('Territory').selectOption({ label: 'Iran' });
    await asked.getByRole('button', { name: 'Show viewing options' }).click();
    await expect(guest).toHaveURL(/territory=IR/);
    await expect(guest.getByTestId('viewing')).toHaveAttribute('data-state', 'not_supplied');
    await expect(guest.getByTestId('viewing-not-supplied')).toContainText('Iran');

    // The Watch page: the same chooser, the day's matches, and the pick kept on its links.
    await guest.goto('/en/watch?territory=IR');
    await expect(guest.getByTestId('title')).toContainText('Watch');
    await expect(guest.getByTestId('viewing-territory-form').getByLabel('Territory')).toHaveValue(
      'IR',
    );
    await guest.close();

    // The team fixture list carries the same line, for the same member, in the
    // same words: not supplied, never not available. The list is the club
    // page's Fixtures tab since T-1386; the Overview's card names the next one.
    await page.goto(`/en/team/${LIVERPOOL}?tab=fixtures`);
    const line = page.getByTestId('fixtures').getByTestId('viewing-line').first();
    await expect(line).toHaveAttribute('data-state', 'not_supplied');
    await expect(line).toContainText('United Kingdom');
  });

  test('T-145 related news on the match centre says what it knows, and never shows an empty box', async () => {
    await page.goto(`/en/match/${OPEN_MATCH}`);
    const news = page.getByTestId('related-news');
    await expect(news).toBeVisible();
    // The seed carries no publishers: either the feeds were never read, or
    // they were and nothing links this match. Both are sentences, not a blank.
    await expect(news).toHaveAttribute('data-state', /^(not_supplied|nothing_linked)$/);
    await expect(news.getByTestId('related-news-freshness')).toBeVisible();
  });

  test('T-331 silences one team without silencing football, and unmutes with one button', async () => {
    await page.goto('/en/settings/notifications');
    const quiet = page.getByTestId('notification-mutes');
    await expect(quiet.getByTestId('no-mutes')).toBeVisible();
    const teamForm = quiet.getByTestId('mute-team');
    await teamForm.getByLabel('Silence a team').selectOption({ label: 'Liverpool' });
    await teamForm.getByRole('button', { name: 'Silence' }).click();
    const muted = quiet.getByTestId('notification-mute').filter({ hasText: 'Liverpool' });
    await expect(muted).toBeVisible();
    await expect(muted).toHaveAttribute('data-scope', 'team');
    // The football switch is untouched: silencing a club is not silencing football.
    await expect(page.getByTestId('notification-kind-prediction_settled')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await muted.getByRole('button', { name: 'Unmute' }).click();
    await expect(quiet.getByTestId('no-mutes')).toBeVisible();
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

  test('T-333 the Following feed says what it shows, and why each item is there', async () => {
    // 18.4 followed Liverpool as a favourite. The seed's matches are dated
    // 2025-01-05, outside the feed's window of a week either side of now, so
    // the honest answer is usually "nothing in the window" -- said, not blank.
    await page.goto('/en/following');
    await expect(page.getByTestId('title')).toHaveText('Following');
    await expect(page.getByTestId('feed-showing')).toContainText('ranked by');
    await expect(page.getByTestId('feed-showing')).toContainText('1 team');
    await expect(page.getByTestId('feed-ranking')).toHaveText('feed-rank@1');
    const items = page.getByTestId('feed-items');
    const reason = page.getByTestId('feed-reason');
    await expect(items.or(reason)).toBeVisible();
    if (await items.isVisible()) {
      // Every item says why it is here; the first reason names what is followed.
      const first = page.getByTestId('feed-item').first();
      await expect(
        first.getByTestId('feed-because').locator('[data-signal="follows"]'),
      ).toBeVisible();
      await expect(first.getByTestId('feed-rank')).toContainText('Rank');
    } else {
      await expect(reason).toContainText('Nothing has happened around what you follow');
    }
  });
});
