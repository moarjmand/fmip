import { readFileSync } from 'node:fs';
import { type Page, expect } from '@playwright/test';

/**
 * Making a member, the way a member is actually made.
 *
 * Two specs need this now, which is the reason it is a module rather than a
 * copy: `journeys.spec.ts` needs one member, and `social.spec.ts` needs two,
 * because every criterion in blueprint 19's social list is about what one
 * member can do *to another one* and none of it can be seen with a single
 * account.
 *
 * Nothing here shortcuts the product. The account is created through the real
 * form and verified from the real message, because the gate being tested --
 * friendship, conversations and predictions all refuse an unverified address --
 * is only worth testing if the thing that opens it is the thing members use.
 */

/** Where the API's log is. D-026 logs outbound mail; T-330 is the provider. */
const API_LOG = process.env.API_LOG ?? '';

/**
 * The verification link out of the API's mail log.
 *
 * `lastIndexOf`, not `indexOf`: a log is append-only and a run may register the
 * same address twice, in which case the newest link is the live one and the
 * first is already spent.
 */
export function verifyLink(email: string): string {
  const log = readFileSync(API_LOG, 'utf8');
  const from = log.lastIndexOf(`[mail] to=${email}`);
  expect(from, `a verification mail for ${email}`).toBeGreaterThanOrEqual(0);
  const match = /https?:\/\/\S+\/verify-email\?token=\S+/.exec(log.slice(from));
  expect(match, 'the verification link in the mail').not.toBeNull();
  return match![0];
}

export interface Member {
  username: string;
  displayName: string;
  email: string;
  password: string;
}

/** A throwaway fixture credential, the same one the single-member journey uses. */
const PASSWORD = 'correct horse battery staple';

/**
 * A member for this run.
 *
 * The run id is in the username because the database is not emptied between
 * runs: two runs a minute apart must not collide, and a run must never find
 * the previous run's friendship already in place and pass because of it.
 */
export function member(run: string, slug: string, displayName: string): Member {
  const username = `e2e_${slug}_${run}`;
  return { username, displayName, email: `${username}@example.test`, password: PASSWORD };
}

/** Register through the form, then verify from the message. */
export async function registerAndVerify(page: Page, who: Member): Promise<void> {
  await page.goto('/en/register');
  const form = page.getByTestId('register-form');
  await form.getByLabel('Username').fill(who.username);
  await form.getByLabel('Display name').fill(who.displayName);
  await form.getByLabel('E-mail').fill(who.email);
  await form.getByLabel('Password').fill(who.password);
  await form.getByLabel('Country or territory').selectOption({ label: 'England' });
  await form.getByLabel('I accept the platform rules.').check();
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(new RegExp(`/en/u/${who.username}$`));

  await page.goto(verifyLink(who.email));
  await expect(page.getByTestId('verify-result')).toBeVisible();
}
