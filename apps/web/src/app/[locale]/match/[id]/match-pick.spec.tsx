import type { AuthUser, MatchHeader, Prediction } from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { guestPickHref, guestSignInHref, readPick } from '@/lib/pick';

vi.mock('@/lib/prediction-actions', () => ({
  submitPredictionAction: async () => null,
  savePendingPickAction: async () => null,
}));

const { MatchPickCard, PickBar } = await import('./match-pick');

/**
 * The pick on the match page (T-1739, D-360): which state the card shows for
 * a guest and a member, before and after kick-off; what `?pick=` marks; the
 * guest's words; and when the phone's bar is rendered and what it says.
 */

const FIXTURE = '00000000-0000-4000-8000-000000001739';
const OPEN = {
  id: FIXTURE,
  status: 'scheduled',
  kickoff_at: '2099-11-05T17:45:00Z',
  home: { name: 'Sparta Prague' },
  away: { name: 'Bournemouth' },
} as unknown as MatchHeader;
const PAST = { ...OPEN, status: 'finished', kickoff_at: '2020-01-01T00:00:00Z' } as MatchHeader;
const ME = { id: 'u1', email_verified: true } as AuthUser;

const stored = (outcome: 'home' | 'draw' | 'away' = 'away', locked = false): Prediction =>
  ({
    id: 'p1',
    fixture_id: FIXTURE,
    locks_at: OPEN.kickoff_at,
    locked,
    latest: {
      id: 'pv1',
      version_number: 1,
      outcome,
      score: null,
      confidence: 3,
      reason_tags: [],
      explanation: null,
      submitted_at: '2026-11-05T10:00:00.000Z',
    },
    versions: [{}],
    settlement: null,
  }) as unknown as Prediction;

const card = (props: Partial<Parameters<typeof MatchPickCard>[0]> = {}) =>
  renderToStaticMarkup(
    <MatchPickCard
      locale="en"
      fixture={OPEN}
      timeZone="Europe/London"
      me={null}
      current={null}
      chosen={null}
      split={<span data-testid="split">split</span>}
      {...props}
    />,
  );

const bar = (props: Partial<Parameters<typeof PickBar>[0]> = {}) =>
  renderToStaticMarkup(
    <PickBar locale="en" fixture={OPEN} timeZone="Europe/London" current={null} {...props} />,
  );

/** `&` as the attribute carries it. */
const attr = (href: string): string => href.replace(/&/g, '&amp;');
const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('the match page pick card: a guest', () => {
  it('before kick-off shows the three outcomes as links of the contract, in the zone', () => {
    const html = card();
    expect(html).toContain('data-testid="match-pick"');
    expect(html).toContain('data-pick="open"');
    for (const outcome of ['home', 'draw', 'away'] as const) {
      expect(html).toContain(`href="${attr(guestPickHref('en', FIXTURE, outcome))}"`);
    }
    expect(html).toContain('<h2');
    expect(html).toMatch(/Locks <time dateTime="2099-11-05T17:45:00Z">17:45<\/time> UK time/);
    // Nothing of a guest's can be stored from here.
    expect(html).not.toContain('<form');
  });

  it('says what saving takes in plain words, never "verified account"', () => {
    const html = card();
    expect(html).toContain('data-testid="match-pick-account"');
    // Saving takes the account; counting takes the confirmed address (D-361).
    expect(html).toContain(
      'Saving a pick needs a free account. It counts once you confirm your email address before kick-off, when picks lock.',
    );
    expect(html).not.toMatch(/verified account/i);
    // The pick stays the community product's (rule 6).
    expect(html).toContain('Your pick counts towards the community picks only');
  });

  it('marks the outcome `?pick=` carries and offers the account, both with the way back', () => {
    const html = card({ chosen: readPick('away') });
    expect(html).toContain('data-pick="chosen"');
    expect(html).toMatch(/aria-current="true"[^>]*aria-label="Bournemouth win"/);
    expect(html).toContain('Not saved yet');
    expect(html).toContain(
      `data-testid="pick-create" href="${attr(guestPickHref('en', FIXTURE, 'away'))}"`,
    );
    expect(html).toContain(
      `data-testid="pick-sign-in" href="${attr(guestSignInHref('en', FIXTURE, 'away'))}"`,
    );
    // Create account is the filled one, Sign in the outline.
    expect(html).toMatch(/class="[^"]*bg-brand[^"]*" data-testid="pick-create"/);
    expect(html).not.toMatch(/class="[^"]*bg-brand[^"]*" data-testid="pick-sign-in"/);
  });

  it('ignores a `?pick=` that is not an outcome', () => {
    for (const value of ['banana', '', undefined, ['home', 'away']]) {
      expect(card({ chosen: readPick(value) })).toContain('data-pick="open"');
    }
  });

  it('after kick-off is one locked row with nothing to pick, and no account sentence', () => {
    const html = card({ fixture: PAST, chosen: readPick('away') });
    // The row (T-1744, D-365): the name, that picks are locked, the lock and its words.
    expect(html).toContain('data-testid="match-pick"');
    expect(html).toContain('data-product-row=""');
    expect(html).toContain('data-state="locked"');
    expect(html).toContain('Your pick');
    expect(html).toContain('Picks lock at kick-off.');
    expect(html).toMatch(/data-testid="pick-lock"[^>]*><svg[\s\S]*?Locked at kick-off/);
    // No three inert buttons any more, and no control at all.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-testid="pick-control"');
    // An address cannot claim a pick the API never took.
    expect(html).not.toContain('Bournemouth');
    expect(html).not.toContain('data-testid="match-pick-account"');
    expect(html).not.toContain('href=');
    // The line about the community picks belongs to the open card.
    expect(html).not.toContain('data-testid="match-pick-separate"');
  });

  it('never hands a guest the split, before kick-off or in the locked row', () => {
    expect(card()).not.toContain('data-testid="split"');
    expect(card({ chosen: 'away' })).not.toContain('data-testid="split"');
    // From kick-off on the community picks say their split in their own place.
    expect(card({ fixture: { ...PAST, status: 'live' } as MatchHeader })).not.toContain(
      'data-testid="split"',
    );
  });
});

