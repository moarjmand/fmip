import { describe, expect, it } from 'vitest';
import {
  INVITE_LINK_DEFAULT_HOURS,
  INVITE_LINK_DEFAULT_USES,
  INVITE_LINK_MAX_HOURS,
  INVITE_LINK_MAX_USES,
} from '@fmip/contracts';
import { checkLinkRequest, hashToken, newToken } from './group-invite-links.service';
import { rulesCheck } from './groups.service';

/** Accepting a group's rules (T-1023): the three answers. */
describe('rules accepted on joining', () => {
  it('needs nothing when the group has none, and the current version when it has', () => {
    expect(rulesCheck(null, undefined)).toEqual({ ok: true, version: null });
    expect(rulesCheck(null, 4)).toEqual({ ok: true, version: null });
    expect(rulesCheck(3, 3)).toEqual({ ok: true, version: 3 });
    expect(rulesCheck(3, null)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/has rules/),
    });
    expect(rulesCheck(3, 2)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/changed/),
    });
  });
});

/** The pure half of invite links (T-1021, D-132). */
describe('invite links', () => {
  it('makes a 256-bit token and keeps only its SHA-256', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('defaults the expiry and the cap, and names every bad field', () => {
    expect(checkLinkRequest(undefined)).toEqual({
      ok: true,
      hours: INVITE_LINK_DEFAULT_HOURS,
      uses: INVITE_LINK_DEFAULT_USES,
    });
    expect(checkLinkRequest({ expires_in_hours: INVITE_LINK_MAX_HOURS, max_uses: 1 })).toEqual({
      ok: true,
      hours: INVITE_LINK_MAX_HOURS,
      uses: 1,
    });
    const bad = checkLinkRequest({
      expires_in_hours: INVITE_LINK_MAX_HOURS + 1,
      max_uses: INVITE_LINK_MAX_USES + 1,
    });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.ok ? {} : bad.fields).sort()).toEqual(['expires_in_hours', 'max_uses']);
    expect(checkLinkRequest({ expires_in_hours: 1.5 }).ok).toBe(false);
    expect(checkLinkRequest({ max_uses: 0 }).ok).toBe(false);
  });
});
