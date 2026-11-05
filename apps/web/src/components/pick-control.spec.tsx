import type { AuthUser, Prediction } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { guestPickHref, guestSignInHref } from '@/lib/pick';

vi.mock('@/lib/prediction-actions', () => ({ submitPredictionAction: async () => null }));

const { PickControl } = await import('./pick-control');

/**
 * The pick control's four states (T-1738, D-359): nothing chosen, chosen by a
 * guest, saved for a member, locked after kick-off -- each as markup a server
 * renders, with the chosen outcome exposed to assistive technology and not by
 * colour alone, the guest's outcomes as plain links of the contract, and the
 * member's as submit buttons of the existing action.
 */

const FIXTURE = '00000000-0000-4000-8000-000000001738';
const OPEN = {
  id: FIXTURE,
  kickoff_at: '2099-10-08T13:30:00Z',
  home: 'Tractor',
  away: 'Esteghlal',
};
const PAST = { ...OPEN, kickoff_at: '2020-01-01T00:00:00Z' };
const ME = { id: 'u1', email_verified: true } as AuthUser;

const stored = (over: Partial<Prediction['latest']> = {}, locked = false): Prediction =>
  ({
    id: 'p1',
    fixture_id: FIXTURE,
    locks_at: OPEN.kickoff_at,
    locked,
    latest: {
      id: 'pv1',
      version_number: 1,
      outcome: 'home',
      score: null,
      confidence: 3,
      reason_tags: [],
      explanation: null,
      submitted_at: '2026-10-08T10:00:00.000Z',
      ...over,
    },
    versions: [{}],
    settlement: null,
  }) as unknown as Prediction;

const control = (props: Partial<Parameters<typeof PickControl>[0]> = {}) =>
  renderToStaticMarkup(
    <PickControl
      locale="en"
      fixture={OPEN}
      timeZone="UTC"
      zone="UTC"
      me={null}
      current={null}
      split={<span data-testid="split">split</span>}
      model={<span data-testid="model">model</span>}
      {...props}
    />,
  );

/** The markup of one outcome's column. */
const column = (html: string, outcome: 'home' | 'draw' | 'away'): string => {
  const start = html.indexOf(`data-option="${outcome}"`);
  expect(start, outcome).toBeGreaterThan(-1);
  const next = html.indexOf('data-option="', start + 1);
  return html.slice(start, next === -1 ? html.indexOf('</div></div>', start) : next);
};
const count = (html: string, needle: string): number => html.split(needle).length - 1;
/** `&` as the attribute carries it. */
const attr = (href: string): string => href.replace(/&/g, '&amp;');

describe('PickControl: nothing chosen', () => {
  it('shows a guest the three outcomes at once, each a link of the contract', () => {
    const html = control();
    expect(html).toContain('data-pick="open"');
    for (const outcome of ['home', 'draw', 'away'] as const) {
      expect(column(html, outcome)).toContain(
        `href="${attr(guestPickHref('en', FIXTURE, outcome))}"`,
      );
    }
    // In the order home, draw, away, under their captions.
    expect(html.indexOf('data-option="home"')).toBeLessThan(html.indexOf('data-option="draw"'));
    expect(html.indexOf('data-option="draw"')).toBeLessThan(html.indexOf('data-option="away"'));
    expect(html).toMatch(/aria-hidden="true"[^>]*>Home win</);
    // Nothing is chosen: no saffron, nothing current, no account prompt yet.
    expect(html).not.toContain('bg-brand');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('data-testid="pick-account"');
    expect(html).toContain('No account is needed to choose; an account is needed to save it.');
    expect(html).toContain('Locks <time dateTime="2099-10-08T13:30:00Z">13:30</time> UTC');
    // No form and no button for a guest: nothing of theirs can be stored.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('names each outcome for a screen reader, the visible name inside it', () => {
    const html = control();
    expect(column(html, 'home')).toContain('aria-label="Tractor win"');
    expect(column(html, 'away')).toContain('aria-label="Esteghlal win"');
    // "Draw" is its own name.
    expect(column(html, 'draw')).not.toContain('aria-label');
    expect(html).toContain('role="group" aria-label="Your pick: Tractor v Esteghlal"');
  });

  it('gives a member three submit buttons of the one form, none pressed', () => {
    const html = control({ me: ME });
    expect(html).toContain('data-pick="open"');
    expect(html).toContain('data-testid="pick-form"');
    for (const outcome of ['home', 'draw', 'away'] as const) {
      const button = column(html, outcome);
      expect(button).toContain(`<button type="submit" value="${outcome}" aria-pressed="false"`);
      expect(button).toContain('name="outcome"');
    }
    // The API asks for a confidence; the first tap sends the middle one.
    expect(html).toContain('<input type="hidden" name="confidence" value="3"/>');
    expect(html).not.toContain('/register');
    expect(html).not.toContain('data-testid="pick-detail"');
    expect(html).toContain('Tap an outcome to save your pick.');
  });

  it('every outcome is a 44px target', () => {
    for (const html of [control(), control({ me: ME }), control({ fixture: PAST })]) {
      expect(count(html, 'min-h-touch w-full')).toBe(3);
    }
  });
});

