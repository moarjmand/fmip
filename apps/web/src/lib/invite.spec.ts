import { describe, expect, it } from 'vitest';
import { afterRegistration, inviteUrl, readInviter } from './invite';

/** T-522: an invite link names the inviter and nothing else, and offers, never sends. */
describe('invite links', () => {
  it('is the registration page naming the member', () => {
    expect(inviteUrl('en', 'mosiop', 'https://fmip.example')).toBe(
      'https://fmip.example/en/register?invited_by=mosiop',
    );
  });

  it('reads an inviter only if it could be a username', () => {
    expect(readInviter(' MosIop ')).toBe('mosiop');
    expect(readInviter(['abc', 'def'])).toBe('abc');
    for (const bad of [undefined, '', 'ab', 'a'.repeat(21), 'bad name', '../admin']) {
      expect(readInviter(bad)).toBeNull();
    }
  });

  it('sends a new member to the inviter’s profile, and only to someone else’s', () => {
    expect(afterRegistration('en', 'newbie', 'mosiop')).toBe('/en/u/mosiop?invited=1');
    expect(afterRegistration('en', 'newbie', null)).toBe('/en/u/newbie');
    expect(afterRegistration('en', 'newbie', 'newbie')).toBe('/en/u/newbie');
  });
});
