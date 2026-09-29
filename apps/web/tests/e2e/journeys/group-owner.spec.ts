import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { type Member, member, registerAndVerify } from './members';

/**
 * Running a group from its page (T-1026), with the API and the seed behind
 * it: the owner chooses who may invite and the group's language, makes an
 * invite link (shown once, with a copy control) and revokes it, reads the
 * group's history, and removes a member's message with a reason the author
 * is then told. Both directions of text, and no accessibility violation.
 *
 * Runs only in the `journeys` project (E2E_API_URL set). The tests share two
 * members and one group, and run in order.
 */
const RUN = Date.now().toString(36).slice(-6);
const API = process.env.E2E_API_URL ?? '';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OWNER: Member = member(RUN, 'go', 'Gita Owner');
const GUEST: Member = member(RUN, 'gm', 'Gil Member');
const SLUG = `e2e-group-${RUN}`;

let owner: Page;
let guest: Page;

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
}

test.describe.configure({ mode: 'serial' });

test.describe("a group's owner runs it from its page", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    owner = await context.newPage();
    guest = await (await browser.newContext()).newPage();
  });

  test.afterAll(async () => {
    await owner.close();
    await guest.close();
  });

  test('the owner has a group, and its page offers the settings', async () => {
    await registerAndVerify(owner, OWNER);
    const session = (await owner.context().cookies()).find((c) => c.name === 'fmip_session');
    expect(session, 'the owner session cookie').toBeDefined();
    const made = await owner.request.post(`${API}/groups`, {
      headers: { cookie: `fmip_session=${session!.value}` },
      data: { slug: SLUG, name: `Group ${RUN}`, visibility: 'public' },
    });
    expect(made.status()).toBe(201);

    await owner.goto(`/en/groups/${SLUG}`);
    await expect(owner.getByTestId('group-settings')).toBeVisible();
    await expect(owner.getByTestId('group-links')).toBeVisible();
    await expect(owner.getByTestId('group-history-link')).toBeVisible();
  });

  test('who may invite and the language are saved, and the policy is in the history', async () => {
    const policy = owner.getByTestId('group-policy');
    await policy.getByLabel('Every member').check();
    await policy.getByTestId('group-policy-submit').click();
    await expect(owner.getByTestId('group-policy-result')).toContainText('Saved.');

    const about = owner.getByTestId('group-about');
    await about.getByTestId('group-about-language').selectOption('pt');
    await about.getByTestId('group-about-submit').click();
    await expect(owner.getByTestId('group-about-result')).toContainText('Saved.');
    await expect(owner.getByTestId('group-language')).toBeVisible();

    await owner.getByTestId('group-history-link').click();
    await expect(owner).toHaveURL(new RegExp(`/en/groups/${SLUG}/history$`));
    const entry = owner.getByTestId('group-history-list').locator('li').first();
    await expect(entry.getByTestId('group-history-action')).toHaveText('Who may invite changed');
    await expect(entry.getByTestId('group-history-before')).toContainText(
      "The owner and the group's moderators",
    );
    await expect(entry.getByTestId('group-history-after')).toContainText('Every member');
    expect(await axe(owner)).toEqual([]);
  });

  test('a link is shown once with a copy control, listed without its token, and revoked', async () => {
    await owner.goto(`/en/groups/${SLUG}`);
    await owner.getByTestId('group-link-new-submit').click();
    const url = owner.getByTestId('group-link-url');
    await expect(url).toHaveValue(/\/en\/group-invite\/\S+$/);
    const token = (await url.inputValue()).split('/group-invite/')[1]!;

    await owner.getByTestId('group-link-copy').click();
    await expect(owner.getByTestId('group-link-copy-result')).toHaveText('Copied.');
    expect(await owner.evaluate(() => navigator.clipboard.readText())).toContain(token);

    const list = owner.getByTestId('group-links-list');
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.getByTestId('group-link-state')).toHaveText('Live');
    await expect(list).not.toContainText(token);
    expect(await axe(owner)).toEqual([]);

    // Reloading loses it for good: only its hash is stored.
    await owner.reload();
    await expect(owner.getByTestId('group-link-url')).toHaveCount(0);
    await expect(owner.locator('body')).not.toContainText(token);

    // The row itself says so: a revoked link has no revoke control to answer beside.
    await list.getByTestId('group-link-revoke-submit').click();
    await expect(list.getByTestId('group-link-state')).toHaveText('Revoked');
    await owner.reload();
    await expect(owner.getByTestId('group-link-state')).toHaveText('Revoked');
    await expect(owner.getByTestId('group-link-revoke')).toHaveCount(0);
  });

  test('the settings mirror under right-to-left', async () => {
    await owner.goto(`/x-rtl/groups/${SLUG}`);
    await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
    const option = owner.getByTestId('group-policy').locator('label').first();
    const radio = await option.locator('input').boundingBox();
    const words = await option.locator('span').first().boundingBox();
    expect(radio, 'the radio').not.toBeNull();
    expect(words, 'its label').not.toBeNull();
    // The control comes first in reading order, so under right-to-left it
    // sits to the right of its words; physical sides would leave it on the left.
    expect(radio!.x).toBeGreaterThan(words!.x);
  });

  test("the owner removes a member's message with a reason, and the member is told why", async () => {
    await registerAndVerify(guest, GUEST);
    await guest.goto(`/en/groups/${SLUG}`);
    await guest.getByTestId('group-join').click();
    await expect(guest.getByTestId('group-leave')).toBeVisible();
    // A member sees no settings and no history; the links are theirs to make.
    await guest.reload();
    await expect(guest.getByTestId('group-settings')).toHaveCount(0);
    await expect(guest.getByTestId('group-history-link')).toHaveCount(0);
    await expect(guest.getByTestId('group-links')).toBeVisible();

    await guest.getByTestId('group-conversation').click();
    const body = `Buy followers ${RUN}`;
    await guest.getByTestId('composer').getByLabel('Your message').fill(body);
    await guest.getByTestId('composer-send').click();
    await expect(guest.getByTestId('message').filter({ hasText: body })).toBeVisible();
    const conversation = guest.url();

    await owner.goto(conversation.replace(/^https?:\/\/[^/]+/, ''));
    const row = owner.getByTestId('message').filter({ hasText: body });
    await expect(row).toBeVisible();
    const moderate = owner.getByTestId('message-moderate');
    await moderate.locator('summary').click();
    await moderate.getByTestId('message-moderate-reason').fill('Spam.');
    await moderate.getByTestId('message-moderate-submit').click();
    await expect(owner.getByTestId('message-removed')).toBeVisible();
    await owner.reload();
    await expect(owner.getByTestId('message').filter({ hasText: body })).toHaveCount(0);
    await expect(owner.getByTestId('message-removed-reason')).toHaveCount(0);

    await guest.reload();
    await expect(guest.getByTestId('message-removed-reason')).toContainText('Spam.');
  });
});
