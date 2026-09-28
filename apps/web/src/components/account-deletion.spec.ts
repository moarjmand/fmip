import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeletedMember } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';

/**
 * Delete my account on the page (T-812, D-094).
 *
 * The API spec proves what deletion does; what is lost most cheaply here is
 * the confirmation (a form that deletes on one click), the sentence after it,
 * and the name: a deleted member's message rendered as `@deleted_…`, or with a
 * follow button beside it. So these read the source, as `match-panel.spec.ts`
 * does, plus the one pure rule the components share.
 */
const HERE = __dirname;
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8');
const SETTINGS = read('..', 'app', '[locale]', 'settings', 'page.tsx');
const DONE = read('..', 'app', '[locale]', 'account-deleted', 'page.tsx');
const ACTIONS = read('..', 'lib', 'auth-actions.ts');
const CONVERSATION = read('conversation.tsx');
const PANEL = read('match-panel.tsx');

describe('the form', () => {
  it('asks for the password and the username typed again', () => {
    const section = SETTINGS.slice(SETTINGS.indexOf('function DeleteAccountSection'));
    expect(section).toContain("name: 'password'");
    expect(section).toContain("type: 'password'");
    expect(section).toContain("autoComplete: 'current-password'");
    expect(section).toContain("name: 'confirm'");
    expect(section).toContain('deleteAccountAction.bind(null, locale)');
    // Said before it happens: what goes, what stays, and that it is final.
    for (const key of ['removed', 'kept', 'username', 'final'])
      expect(section).toContain(`message="account.delete.${key}"`);
  });

  it('is rendered for a member only, inside the signed-in page', () => {
    const guestBranchEnds = SETTINGS.indexOf('const { profile, account, privacy');
    expect(SETTINGS.indexOf('<DeleteAccountSection')).toBeGreaterThan(guestBranchEnds);
  });

  it('posts to the API, clears the cookie and lands on the sentence that says it happened', () => {
    const action = ACTIONS.slice(ACTIONS.indexOf('export async function deleteAccountAction'));
    expect(action).toContain("'/auth/account/delete'");
    expect(action).toContain("method: 'POST'");
    expect(action).toContain('if (!result.ok) return failure(result);');
    expect(action).toContain("applyApiSetCookie(result.setCookie ?? 'fmip_session=; Max-Age=0')");
    expect(action).toContain('redirect(`/${locale}/account-deleted`)');
    expect(DONE).toContain('role="status"');
    expect(DONE).toContain('message="account.deleted.body"');
  });

  it('has every string in the catalogue', () => {
    for (const key of [
      'account.delete.heading',
      'account.delete.password',
      'account.delete.confirm',
      'account.delete.confirmHint',
      'account.delete.submit',
      'account.deleted.title',
      'account.deleted.body',
      'account.deletedMember',
    ])
      expect(EN, key).toHaveProperty([key]);
    expect(EN['account.delete.confirmHint']).toContain('{username}');
  });
});

describe('a deleted member', () => {
  it('is recognised by the tombstone username and nothing else', () => {
    expect(isDeletedMember('deleted_0123456789ab')).toBe(true);
    expect(isDeletedMember('deleted_fan')).toBe(false);
    expect(isDeletedMember('deleted_0123456789abc')).toBe(false);
    expect(isDeletedMember('ada')).toBe(false);
  });

  it('is named "a deleted member" in a conversation, never by the tombstone', () => {
    expect(CONVERSATION).toContain('isDeletedMember(message.author)');
    expect(CONVERSATION).toContain('message="account.deletedMember"');
  });

  it('keeps a panel post with no name, standing or follow control', () => {
    const standing = PANEL.slice(
      PANEL.indexOf('function Standing'),
      PANEL.indexOf('function Post'),
    );
    const early = standing.slice(0, standing.indexOf('TIER_LABEL'));
    expect(early).toContain('isDeletedMember(author.username)');
    expect(early).toContain('{deletedMemberLabel}');
    expect(PANEL).toContain('!isDeletedMember(post.author.username)');
  });
});
