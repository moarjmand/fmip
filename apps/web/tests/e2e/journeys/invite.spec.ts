import { expect, test } from '@playwright/test';
import { type Member, member, registerAndVerify } from './members';

/**
 * T-522: a member's invite link. The new member registers through it, lands
 * on the inviter's profile with its friend-request control and a sentence
 * saying why, and nothing has been sent on their behalf.
 *
 * Runs only in the `journeys` project (E2E_API_URL set).
 */
const RUN = Date.now().toString(36).slice(-6);
const INVITER: Member = member(RUN, 'inv', 'Ina Inviter');
const GUEST: Member = member(RUN, 'gst', 'Gus Guest');

test('a friend who registers through an invite link is offered, not signed up for, a friendship', async ({
  browser,
}) => {
  const inviter = await (await browser.newContext()).newPage();
  await registerAndVerify(inviter, INVITER);
  await inviter.goto(`/en/u/${INVITER.username}`);
  // The member's own link is on their own profile.
  await expect(inviter.getByTestId('invite-link')).toBeVisible();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/en/register?invited_by=${INVITER.username}`);
  await expect(guest.getByTestId('invited-by')).toContainText(`@${INVITER.username}`);
  const form = guest.getByTestId('register-form');
  await form.getByLabel('Username').fill(GUEST.username);
  await form.getByLabel('Display name').fill(GUEST.displayName);
  await form.getByLabel('E-mail').fill(GUEST.email);
  await form.getByLabel('Password').fill(GUEST.password);
  await form.getByLabel('Country or territory').selectOption({ label: 'England' });
  await form.getByLabel('I accept the platform rules.').check();
  await form.getByRole('button', { name: 'Create account' }).click();

  await expect(guest).toHaveURL(new RegExp(`/en/u/${INVITER.username}\\?invited=1$`));
  await expect(guest.getByTestId('invited-note')).toBeVisible();
  // Offered, not done: the control still offers to add, and the inviter has no request.
  await expect(guest.getByTestId('friend-add')).toBeVisible();
  await inviter.goto('/en/friends');
  await expect(inviter.getByText(GUEST.displayName)).toHaveCount(0);

  // A link naming nobody plausible is simply a registration page (signed out,
  // since a signed-in member is sent to their own profile from it).
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto('/en/register?invited_by=..%2Fadmin');
  await expect(stranger.getByTestId('register-form')).toBeVisible();
  await expect(stranger.getByTestId('invited-by')).toHaveCount(0);
});
