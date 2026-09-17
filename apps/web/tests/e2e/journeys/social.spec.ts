import { type Page, expect, test } from '@playwright/test';
import { type Member, member, registerAndVerify } from './members';

/**
 * Blueprint 19's social list, walked with two members (Phase 3 exit criteria).
 *
 * **Why this file exists at all.** The Phase 3 exit criteria were walked on the
 * public preview on 2026-09-16 and four of them were met. Everything else --
 * friend requests, blocking, messages arriving in order, messages arriving at
 * all -- was recorded as *not met, and the reason is not the code*: those
 * criteria need two members interacting, and the preview has none, because its
 * verification links exist only in a service log behind the maintainer's own
 * hosting account.
 *
 * A walk on a deployment is evidence once. This is the same walk as a test, so
 * it is evidence on every commit, which is the stronger thing -- and it needs
 * nobody's password and nobody's dashboard.
 *
 * **One criterion is checkable here and nowhere else we have.** "Messages
 * arrive in real time" needs Redis for the bus and a socket the page can reach.
 * The preview has neither by design (`docs/11-preview.md`), which is why that
 * criterion was written down as waiting for T-074. The journeys job has a real
 * Redis and a real API, so the socket is reachable and the claim is testable.
 *
 * Runs only in the `journeys` project (E2E_API_URL set). The tests share two
 * members and run in order.
 */
const RUN = Date.now().toString(36).slice(-6);

/** Two contexts, because two members is two sessions and a cookie jar holds one. */
let alex: Page;
let robin: Page;

const A: Member = member(RUN, 'a', 'Alex Tester');
const B: Member = member(RUN, 'b', 'Robin Tester');

/** What `FriendControls` is saying, so a test can assert what it did *not* say. */
async function friendState(page: Page): Promise<string> {
  return (await page.getByTestId('friend-state').textContent()) ?? '';
}

/** Send one message and wait for the store, not for the socket. */
async function send(page: Page, body: string): Promise<void> {
  await page.getByTestId('composer').getByLabel('Your message').fill(body);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('message').filter({ hasText: body })).toBeVisible();
}

/** Where each body sits in the rendered conversation, top to bottom. */
async function order(page: Page, bodies: string[]): Promise<number[]> {
  const rendered = await page.getByTestId('message').allTextContents();
  return bodies.map((body) => rendered.findIndex((text) => text.includes(body)));
}

test.describe.configure({ mode: 'serial' });

test.describe('blueprint 19 social, with two members', () => {
  let conversation = '';

  test.beforeAll(async ({ browser }) => {
    alex = await (await browser.newContext()).newPage();
    robin = await (await browser.newContext()).newPage();
  });

  test.afterAll(async () => {
    await alex.close();
    await robin.close();
  });

  test('two members exist, and each opened their own verification link', async () => {
    await registerAndVerify(alex, A);
    await registerAndVerify(robin, B);

    // Each session is the member who signed into it. A test that got this
    // wrong would still pass most of what follows, with one member talking to
    // themselves.
    await alex.goto(`/en/u/${A.username}`);
    await expect(alex.getByTestId('profile-name')).toHaveText(A.displayName);
    await robin.goto(`/en/u/${B.username}`);
    await expect(robin.getByTestId('profile-name')).toHaveText(B.displayName);
  });

  test('19.1 a friend request reaches the recipient, and is theirs to accept', async () => {
    await alex.goto(`/en/u/${B.username}`);
    await alex.getByTestId('friend-add').click();
    await expect(alex.getByTestId('friend-state')).toHaveText('Friend request sent.');

    // It arrives where the recipient looks for it, not only in the sender's view.
    await robin.goto('/en/friends');
    await expect(robin.getByTestId('requests-none')).toHaveCount(0);
    await expect(robin.getByTestId('friend-requests')).toContainText(A.displayName);

    // And the accept control is on the recipient's page, never the sender's.
    await expect(alex.getByTestId('friend-accept')).toHaveCount(0);
    await robin.getByTestId('friend-accept').click();

    await robin.goto('/en/friends');
    await expect(robin.getByTestId('friend-list')).toContainText(A.displayName);
    await alex.goto(`/en/u/${B.username}`);
    await expect(alex.getByTestId('friend-state')).toHaveText('You are friends.');
  });

  test('19.2 a conversation keeps its order, and both members see the same one', async () => {
    await alex.goto(`/en/u/${B.username}`);
    await alex.getByTestId('start-conversation').click();
    await expect(alex).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
    conversation = alex.url().split('/').pop() ?? '';

    const bodies = ['First, from Alex.', 'Second, from Robin.', 'Third, from Alex again.'];

    await send(alex, bodies[0]);
    await robin.goto(`/en/messages/${conversation}`);
    await send(robin, bodies[1]);
    await alex.reload();
    await send(alex, bodies[2]);

    // Three messages, in the order they were sent, for the member who sent two
    // of them and for the member who sent one.
    await expect(alex.getByTestId('message')).toHaveCount(3);
    expect(await order(alex, bodies)).toEqual([0, 1, 2]);

    await robin.reload();
    await expect(robin.getByTestId('message')).toHaveCount(3);
    expect(await order(robin, bodies)).toEqual([0, 1, 2]);
  });

  test('19.3 a message arrives without the reader doing anything', async () => {
    // The socket says it is live before anything is sent. Asserting this first
    // is what stops the test passing on a page that re-rendered for some other
    // reason -- and it is the state rule 4 cares about: a page that is not live
    // must not look live.
    await expect(robin.getByTestId('conversation-live')).toHaveAttribute('data-state', 'live', {
      timeout: 15_000,
    });

    const body = 'Fourth, and nobody pressed anything to see it.';
    await send(alex, body);

    // `robin` is not reloaded, navigated or otherwise touched in this test.
    await expect(robin.getByTestId('message').filter({ hasText: body })).toBeVisible({
      timeout: 15_000,
    });
    await expect(robin.getByTestId('message')).toHaveCount(4);
  });

  test('19.4 a block is not symmetrical, and is not announced', async () => {
    await robin.goto(`/en/u/${A.username}`);
    await robin.getByTestId('friend-block').click();
    await expect(robin.getByTestId('friend-state')).toContainText(`You blocked @${A.username}`);

    // The blocked member is told a request cannot be sent. They are not told
    // they were blocked, and not by whom -- that distinction is the design
    // (T-205), so assert the absence and not only the presence.
    await alex.goto(`/en/u/${B.username}`);
    const seen = await friendState(alex);
    expect(seen).toContain('cannot send');
    expect(seen.toLowerCase()).not.toContain('block');

    // The exit stays available to the member who did not take it.
    await expect(alex.getByTestId('friend-block')).toBeVisible();

    // And the block is listed where its owner can undo it.
    await robin.goto('/en/friends');
    await expect(robin.getByTestId('blocks-none')).toHaveCount(0);
    await expect(robin.getByTestId('block-list')).toContainText(A.displayName);

    await robin.goto(`/en/u/${A.username}`);
    await robin.getByTestId('friend-unblock').click();
    await expect(robin.getByTestId('friend-add')).toBeVisible();
  });
});