describe('the match page pick card: a member', () => {
  it('before kick-off with no pick gets three submit buttons, no account sentence', () => {
    const html = card({ me: ME });
    expect(html).toContain('data-pick="open"');
    expect(html.match(/<button type="submit"[^>]*name="outcome"/g)).toHaveLength(3);
    expect(html).not.toContain('data-testid="match-pick-account"');
    expect(html).not.toContain('data-testid="split"');
  });

  it('who chose before signing in sees it marked and is told to tap it', () => {
    const html = card({ me: ME, chosen: 'away' });
    expect(html).toContain('data-pick="chosen"');
    expect(html).toContain('Tap it to save it');
    expect(html).not.toContain('data-testid="pick-create"');
  });

  it('with a stored pick is saved; the stored pick wins over the address', () => {
    const html = card({ me: ME, current: stored('away'), chosen: 'home' });
    expect(html).toContain('data-pick="saved"');
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Bournemouth win"/);
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toContain('data-testid="pick-saved"');
    // The community's split opens once they have picked (D-206).
    expect(html).toContain('data-testid="split"');
  });

  it('after kick-off shows the locked pick, and "did not predict" without one', () => {
    const picked = card({
      me: ME,
      fixture: { ...PAST, status: 'live' } as MatchHeader,
      current: stored('away', true),
    });
    expect(picked).toContain('data-product-row=""');
    expect(picked).toContain('data-state="locked"');
    expect(picked).toContain('Picks lock at kick-off. Your pick: ');
    expect(picked).toMatch(/<b class="[^"]*"><bdi>Bournemouth<\/bdi> win<\/b>/);
    // What the stored pick said beyond its outcome stays under the sentence.
    expect(picked).toContain('data-testid="pick-stored"');
    expect(picked).toContain('data-testid="prediction-versions"');
    expect(picked).not.toContain('<form');
    expect(picked).not.toContain('<button');
    const none = card({ me: ME, fixture: PAST });
    expect(none).toContain('data-state="locked"');
    expect(none).toContain('You did not predict this match before kick-off.');
    expect(none).not.toContain('data-testid="pick-stored"');
  });

  it("is locked by the API's word even when the clock here disagrees", () => {
    const html = card({ me: ME, current: stored('home', true) });
    expect(html).toContain('data-state="locked"');
    expect(html).toContain('data-product-row=""');
  });

  it('from kick-off on leaves the split to the community picks, live and after full time', () => {
    for (const status of ['live', 'finished'] as const) {
      const html = card({
        me: ME,
        fixture: { ...PAST, status } as MatchHeader,
        current: stored('away', true),
      });
      expect(html).toContain('data-state="locked"');
      expect(html).not.toContain('data-testid="split"');
    }
  });

  it('the locked row is the pick alone: no colour or figure of another product (rule 6)', () => {
    const html = card({ me: ME, fixture: PAST, current: stored('away', true) });
    expect(html).not.toMatch(/(text|bg|border)-(model|founder|community)/);
    expect(html).not.toMatch(/\d%/);
  });

  it('who has not confirmed their email address is told what a tap does and when it counts', () => {
    const html = card({ me: { ...ME, email_verified: false } as AuthUser });
    expect(html).toContain('data-pick="open"');
    expect(html).toContain('A pick is saved when you tap it. It counts once you confirm');
    expect(html).not.toContain('Verify your email address before predicting');
  });
});

