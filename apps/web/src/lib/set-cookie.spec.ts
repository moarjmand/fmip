import { describe, expect, it } from 'vitest';
import { parseSessionSetCookie } from './set-cookie';

describe('parseSessionSetCookie', () => {
  it('reads the value and lifetime the API set', () => {
    expect(
      parseSessionSetCookie(
        'fmip_session=abc%20def; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600',
      ),
    ).toEqual({ value: 'abc def', maxAge: 1209600 });
  });

  it('reads a clearing cookie as lifetime zero', () => {
    expect(
      parseSessionSetCookie('fmip_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'),
    ).toEqual({
      value: '',
      maxAge: 0,
    });
  });

  it('ignores other cookies and a missing header', () => {
    expect(parseSessionSetCookie('other=1; Path=/')).toBeNull();
    expect(parseSessionSetCookie(null)).toBeNull();
  });
});
