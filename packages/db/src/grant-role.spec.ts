import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import { ROLES, parseArgs } from '../scripts/grant-role.mjs';

/**
 * The refusals in `scripts/grant-role.mjs` (T-076).
 *
 * The SQL underneath is three statements and the database enforces the same
 * two rules again (`user_role_role_check`, `user_role_reason_not_blank`). What
 * is worth holding here is the layer above them: an operator typing this
 * against production at an awkward hour should be told which flag was wrong,
 * not handed a constraint violation.
 */
describe('grant-role arguments', () => {
  it('offers exactly the roles the schema allows', () => {
    expect(ROLES).toEqual(['admin', 'founder', 'moderator', 'editor']);
  });

  it('reads a grant, a revoke and a listing', () => {
    expect(parseArgs(['--email', 'a@b.test', '--role', 'admin', '--reason', 'first'])).toEqual({
      command: 'grant',
      email: 'a@b.test',
      role: 'admin',
      reason: 'first',
      by: undefined,
    });
    expect(
      parseArgs(['--email', 'a@b.test', '--role', 'editor', '--revoke', '--reason', 'left']),
    ).toMatchObject({ command: 'revoke', role: 'editor' });
    expect(parseArgs(['--list'])).toEqual({ command: 'list' });
  });

  it('keeps the granter when one is named', () => {
    const parsed = parseArgs([
      '--email',
      'a@b.test',
      '--role',
      'moderator',
      '--reason',
      'handles reports',
      '--by',
      'boss@b.test',
    ]);

    expect(parsed).toMatchObject({ command: 'grant', by: 'boss@b.test' });
  });

  it('refuses a role the schema would refuse, and says which ones it takes', () => {
    const parsed = parseArgs(['--email', 'a@b.test', '--role', 'superuser', '--reason', 'why']);

    expect(parsed.error).toContain('admin, founder, moderator, editor');
    expect(parsed.error).toContain('superuser');
    expect(parsed.command).toBeUndefined();
  });

  it('refuses a reason that is blank or only spaces', () => {
    for (const reason of ['', '   ']) {
      const parsed = parseArgs(['--email', 'a@b.test', '--role', 'admin', '--reason', reason]);
      expect(parsed.error).toContain('--reason is required');
    }
  });

  it('refuses a missing e-mail, a missing role and a flag with no value', () => {
    expect(parseArgs(['--role', 'admin', '--reason', 'why']).error).toContain(
      '--email is required',
    );
    expect(parseArgs(['--email', 'a@b.test', '--reason', 'why']).error).toContain(
      '--role is required',
    );
    // `--reason --by x` would otherwise record the word "--by" as the reason.
    expect(parseArgs(['--email', 'a@b.test', '--role', 'admin', '--reason']).error).toContain(
      '--reason needs a value',
    );
  });

  it('refuses what it does not understand rather than ignoring it', () => {
    expect(parseArgs(['--force']).error).toContain('Unknown option: --force');
    expect(parseArgs(['admin']).error).toContain('Unexpected argument: admin');
    // A listing that also carried an e-mail would read as though it filtered.
    expect(parseArgs(['--list', '--email', 'a@b.test']).error).toContain('takes no other options');
  });
});