describe('PickControl: chosen by a guest', () => {
  const html = control({ chosen: 'away' });

  it('marks the one outcome with the fill, a tick and aria-current', () => {
    expect(html).toContain('data-pick="chosen"');
    const away = column(html, 'away');
    expect(away).toContain('aria-current="true"');
    expect(away).toContain('bg-brand');
    expect(away).toContain('<svg');
    expect(count(html, 'aria-current="true"')).toBe(1);
    for (const other of ['home', 'draw'] as const) {
      expect(column(html, other)).not.toContain('bg-brand');
      expect(column(html, other)).not.toContain('<svg');
    }
  });

  it('says in one line that it is not saved, and offers the account with the same way back', () => {
    expect(html).toContain(
      'Your pick: <bdi>Esteghlal</bdi> win. Not saved yet. Create a free account to lock it before',
    );
    expect(html).toContain(
      `data-testid="pick-create" href="${attr(guestPickHref('en', FIXTURE, 'away'))}"`,
    );
    expect(html).toContain(
      `data-testid="pick-sign-in" href="${attr(guestSignInHref('en', FIXTURE, 'away'))}"`,
    );
    // Remembered in the address, never stored: still no form.
    expect(html).not.toContain('<form');
    // And nobody's split before a pick is stored (D-206).
    expect(html).not.toContain('data-testid="split"');
  });

  it('lets the other outcomes be chosen instead', () => {
    expect(column(html, 'home')).toContain(`href="${attr(guestPickHref('en', FIXTURE, 'home'))}"`);
  });

  it('tells a member who chose before signing in to tap it, with no account prompt', () => {
    const carried = control({ me: ME, chosen: 'draw' });
    expect(carried).toContain('data-pick="chosen"');
    expect(column(carried, 'draw')).toContain('aria-pressed="true"');
    expect(carried).toContain('Not saved yet. Tap it to save it before');
    expect(carried).not.toContain('data-testid="pick-account"');
    expect(carried).not.toContain('data-testid="pick-saved"');
  });
});

describe('PickControl: saved for a member', () => {
  const html = control({ me: ME, current: stored() });

  it('presses the stored outcome and says it is saved and until when it can change', () => {
    expect(html).toContain('data-pick="saved"');
    expect(column(html, 'home')).toContain('aria-pressed="true"');
    expect(column(html, 'home')).toContain('bg-brand');
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toMatch(/data-testid="pick-saved">.*Saved</);
    expect(html).toContain('You can change it until <time dateTime="2099-10-08T13:30:00Z">13:30');
    expect(html).toContain('Version 1, submitted');
  });

  it('wins over an outcome in the address', () => {
    const both = control({ me: ME, current: stored(), chosen: 'away' });
    expect(both).toContain('data-pick="saved"');
    expect(column(both, 'away')).toContain('aria-pressed="false"');
  });

  it('shows the community split only now (D-206)', () => {
    expect(html).toContain('data-testid="split"');
    expect(control({ me: ME })).not.toContain('data-testid="split"');
    expect(control({ me: ME, chosen: 'home' })).not.toContain('data-testid="split"');
  });

  it('keeps score, confidence, reasons and the note reachable behind "Add detail"', () => {
    expect(html).toContain('<details');
    expect(html).toContain('Add detail');
    const detail = html.slice(html.indexOf('data-testid="pick-detail-form"'));
    // A form of its own that carries the stored outcome.
    expect(detail).toContain('<input type="hidden" name="outcome" value="home"/>');
    for (const name of ['score_home', 'score_away', 'confidence', 'reason_tags', 'explanation']) {
      expect(detail).toContain(`name="${name}"`);
    }
    expect(detail).toContain('Update prediction');
  });

  it('carries what the stored version says along with a changed outcome', () => {
    const detailed = control({
      me: ME,
      current: stored({
        outcome: 'home',
        score: { home: 2, away: 1 },
        confidence: 4,
        reason_tags: ['form', 'tactics'],
        explanation: 'Azadi.',
      }),
    });
    const quick = detailed.slice(
      detailed.indexOf('data-testid="pick-form"'),
      detailed.indexOf('data-testid="pick-saved"'),
    );
    expect(quick).toContain('<input type="hidden" name="confidence" value="4"/>');
    // The score with the outcome it was given for; `formToSubmission` drops it for another.
    expect(quick).toContain('<input type="hidden" name="score_for" value="home"/>');
    expect(quick).toContain('<input type="hidden" name="score_home" value="2"/>');
    expect(quick).toContain('<input type="hidden" name="score_away" value="1"/>');
    expect(count(quick, 'name="reason_tags"')).toBe(2);
    expect(quick).toContain('<input type="hidden" name="explanation" value="Azadi."/>');
    // And says it in words under the buttons.
    expect(detailed).toMatch(/data-testid="prediction-score">2–1</);
    expect(detailed).toContain('Form, Tactics');
    expect(detailed).toContain('Azadi.');
  });

  it('tells an unverified member to verify, the API being the one that refuses', () => {
    const unverified = control({ me: { ...ME, email_verified: false } as AuthUser });
    expect(unverified).toContain('Verify your email address before predicting');
    expect(control({ me: ME })).not.toContain('Verify your email address');
  });
});