describe('the match page pick card: a pending pick (T-1740, D-361)', () => {
  const UNCONFIRMED = { ...ME, email_verified: false } as AuthUser;
  const waiting = { outcome: 'away', status: 'pending' } as const;
  const expired = { outcome: 'away', status: 'expired' } as const;

  it('shows the pick waiting, in the reader’s zone, without the community split', () => {
    const html = card({ me: UNCONFIRMED, pending: waiting, chosen: readPick('home') });
    expect(html).toContain('data-pick="pending"');
    expect(html).toMatch(
      /Saved\. It counts once you confirm your email before <time dateTime="2099-11-05T17:45:00Z">17:45<\/time>\./,
    );
    expect(html).not.toContain('data-testid="split"');
    expect(html).not.toContain('data-testid="match-pick-account"');
    // Still the community product's alone (rule 6).
    expect(html).toContain('Your pick counts towards the community picks only');
  });

  it('after kick-off says saved, not counted, and still not beside the split', () => {
    const html = card({ me: UNCONFIRMED, fixture: PAST, pending: expired });
    expect(html).toContain('data-product-row=""');
    expect(html).toContain('data-state="uncounted"');
    expect(html).toContain('Saved, not counted');
    expect(html).toContain('It was never counted, because your email address was not confirmed');
    expect(html).toContain('<bdi>Bournemouth</bdi> win');
    expect(html).not.toContain('data-testid="split"');
    expect(html).not.toContain('<form');
  });

  it('is the ordinary saved pick once the address was confirmed in time', () => {
    const html = card({
      me: ME,
      current: stored('away'),
      pending: { outcome: 'away', status: 'converted' },
    });
    expect(html).toContain('data-pick="saved"');
    expect(html).toContain('data-testid="split"');
  });

  it('the phone’s bar shows the waiting pick and says it is not counted yet', () => {
    const html = bar({ pending: waiting });
    expect(html).toContain('data-pick="pending"');
    expect(html).toMatch(/data-testid="pick-bar-outcome" data-outcome="away"/);
    expect(html).toContain('Counts once you confirm your email');
    expect(html).not.toContain('Make your pick');
    // Never plainly "Saved": that is a prediction's word.
    expect(html).not.toMatch(/>Saved</);
  });

  it('the bar puts a prediction before a pending pick, and is gone once one expired', () => {
    expect(bar({ current: stored('home'), pending: waiting })).toContain('data-pick="saved"');
    expect(bar({ pending: expired })).toBe('');
    expect(bar({ pending: { outcome: 'away', status: 'withdrawn' } })).toContain(
      'data-pick="open"',
    );
  });
});

describe('the match page pick card: Persian', () => {
  it('says the lock in the reader’s zone and the guest sentence in Persian', () => {
    const html = card({ locale: 'fa', timeZone: 'Asia/Tehran' });
    expect(html).toContain('پیش‌بینی شما');
    expect(html).toContain('۲۱:۱۵');
    expect(html).toContain('ذخیره‌ی پیش‌بینی به یک حساب رایگان نیاز دارد.');
    expect(html).toContain(`href="${attr(guestPickHref('fa', FIXTURE, 'home'))}"`);
  });
});

