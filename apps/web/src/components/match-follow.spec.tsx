import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FollowedEntity } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EN, t } from '@/i18n/messages';

// The server actions need a request; the component only binds them.
vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const { MatchFollow } = await import('./match-follow');

/**
 * The follow control in the match centre (T-945, D-116): one form posting the
 * settings page's follow, the window said in words, and every state that is
 * not a button a sentence -- never a guessed one.
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
  name: 'Home v Away',
  favourite: false,
  followed_at: '2026-09-29T10:00:00.000Z',
};

function render(props: Partial<Parameters<typeof MatchFollow>[0]> = {}, locale = 'en'): string {
  return renderToStaticMarkup(
    <MatchFollow
      locale={locale}
      fixtureId={FIXTURE}
      name="Home v Away"
      status="scheduled"
      signedIn
      following={[]}
      {...props}
    />,
  );
}

describe('following a match', () => {
  it('offers the follow as a plain form for the match, with the window in words', () => {
    const html = render();
    expect(html).toContain('data-testid="match-follow"');
    expect(html).toContain('name="entity_type" value="fixture"');
    expect(html).toContain(`name="entity_id" value="${FIXTURE}"`);
    expect(html).toContain(EN['match.follow.start']);
    expect(html).toContain(EN['match.follow.note']);
  });

  it('offers to stop when the match is followed, even after full-time', () => {
    for (const status of ['live', 'finished'] as const) {
      const html = render({ status, following: [followed] });
      expect(html).toContain(EN['match.follow.stop']);
      expect(html).toContain(EN['match.follow.following']);
    }
  });

  it('a follow of a team is not a follow of the match', () => {
    const html = render({ following: [{ ...followed, entity_type: 'team' }] });
    expect(html).toContain(EN['match.follow.start']);
  });

  it('says so when the match is over, the member is a guest, or the list is unreachable', () => {
    expect(render({ status: 'finished' })).toContain(EN['match.follow.over']);
    expect(render({ status: 'finished' })).not.toContain('<form');
    const guest = render({ signedIn: false, following: null });
    expect(guest).toContain(EN['match.follow.signIn']);
    // Sign-in comes back to this match (T-1736's return address).
    expect(guest).toContain(`href="/en/login?next=${encodeURIComponent(`/en/match/${FIXTURE}`)}"`);
    const unreachable = render({ following: null });
    expect(unreachable).toContain(EN['match.follow.unreachable']);
    expect(unreachable).not.toContain('<form');
  });

  // T-1743 (D-364): on a phone the control is the tools row's last item.
  it('a guest gets the one word "Follow" on a phone, the sentence from 768px, one link', () => {
    const guest = render({ signedIn: false, following: null });
    expect(guest).toMatch(
      new RegExp(
        `<span class="md:hidden">${EN['match.follow.short']}</span><span class="max-md:hidden">${EN['match.follow.signIn']}</span></a>`,
      ),
    );
    expect(guest.split('<a ').length - 1).toBe(1);
    // A 44px target at the row's end on a phone.
    expect(guest).toMatch(/<p class="ms-auto [^"]*" data-testid="match-follow-guest">/);
    expect(guest).toMatch(/<a class="[^"]*min-h-touch[^"]*"/);
    // Persian, and the way back under its own locale.
    const fa = render({ signedIn: false, following: null }, 'fa');
    expect(fa).toContain('>دنبال کردن</span>');
    expect(fa).toContain(`href="/fa/login?next=${encodeURIComponent(`/fa/match/${FIXTURE}`)}"`);
  });

  it('offers a guest nothing once the match is over: there is nothing left to follow', () => {
    for (const status of ['finished', 'awarded', 'cancelled', 'abandoned'] as const) {
      expect(render({ signedIn: false, following: null, status })).toBe('');
    }
    // Still offered while it can be followed.
    for (const status of ['scheduled', 'live', 'postponed'] as const) {
      expect(render({ signedIn: false, following: null, status })).toContain(
        'data-testid="match-follow-guest"',
      );
    }
  });

  it('a member keeps the form and its sentence; the button is short on a phone', () => {
    const html = render();
    // No box of its own on a phone: the button joins the row, the sentence the line under it.
    expect(html).toMatch(/<form [^>]*class="max-md:contents [^"]*md:basis-full[^"]*"/);
    expect(html).toMatch(
      new RegExp(
        `<span class="md:hidden">${EN['match.follow.short']}</span><span class="max-md:hidden">${EN['match.follow.start']}</span></button>`,
      ),
    );
    expect(html).toMatch(
      /<span class="[^"]*max-md:basis-full[^"]*">[^<]*three hours after full-time/,
    );
    // Stopping keeps its own words at every width.
    const stop = render({ following: [followed] });
    expect(stop).toContain(`>${EN['match.follow.stop']}</button>`);
    expect(stop).not.toContain(EN['match.follow.short']);
  });

  it('right to left: worded from the catalogue, and no physical side', () => {
    const html = render({}, 'x-rtl');
    expect(html).toContain(t('x-rtl', 'match.follow.start'));
    expect(html).not.toMatch(PHYSICAL);
  });

  it('is on the match centre, for signed-in members from their own follows', () => {
    expect(PAGE).toContain('<MatchFollow');
    expect(PAGE).toContain('fetchFollowing(cookie)');
  });
});