describe('PickControl: locked after kick-off', () => {
  it('makes the three inert and locks the stored one', () => {
    const html = control({ fixture: PAST, me: ME, current: stored({ outcome: 'away' }, true) });
    expect(html).toContain('data-pick="locked"');
    expect(count(html, '<button type="button" disabled=""')).toBe(3);
    const away = column(html, 'away');
    expect(away).toContain('aria-pressed="true"');
    expect(away).toContain('border-accent');
    expect(away).toContain('<svg');
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toContain('Locked at kick-off');
    expect(html).toContain('Picks lock at kick-off. Your pick: <bdi>Esteghlal</bdi> win.');
    expect(html).toContain('Final version 1 of 1');
    // Nothing can be sent, by a member or towards an account.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('/register');
    expect(html).not.toContain('<details');
    // Kick-off locks every pick, so the split is anyone's (D-206).
    expect(html).toContain('data-testid="split"');
  });

  it('follows the stored lock even when the clock here says otherwise', () => {
    expect(control({ me: ME, current: stored({}, true) })).toContain('data-pick="locked"');
  });

  it('tells a member who did not pick, and never a guest, that they did not', () => {
    const member = control({ fixture: PAST, me: ME });
    expect(member).toContain('You did not predict this match before kick-off.');
    expect(member).not.toContain('aria-pressed="true"');
    const guest = control({ fixture: PAST });
    expect(guest).not.toContain('You did not predict');
    expect(guest).toContain('Picks lock at kick-off.');
    expect(guest).not.toContain('/register');
  });

  it('does not let an address claim a pick the API never took', () => {
    const html = control({ fixture: PAST, chosen: 'home' });
    expect(html).toContain('data-pick="locked"');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('bg-brand');
    expect(html).toContain('data-testid="pick-note">Picks lock at kick-off.</p>');
  });
});

describe('PickControl: beside the model, in any language', () => {
  it('draws the model’s box after everything of its own', () => {
    const html = control({ me: ME, current: stored() });
    expect(html.indexOf('data-testid="model"')).toBeGreaterThan(
      html.indexOf('data-testid="split"'),
    );
    expect(html.indexOf('data-testid="model"')).toBeGreaterThan(
      html.indexOf('data-testid="pick-detail"'),
    );
  });

  it('speaks Persian in Persian digits, with the same links', () => {
    const html = control({ locale: 'fa', chosen: 'away', zone: 'به وقت تهران' });
    expect(html).toContain('پیش‌بینی شما');
    expect(html).toContain('۱۳:۳۰');
    expect(html).toContain('هنوز ذخیره نشده است');
    expect(html).toContain('ساخت حساب');
    expect(column(html, 'away')).toContain(`href="${attr(guestPickHref('fa', FIXTURE, 'away'))}"`);
    expect(column(html, 'away')).toContain('aria-label="برد Esteghlal"');
    expect(html).not.toContain('data-translation="untranslated"');
  });
});
