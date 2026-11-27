import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_APPEAL, type OwnSanction } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/report-actions', () => ({
  reportMemberAction: async () => null,
  appealSanctionAction: async () => null,
}));

const { AccountRestrictions } = await import('./account-restrictions');

/**
 * Settings -> "Restrictions on your account" (T-1973): what was restricted,
 * why and until when, and the appeal -- once.
 */

const SANCTION: OwnSanction = {
  id: '00000000-0000-4000-8000-00000000a1a1',
  username: 'ali',
  scope: 'messaging',
  scope_id: null,
  starts_at: '2026-11-25T12:00:00.000Z',
  ends_at: '2026-12-02T12:00:00.000Z',
  permanent: false,
  active: true,
  lifted_at: null,
  lifted_by: null,
  lift_reason: null,
  decision_id: '00000000-0000-4000-8000-00000000d1d1',
  reason: 'Repeated advertising links in three conversations.',
  appealed_at: null,
};

const render = (sanctions: OwnSanction[] | null, locale = 'en') =>
  renderToStaticMarkup(
    <AccountRestrictions locale={locale} sanctions={sanctions} timeZone="Europe/London" />,
  );

describe('the section', () => {
  it('says in one line that nothing is restricted, rather than an empty list', () => {
    const html = render([]);
    expect(html).toContain('Restrictions on your account');
    expect(html).toContain('data-testid="restrictions-none"');
    expect(html).toContain('Nothing on your account is restricted.');
    expect(html).not.toContain('data-testid="restrictions-list"');
  });

  it('says it could not load them, never that there are none, when the API did not answer', () => {
    const html = render(null);
    expect(html).toContain('data-testid="restrictions-unreachable"');
    expect(html).not.toContain('Nothing on your account is restricted.');
  });

  it('shows what was restricted, why, and until when', () => {
    const html = render([SANCTION]);
    expect(html).toContain('Sending messages');
    expect(html).toMatch(/data-testid="restriction-state"[^>]*>In force</);
    expect(html).toContain('Repeated advertising links in three conversations.');
    expect(html).toMatch(/<time dateTime="2026-12-02T12:00:00.000Z">2 Dec 2026, 12:00<\/time>/);

    const permanent = render([{ ...SANCTION, permanent: true, ends_at: null, scope: 'contact' }]);
    expect(permanent).toContain('Sending friend requests');
    expect(permanent).toMatch(/data-testid="restriction-until"[^>]*>(<span[^>]*>)?Permanent/);
  });

  it('says when one is no longer in force or was lifted, and why it was lifted', () => {
    // The server's `active` decides, never the page's clock; the end is beside it.
    const ended = render([{ ...SANCTION, active: false, ends_at: '2026-11-26T12:00:00.000Z' }]);
    expect(ended).toMatch(/data-testid="restriction-state"[^>]*>Not in force</);
    expect(ended).toContain('26 Nov 2026, 12:00');
    // Not yet appealed and not lifted: the appeal is still theirs to write.
    expect(ended).toContain('restriction-appeal-form');

    const lifted = render([
      {
        ...SANCTION,
        active: false,
        lifted_at: '2026-11-26T09:30:00.000Z',
        lifted_by: 'moderator',
        lift_reason: 'Appeal upheld: the links were match streams the group asked for.',
      },
    ]);
    expect(lifted).toContain('Lifted on 26 Nov 2026, 09:30');
    expect(lifted).toContain('Appeal upheld');
    // Who lifted it is the platform's, not a person to blame (policy section 2).
    expect(lifted).not.toContain('moderator<');
    // Undone already: nothing to appeal.
    expect(lifted).not.toContain('restriction-appeal-form');
  });
});

describe('the appeal', () => {
  it('is a form while the restriction has not been appealed', () => {
    const html = render([SANCTION]);
    expect(html).toContain('data-testid="restriction-appeal-form"');
    expect(html).toMatch(
      new RegExp(`<textarea[^>]*name="body"[^>]*maxlength="${MAX_APPEAL}"[^>]*required`, 'i'),
    );
    expect(html).toContain('One appeal per restriction, up to 4,000 characters.');
    expect(html).toMatch(/data-testid="restriction-appeal-submit"[^>]*>(<span[^>]*>)?Appeal</);
  });

  it('is once: appealed, it says when and offers no second form', () => {
    const html = render([{ ...SANCTION, appealed_at: '2026-11-26T08:15:00.000Z' }]);
    expect(html).toContain('data-testid="restriction-appealed"');
    expect(html).toContain('Appeal sent on 26 Nov 2026, 08:15.');
    expect(html).not.toContain('restriction-appeal-form');
    expect(html).not.toContain('<textarea');
  });

  it('keeps each restriction’s appeal to itself', () => {
    const html = render([
      { ...SANCTION, appealed_at: '2026-11-26T08:15:00.000Z' },
      { ...SANCTION, id: '00000000-0000-4000-8000-00000000b2b2', scope: 'contact' },
    ]);
    expect(html.match(/data-testid="restriction"/g)).toHaveLength(2);
    expect(html.match(/data-testid="restriction-appeal-form"/g)).toHaveLength(1);
    expect(html.match(/data-testid="restriction-appealed"/g)).toHaveLength(1);
  });

  it('is written in Persian for a Persian reader', () => {
    const html = render([SANCTION], 'fa');
    expect(html).toContain('محدودیت‌های حساب');
    expect(html).toContain('فرستادن پیام');
    expect(html).toContain('درخواست تجدیدنظر');
    expect(html).not.toContain('lang="en"');
    expect(render([], 'fa')).toContain('هیچ محدودیتی روی حساب شما نیست.');
  });
});

describe('Settings', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', 'app', '[locale]', 'settings', 'page.tsx'),
    'utf8',
  );

  it('draws the section for a signed-in member only, after the guest has been answered', () => {
    const guest = PAGE.indexOf('data-testid="settings-guest"');
    const member = PAGE.indexOf('const { profile, account, privacy, viewing_territory }');
    const section = PAGE.indexOf('<AccountRestrictions');
    expect(guest).toBeGreaterThan(-1);
    expect(member).toBeGreaterThan(guest);
    expect(section).toBeGreaterThan(member);
    expect(PAGE).toMatch(/sanctions=\{standing\.ok \? standing\.data\.sanctions : null\}/);
  });
});
