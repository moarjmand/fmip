import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_APPEAL, type OwnDecision, type OwnSanction } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/report-actions', () => ({
  reportMemberAction: async () => null,
  appealSanctionAction: async () => null,
  appealDecisionAction: async () => null,
}));

const { AccountRestrictions } = await import('./account-restrictions');

/**
 * Settings -> "Moderation decisions on your account" (T-1973): every decision
 * against the member -- a restriction, a warning, a content removal -- with
 * what, why and when, and the appeal, once each.
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
  lift_reason: null,
  decision_id: '00000000-0000-4000-8000-00000000d1d1',
  reason: 'Repeated advertising links in three conversations.',
  appealed_at: null,
};

const WARNING: OwnDecision = {
  id: '00000000-0000-4000-8000-00000000e1e1',
  outcome: 'warned',
  reason: 'Insults in a group chat.',
  created_at: '2026-11-20T10:00:00.000Z',
  appealed_at: null,
};

const render = (sanctions: OwnSanction[] | null, locale = 'en', decisions: OwnDecision[] = []) =>
  renderToStaticMarkup(
    <AccountRestrictions
      locale={locale}
      standing={sanctions === null ? null : { sanctions, decisions }}
      timeZone="Europe/London"
    />,
  );

describe('the section', () => {
  it('says in one line that nothing has been decided against them, rather than an empty list', () => {
    const html = render([]);
    expect(html).toContain('Moderation decisions on your account');
    expect(html).toContain('data-testid="restrictions-none"');
    expect(html).toContain(
      'No moderator has restricted your account, warned you or removed your content.',
    );
    expect(html).not.toContain('data-testid="restrictions-list"');
  });

  it('says it could not load them, never that there are none, when the API did not answer', () => {
    const html = render(null);
    expect(html).toContain('data-testid="restrictions-unreachable"');
    expect(html).not.toContain('No moderator has restricted');
  });

  it('shows what was restricted, why, and until when', () => {
    const html = render([SANCTION]);
    expect(html).toContain('Sending messages');
    expect(html).toMatch(/data-testid="restriction-state"[^>]*>In force</);
    expect(html).toContain('Repeated advertising links in three conversations.');
    // A moderator's words keep their own direction: a Persian reason in /en
    // is laid out right to left, and what the member types too.
    expect(html).toMatch(/<dd dir="auto"[^>]*data-testid="restriction-reason"/);
    expect(html).toMatch(/<textarea[^>]*dir="auto"/);
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
        lift_reason: 'Appeal upheld: the links were match streams the group asked for.',
      },
    ]);
    expect(lifted).toContain('Lifted on 26 Nov 2026, 09:30');
    expect(lifted).toContain('Appeal upheld');
    // Undone already: nothing to appeal.
    expect(lifted).not.toContain('restriction-appeal-form');
  });

  it('names the schema’s other scopes, and never shows a raw key or breaks on an unknown one', () => {
    const html = render(
      (['groups', 'post', 'something_new'] as const).map((scope, i) => ({
        ...SANCTION,
        id: `00000000-0000-4000-8000-00000000c${i}c${i}`,
        scope: scope as OwnSanction['scope'],
      })),
    );
    expect(html).toContain('Making or joining groups');
    expect(html).toContain('Posting on match panels');
    expect(html).toContain('Another part of your account');
    expect(html).not.toContain('restrictions.scope');
    expect(html).not.toContain('something_new');
  });
});

describe('a warning or a content removal', () => {
  it('is shown with what, when and why, and is appealed once like a restriction', () => {
    const html = render([], 'en', [WARNING]);
    expect(html).not.toContain('data-testid="restrictions-none"');
    expect(html).toContain('data-testid="decision"');
    expect(html).toMatch(/<h3[^>]*>(<span[^>]*>)?Warning</);
    expect(html).toContain('On 20 Nov 2026, 10:00');
    expect(html).toContain('Insults in a group chat.');
    expect(html).toContain('data-testid="decision-appeal-form"');

    const appealed = render([], 'en', [{ ...WARNING, appealed_at: '2026-11-21T08:00:00.000Z' }]);
    expect(appealed).toContain('Appeal sent on 21 Nov 2026, 08:00.');
    expect(appealed).not.toContain('decision-appeal-form');
  });

  it('for a removal, never repeats the removed words and says no item is recorded', () => {
    const html = render([], 'en', [
      { ...WARNING, id: '00000000-0000-4000-8000-00000000e2e2', outcome: 'content_removed' },
    ]);
    expect(html).toMatch(/<h3[^>]*>(<span[^>]*>)?Content removed</);
    expect(html).toContain('data-testid="decision-content-note"');
    expect(html).toContain('The decision does not record which item was removed');
  });

  it('sits beside the restrictions, each with its own form and its own field ids', () => {
    const html = render([SANCTION], 'en', [WARNING]);
    expect(html.match(/data-testid="restriction-appeal-form"/g)).toHaveLength(1);
    expect(html.match(/data-testid="decision-appeal-form"/g)).toHaveLength(1);
    const defined = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const labelled = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]);
    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(new Set(defined).size).toBe(defined.length);
    expect(labelled).toHaveLength(2);
    for (const target of labelled) expect(defined).toContain(target);
  });
});

describe('the appeal', () => {
  it('is a form while the restriction has not been appealed', () => {
    const html = render([SANCTION]);
    expect(html).toContain('data-testid="restriction-appeal-form"');
    expect(html).toMatch(
      new RegExp(`<textarea[^>]*name="body"[^>]*maxlength="${MAX_APPEAL}"[^>]*required`, 'i'),
    );
    expect(html).toContain('One appeal per decision, up to 4,000 characters.');
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
    const html = render([SANCTION], 'fa', [WARNING]);
    expect(html).toContain('تصمیم‌های نظارتی درباره‌ی حساب شما');
    expect(html).toContain('فرستادن پیام');
    expect(html).toContain('هشدار');
    expect(html).toContain('ارسال درخواست تجدیدنظر');
    expect(html).not.toContain('lang="en"');
    expect(render([], 'fa')).toContain(
      'هیچ ناظری حساب شما را محدود نکرده، به شما هشدار نداده یا محتوایتان را حذف نکرده است.',
    );
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
    expect(PAGE).toMatch(/standing=\{standing\.ok \? standing\.data : null\}/);
  });
});
