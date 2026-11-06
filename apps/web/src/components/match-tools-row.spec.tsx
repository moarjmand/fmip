import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FollowedEntity } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';

// The server actions need a request; the follow control only binds them.
vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const { MatchFollow } = await import('./match-follow');
const { MatchToolsRow } = await import('./match-tools-row');

/**
 * The match page's tools row (T-1743, D-364; board P2-4): back, the zone,
 * Share and Follow in one row, for a guest and for a member, in English and
 * Persian, with nothing physical in its layout.
 */
const FIXTURE = '00000000-0000-4000-8000-00000000f001';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const PAGE = readFileSync(
  join(__dirname, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
  'utf8',
);
const followed: FollowedEntity = {
  entity_type: 'fixture',
  entity_id: FIXTURE,
  name: 'Everton v Coventry',
  favourite: false,
  followed_at: '2026-11-06T10:00:00.000Z',
};

function row(
  follow: Partial<Parameters<typeof MatchFollow>[0]> = {},
  locale = 'en',
  timeZone = 'Europe/London',
): string {
  return renderToStaticMarkup(
    <MatchToolsRow
      locale={locale}
      timeZone={timeZone}
      share={{
        url: `https://example.test/${locale}/match/${FIXTURE}`,
        title: 'Everton v Coventry',
      }}
    >
      <MatchFollow
        locale={locale}
        fixtureId={FIXTURE}
        name="Everton v Coventry"
        status="scheduled"
        signedIn={false}
        following={null}
        {...follow}
      />
    </MatchToolsRow>,
  );
}
/** The row's direct children, by their opening tags, in order. */
const order = (html: string) =>
  ['href="/', 'data-testid="timezone"', 'data-testid="share"', 'data-testid="match-follow']
    .map((mark) => html.indexOf(mark))
    .every((at, index, all) => at > 0 && (index === 0 || at > all[index - 1]!));

describe('the match page’s tools row (T-1743)', () => {
  it('a guest: back, the zone, Share and Follow, in that order, in one wrapping row', () => {
    const html = row();
    expect(html).toMatch(
      /^<div class="flex flex-wrap items-center [^"]*" data-testid="match-tools">/,
    );
    expect(order(html)).toBe(true);
    expect(html).toContain(`href="/en/scores"`);
    expect(html).toContain(EN['matchCentre.back']);
    expect(html).toContain(`>${EN['share.label']}</button>`);
    // "Follow", a link to sign in that comes back to this match.
    expect(html).toContain(`<span class="md:hidden">${EN['match.follow.short']}</span>`);
    expect(html).toContain(`href="/en/login?next=${encodeURIComponent(`/en/match/${FIXTURE}`)}"`);
    // Every control is a 44px target on a phone.
    expect(html.split('min-h-touch').length - 1).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says the zone once for a screen reader and short for the eye on a phone', () => {
    const html = row();
    expect(html).toMatch(
      /data-testid="timezone"><span class="max-md:sr-only">Times: UK time<\/span><span aria-hidden="true" class="md:hidden">UK time<\/span><\/span>/,
    );
    const tehran = row({}, 'en', 'Asia/Tehran');
    expect(tehran).toContain('Times: Tehran time');
    expect(tehran).toContain('<span aria-hidden="true" class="md:hidden">Tehran time</span>');
  });

  it('a member: the follow form’s button in the row, its sentence on the line under it', () => {
    const html = row({ signedIn: true, following: [] });
    expect(order(html)).toBe(true);
    expect(html).toContain('data-testid="match-follow"');
    expect(html).toContain(`name="entity_id" value="${FIXTURE}"`);
    expect(html).toContain(`<span class="md:hidden">${EN['match.follow.short']}</span>`);
    expect(html).toContain(EN['match.follow.note']);
    expect(html).not.toContain('/login');
    // Following: the words to stop, and the push offer on a line of its own.
    const on = row({ signedIn: true, following: [followed] });
    expect(on).toContain(EN['match.follow.stop']);
    expect(on).toContain(EN['match.follow.following']);
  });

  it('a member is told what cannot be done on a full line: over, or the list unreachable', () => {
    expect(row({ signedIn: true, following: [], status: 'finished' })).toMatch(
      /<p class="basis-full [^"]*" data-testid="match-follow-over">/,
    );
    expect(row({ signedIn: true, following: null })).toMatch(
      /<p class="basis-full [^"]*" data-testid="match-follow-unreachable">/,
    );
  });

  it('a match that could not be read keeps back and the zone, and offers neither Share nor Follow', () => {
    const html = renderToStaticMarkup(
      <MatchToolsRow locale="en" timeZone="Asia/Tehran" share={null} />,
    );
    expect(html).toContain('href="/en/scores"');
    expect(html).toContain('Times: Tehran time');
    expect(html).not.toContain('data-testid="share"');
    expect(html).not.toContain('match-follow');
  });

  it('Persian: the reader’s words, the row mirrored by logical properties alone', () => {
    const html = row({}, 'fa', 'Asia/Tehran');
    expect(html).toContain('→ نتایج');
    expect(html).toContain('<span aria-hidden="true" class="md:hidden">به وقت تهران</span>');
    expect(html).toContain('اشتراک‌گذاری');
    expect(html).toContain('>دنبال کردن</span>');
    expect(html).not.toMatch(PHYSICAL);
    expect(row({}, 'x-rtl')).not.toMatch(PHYSICAL);
  });

  it('is the page’s one row: the page draws no back link, zone or follow line of its own', () => {
    expect(PAGE).toContain('<MatchToolsRow');
    expect(PAGE.split('<MatchFollow').length - 1).toBe(1);
    expect(PAGE.indexOf('<MatchToolsRow')).toBeLessThan(PAGE.indexOf('<MatchFollow'));
    expect(PAGE.indexOf('<MatchFollow')).toBeLessThan(PAGE.indexOf('</MatchToolsRow>'));
    expect(PAGE).not.toContain("'scores.timesIn'");
    expect(PAGE).not.toContain('<ShareLink');
  });
});
