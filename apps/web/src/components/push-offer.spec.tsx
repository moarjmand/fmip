import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FollowedEntity } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DISMISSED_KEY,
  DISMISS_DAYS,
  INTENT_KEY,
  INTENT_TTL_MS,
  isDismissed,
  markFollowIntent,
  rememberDismissal,
  shouldOffer,
  takeFollowIntent,
} from '@/lib/push-offer';

// The server actions need a request; the components only bind or import them.
vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));
vi.mock('@/lib/push-actions', () => ({
  pushOfferKeyAction: async () => null,
  subscribePushAction: async () => null,
  unsubscribePushAction: async () => null,
}));

const { EntityFollow } = await import('./competition-page');
const { MatchFollow } = await import('./match-follow');
const { FollowingSection } = await import('./following-section');

/**
 * Push offered at the moment of a follow (T-1429). Production had push on and
 * no device subscribed, because the only way in was a switch two pages deep.
 * These hold the promises that make the offer acceptable rather than a nag:
 * it appears after a follow and only then, the browser's prompt only after a
 * yes, "Not now" is remembered on the device, and a device that cannot or
 * already does receive push is never offered.
 */

class MemoryStore {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const TEAM = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const FIXTURE = '00000000-0000-4000-8000-00000000f001';
const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = 24 * 60 * 60 * 1000;

describe('the follow intent', () => {
  it('is taken once, by the offer for that follow, after a click', () => {
    const store = new MemoryStore();
    markFollowIntent(store, 'team', TEAM, NOW);
    expect(takeFollowIntent(store, { type: 'competition', id: TEAM }, NOW)).toBeNull();
    expect(takeFollowIntent(store, { type: 'team', id: OTHER }, NOW)).toBeNull();
    // Left for its own offer, then gone once taken.
    expect(takeFollowIntent(store, { type: 'team', id: TEAM }, NOW + 1000)).toEqual({
      type: 'team',
      id: TEAM,
      at: NOW,
    });
    expect(takeFollowIntent(store, { type: 'team', id: TEAM }, NOW + 1000)).toBeNull();
  });

  it('is answered by a page-wide offer whatever was followed', () => {
    const store = new MemoryStore();
    markFollowIntent(store, 'competition', OTHER, NOW);
    expect(takeFollowIntent(store, null, NOW)?.id).toBe(OTHER);
  });

  it('marks only the follows that send match alerts', () => {
    const store = new MemoryStore();
    markFollowIntent(store, 'person', TEAM, NOW);
    markFollowIntent(store, 'team', '', NOW);
    expect(store.getItem(INTENT_KEY)).toBeNull();
    markFollowIntent(store, 'fixture', FIXTURE, NOW);
    expect(takeFollowIntent(store, { type: 'fixture', id: FIXTURE }, NOW)).not.toBeNull();
  });

  it('is ignored when stale, malformed, or the storage refuses', () => {
    const store = new MemoryStore();
    markFollowIntent(store, 'team', TEAM, NOW);
    expect(takeFollowIntent(store, null, NOW + INTENT_TTL_MS + 1)).toBeNull();
    expect(store.getItem(INTENT_KEY)).toBeNull();
    store.setItem(INTENT_KEY, '{not json');
    expect(takeFollowIntent(store, null, NOW)).toBeNull();
    store.setItem(INTENT_KEY, JSON.stringify({ type: 'person', id: TEAM, at: NOW }));
    expect(takeFollowIntent(store, null, NOW)).toBeNull();
    expect(store.getItem(INTENT_KEY)).toBeNull();
    expect(() => markFollowIntent(throwing, 'team', TEAM, NOW)).not.toThrow();
    expect(takeFollowIntent(throwing, null, NOW)).toBeNull();
    expect(takeFollowIntent(null, null, NOW)).toBeNull();
  });
});

describe('the dismissal', () => {
  it(`quiets the offer on this device for ${DISMISS_DAYS} days, then lets it return`, () => {
    const store = new MemoryStore();
    expect(isDismissed(store, NOW)).toBe(false);
    rememberDismissal(store, NOW);
    expect(store.getItem(DISMISSED_KEY)).toBe(String(NOW));
    expect(isDismissed(store, NOW + (DISMISS_DAYS - 1) * DAY)).toBe(true);
    expect(isDismissed(store, NOW + DISMISS_DAYS * DAY)).toBe(false);
  });

  it('reads an unreadable store as dismissed rather than ask again and again', () => {
    expect(isDismissed(throwing, NOW)).toBe(true);
    expect(() => rememberDismissal(throwing, NOW)).not.toThrow();
    const store = new MemoryStore();
    store.setItem(DISMISSED_KEY, 'soon');
    expect(isDismissed(store, NOW)).toBe(false);
  });
});

describe('whether to ask', () => {
  const ask = {
    supported: true,
    permission: 'default',
    subscribed: false,
    dismissed: false,
  } as const;

  it('asks a device that can take push and has none', () => {
    expect(shouldOffer(ask)).toBe(true);
    // Granted earlier but never subscribed: a yes subscribes without a prompt.
    expect(shouldOffer({ ...ask, permission: 'granted' })).toBe(true);
  });

  it('never asks a browser without push, one that refused, one subscribed, or one dismissed', () => {
    expect(shouldOffer({ ...ask, supported: false })).toBe(false);
    expect(shouldOffer({ ...ask, permission: 'denied' })).toBe(false);
    expect(shouldOffer({ ...ask, subscribed: true })).toBe(false);
    expect(shouldOffer({ ...ask, dismissed: true })).toBe(false);
  });
});

describe('where the offer is drawn', () => {
  const props = {
    locale: 'en',
    signedIn: true,
    followingKey: 'teamPage.follow.following',
    unreachableKey: 'teamPage.follow.unreachable',
  } as const;
  const team = { entity_type: 'team', entity_id: TEAM } as FollowedEntity;

  it('marks a team follow as it posts, and offers once the team is followed', () => {
    const off = renderToStaticMarkup(
      <EntityFollow {...props} entityType="team" entityId={TEAM} name="Esteghlal" following={[]} />,
    );
    expect(off).toContain('data-testid="push-offer-intent"');
    expect(off).not.toContain('data-testid="push-offer-slot"');
    const on = renderToStaticMarkup(
      <EntityFollow
        {...props}
        entityType="team"
        entityId={TEAM}
        name="Esteghlal"
        following={[team]}
      />,
    );
    expect(on).toContain('data-testid="push-offer-slot"');
    expect(on).not.toContain('data-testid="push-offer-intent"');
    // Empty until the browser has been asked what it can do: nothing on the server render.
    expect(on).not.toContain('data-testid="push-offer"');
  });

  it("never offers at a player's follow, which sends no match alerts", () => {
    for (const following of [[], [{ entity_type: 'person', entity_id: TEAM } as FollowedEntity]]) {
      const html = renderToStaticMarkup(
        <EntityFollow
          {...props}
          entityType="person"
          entityId={TEAM}
          name="Taremi"
          following={following}
        />,
      );
      expect(html).not.toContain('push-offer');
    }
  });

  it('marks and offers at a match follow too', () => {
    const base = { locale: 'en', fixtureId: FIXTURE, name: 'A v B', status: 'scheduled' } as const;
    expect(renderToStaticMarkup(<MatchFollow {...base} signedIn following={[]} />)).toContain(
      'data-testid="push-offer-intent"',
    );
    const followed = { entity_type: 'fixture', entity_id: FIXTURE } as FollowedEntity;
    expect(
      renderToStaticMarkup(<MatchFollow {...base} signedIn following={[followed]} />),
    ).toContain('data-testid="push-offer-slot"');
  });

  it('marks the pickers on the follow list, not the favourite or unfollow buttons, and links to the switch', () => {
    const html = renderToStaticMarkup(
      <FollowingSection
        locale="en"
        following={[{ ...team, name: 'Esteghlal', favourite: false } as FollowedEntity]}
        teams={[]}
        competitions={[]}
      />,
    );
    expect(html.match(/data-testid="push-offer-intent"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="push-offer-slot"');
    expect(html).toContain('href="/en/settings/notifications"');
  });
});

describe('the browser prompt', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('is asked in one place, after a click, and the offer has no other way to it', () => {
    expect(read('lib', 'push-subscribe.ts')).toContain('Notification.requestPermission()');
    const offer = read('components', 'push-offer.tsx');
    const toggle = read('components', 'push-toggle.tsx');
    expect(offer).not.toContain('requestPermission');
    expect(toggle).not.toContain('requestPermission');
    // Only the yes button's handler subscribes.
    expect(offer.match(/subscribeThisDevice\(/g)).toHaveLength(1);
    expect(offer).toMatch(/const accept = \(\) =>[\s\S]*subscribeThisDevice\(/);
  });

  it('keeps the offer in logical properties', () => {
    const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
    expect(read('components', 'push-offer.tsx')).not.toMatch(PHYSICAL);
  });
});
