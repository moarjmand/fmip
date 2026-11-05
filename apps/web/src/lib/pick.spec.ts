import { describe, expect, it } from 'vitest';
import {
  guestPickHref,
  guestSignInHref,
  markedOutcome,
  pickCardPath,
  pickControlState,
  pickOpen,
  pickReturnPath,
  readPick,
} from './pick';

const ID = '00000000-0000-4000-8000-000000001738';

describe('the way to the pick card from another card (T-1741, D-362)', () => {
  const KICKOFF = '2026-11-07T15:00:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('is the match page at its pick card, with no outcome chosen', () => {
    expect(pickCardPath('en', ID)).toBe(`/en/match/${ID}#pick`);
    expect(pickCardPath('fa', ID)).toBe(`/fa/match/${ID}#pick`);
    expect(pickCardPath('en', ID)).not.toContain('?');
  });

  it('is offered only while the match has not kicked off', () => {
    const scheduled = { status: 'scheduled', kickoff_at: KICKOFF };
    expect(pickOpen(scheduled, at('2026-11-07T14:59:59.000Z'))).toBe(true);
    // At kick-off and after it, whatever the status still says.
    expect(pickOpen(scheduled, at(KICKOFF))).toBe(false);
    expect(pickOpen(scheduled, at('2026-11-07T15:30:00.000Z'))).toBe(false);
    // A match under way, over or off is never open, whatever the clock says.
    for (const status of ['live', 'suspended', 'finished', 'postponed', 'cancelled']) {
      expect(pickOpen({ status, kickoff_at: KICKOFF }, at('2026-11-01T00:00:00.000Z'))).toBe(false);
    }
    // Without the render's moment the status alone decides.
    expect(pickOpen(scheduled)).toBe(true);
    expect(pickOpen({ status: 'live', kickoff_at: KICKOFF })).toBe(false);
  });
});

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
