import { describe, expect, it } from 'vitest';
import {
  guestPickHref,
  guestSignInHref,
  markedOutcome,
  pickControlState,
  pickReturnPath,
  readPick,
} from './pick';

const ID = '00000000-0000-4000-8000-000000001738';

describe('the guest link contract (D-359)', () => {
  it('returns to the match page with the outcome in the address, at the control', () => {
    expect(pickReturnPath('en', ID, 'away')).toBe(`/en/match/${ID}?pick=away#pick`);
    expect(pickReturnPath('fa', ID, 'draw')).toBe(`/fa/match/${ID}?pick=draw#pick`);
  });

  it('leads a guest to register with that path URL-encoded in next', () => {
    const href = guestPickHref('en', ID, 'home');
    expect(href).toBe(`/en/register?next=%2Fen%2Fmatch%2F${ID}%3Fpick%3Dhome%23pick`);
    // One parameter, and it decodes to the path exactly: the query and the
    // fragment of the way back never leak into the register page's own.
    const url = new URL(href, 'https://example.test');
    expect([...url.searchParams.keys()]).toEqual(['next']);
    expect(url.hash).toBe('');
    expect(url.searchParams.get('next')).toBe(pickReturnPath('en', ID, 'home'));
  });

  it('gives sign-in the same next', () => {
    const register = new URL(guestPickHref('fa', ID, 'away'), 'https://example.test');
    const signIn = new URL(guestSignInHref('fa', ID, 'away'), 'https://example.test');
    expect(signIn.pathname).toBe('/fa/login');
    expect(signIn.searchParams.get('next')).toBe(register.searchParams.get('next'));
  });

  it('keeps an id that is not a plain UUID inside its path segment', () => {
    const next = new URL(
      guestPickHref('en', 'a/b?c#d', 'home'),
      'https://example.test',
    ).searchParams.get('next');
    expect(next).toBe('/en/match/a%2Fb%3Fc%23d?pick=home#pick');
  });
});

describe('readPick', () => {
  it('takes the three outcomes and nothing else', () => {
    expect(readPick('home')).toBe('home');
    expect(readPick('draw')).toBe('draw');
    expect(readPick('away')).toBe('away');
    for (const value of ['', 'Home', '1', 'x', ID, undefined, null, ['home'], ['home', 'away']]) {
      expect(readPick(value)).toBeNull();
    }
  });
});

describe('the control’s four states', () => {
  it('is open with nothing chosen, chosen with an address-borne outcome', () => {
    expect(pickControlState({ locked: false, saved: null, chosen: null })).toBe('open');
    expect(pickControlState({ locked: false, saved: null, chosen: 'away' })).toBe('chosen');
  });

  it('is saved once a pick is stored, whatever the address says', () => {
    expect(pickControlState({ locked: false, saved: 'home', chosen: 'away' })).toBe('saved');
    expect(markedOutcome({ locked: false, saved: 'home', chosen: 'away' })).toBe('home');
  });

  it('is locked after kick-off, and then only a stored pick is marked', () => {
    expect(pickControlState({ locked: true, saved: null, chosen: 'away' })).toBe('locked');
    expect(pickControlState({ locked: true, saved: 'draw', chosen: null })).toBe('locked');
    expect(markedOutcome({ locked: true, saved: null, chosen: 'away' })).toBeNull();
    expect(markedOutcome({ locked: true, saved: 'draw', chosen: 'away' })).toBe('draw');
  });

  it('marks the address-borne outcome while the match is open', () => {
    expect(markedOutcome({ locked: false, saved: null, chosen: 'away' })).toBe('away');
    expect(markedOutcome({ locked: false, saved: null, chosen: null })).toBeNull();
  });
});