describe('the phone pick bar', () => {
  it('before kick-off is one link to the card: the call and the lock time', () => {
    const html = bar();
    expect(html).toContain('data-testid="pick-bar"');
    expect(html).toContain('data-pick="open"');
    expect(count(html, '<a ')).toBe(1);
    expect(html).toContain('href="#pick"');
    expect(html).toContain('Make your pick');
    expect(html).toMatch(/Locks <time dateTime="2099-11-05T17:45:00Z">17:45<\/time> UK time/);
    // A link and nothing else: no form, no button, no second set of guest links.
    expect(html).not.toMatch(/<form|<button|register|login/);
    // The call is an outline; saffron fill is the chosen outcome's alone.
    expect(html).not.toContain('bg-brand');
  });

  it('says the same to a member who has not picked', () => {
    expect(bar({ current: null })).toContain('Make your pick');
  });

  it("shows a member's saved pick, with a tick and not by colour alone", () => {
    const html = bar({ current: stored('away') });
    expect(html).toContain('data-pick="saved"');
    expect(html).toContain('Your pick');
    expect(html).toContain('Saved');
    expect(html).toMatch(/data-testid="pick-bar-outcome" data-outcome="away"/);
    expect(html).toMatch(/<bdi>Bournemouth<\/bdi> win/);
    expect(html).toMatch(/bg-brand[^"]*text-on-brand/);
    expect(html).toContain('<svg');
    expect(html).not.toContain('Make your pick');
    expect(bar({ current: stored('draw') })).toContain('Draw');
  });

  it('is not rendered once the match has kicked off', () => {
    expect(bar({ fixture: PAST })).toBe('');
    // Kick-off passed with the feed still saying scheduled.
    expect(bar({ fixture: { ...PAST, status: 'scheduled' } as MatchHeader })).toBe('');
    // Live, whatever the clock here says.
    expect(bar({ fixture: { ...OPEN, status: 'live' } as MatchHeader })).toBe('');
    // The API's lock on the stored pick.
    expect(bar({ current: stored('home', true) })).toBe('');
  });

  it('is not rendered for a match that is postponed or cancelled', () => {
    for (const status of ['postponed', 'cancelled']) {
      expect(bar({ fixture: { ...OPEN, status } as MatchHeader })).toBe('');
    }
  });

  it('sits above the tab bar, under it in the stack, inside the safe area, on phones only', () => {
    const html = bar();
    const classes = /class="([^"]*)"[^>]*data-testid="pick-bar"/.exec(html)?.[1] ?? '';
    expect(classes).toContain('fixed');
    expect(classes).toContain('inset-x-0');
    expect(classes).toContain('bottom-0');
    expect(classes).toContain('md:hidden');
    // The tab bar is z-40 (`shell-nav.tsx`); the bar's box runs behind it,
    // padded by its height and the inset, so it can never cover it.
    expect(classes).toContain('z-20');
    expect(classes).toContain('pb-[calc(3.8125rem+env(safe-area-inset-bottom))]');
    const nav = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'components', 'shell-nav.tsx'),
      'utf8',
    );
    expect(nav).toMatch(/data-testid="tab-bar"\s+className="fixed inset-x-0 bottom-0 z-40 /);
    // 60px with its edge, and a 44px or taller target.
    expect(html).toMatch(/class="[^"]*min-h-\[3\.6875rem\][^"]*" data-testid="pick-bar-link"/);
  });

  it('uses logical properties only (rule 7)', () => {
    for (const html of [bar(), bar({ current: stored('away') }), card(), card({ me: ME })]) {
      expect(html).not.toMatch(
        /class="[^"]*(?<![\w-])(left|right|ml|mr|pl|pr|text-left|text-right)-[^"]*"/,
      );
    }
  });

  it('is Persian on /fa, with the time in Persian digits', () => {
    const html = bar({ locale: 'fa', timeZone: 'Asia/Tehran', current: stored('away') });
    expect(html).toContain('پیش‌بینی شما');
    expect(html).toContain('۲۱:۱۵');
    expect(html).toMatch(/<bdi>Bournemouth<\/bdi>/);
  });
});

describe('the page gives the bar room and drops it after kick-off', () => {
  const css = readFileSync(join(__dirname, '..', '..', '..', 'globals.css'), 'utf8');

  it('pads the end of the page by the bar’s height on a phone', () => {
    expect(css).toMatch(
      /@media \(width < 48rem\) and \(height >= 28rem\) \{\s+body:has\(\[data-pick-bar\]\) \{\s+padding-block-end: 3\.75rem;/,
    );
  });

  it('hides it on a short viewport and once the live view is no longer scheduled', () => {
    expect(css).toMatch(/@media \(height < 28rem\) \{\s+\[data-pick-bar\] \{\s+display: none;/);
    expect(css).toMatch(
      /main:has\(\[data-match-root\]:not\(\[data-status='scheduled'\]\)\) \[data-pick-bar\] \{\s+display: none;/,
    );
  });
});
