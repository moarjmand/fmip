import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS } from '@fmip/contracts';
import type { Notification } from '@fmip/contracts';
import { NOTIFICATION_TEXT, notificationHref, notificationLine } from '../lib/notification-links';

/**
 * The inbox on the page (T-272).
 *
 * The acceptance criterion is **every notification opens the match, profile,
 * group or conversation that caused it**, and the link is built here rather than
 * in the API — so this is where it can be wrong. The routing table is a pure
 * function, which means the interesting cases can be tested directly instead of
 * through a render.
 */
const HERE = __dirname;
const LIST = readFileSync(join(HERE, 'notification-list.tsx'), 'utf8');
const LINKS = readFileSync(join(HERE, '..', 'lib', 'notification-links.ts'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'notification-actions.ts'), 'utf8');

const NOTIFICATION = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  kind: 'friend_request',
  subject_type: 'member',
  subject_id: '00000000-0000-4000-8000-000000000001',
  subject_label: 'ada',
  source: 'ada',
  created_at: '2026-09-15T12:00:00.000Z',
  read_at: null,
  held_reason: null,
  ...over,
});

describe('a notification opens the thing that caused it', () => {
  it('routes a member by handle and a fixture by id', () => {
    // The two shapes the product actually has: a profile is reached at
    // `/u/{username}` and a match at `/match/{uuid}`. The API sends the
    // canonical id either way (rule 1) and the label when a route needs one.
    expect(notificationHref('en', NOTIFICATION())).toBe('/en/u/ada');
    expect(
      notificationHref('en', NOTIFICATION({ subject_type: 'fixture', subject_label: null })),
    ).toBe('/en/match/00000000-0000-4000-8000-000000000001');
  });

  it('routes a group by slug', () => {
    expect(
      notificationHref('en', NOTIFICATION({ subject_type: 'group', subject_label: 'the-pub' })),
    ).toBe('/en/groups/the-pub');
  });

  it('gives no link when the subject no longer resolves', () => {
    // A group that was deleted. A link that 404s is worse than none: what
    // happened is still true, only the destination is gone (rule 3).
    expect(
      notificationHref('en', NOTIFICATION({ subject_type: 'group', subject_label: null })),
    ).toBeNull();
    expect(
      notificationHref('en', NOTIFICATION({ subject_type: 'member', subject_label: null })),
    ).toBeNull();
  });

  it('escapes a handle rather than pasting it into a path', () => {
    expect(
      notificationHref('en', NOTIFICATION({ subject_type: 'group', subject_label: 'a b/c' })),
    ).toBe('/en/groups/a%20b%2Fc');
  });

  it('carries the locale, because every route in this app is under one', () => {
    expect(notificationHref('fa', NOTIFICATION())).toBe('/fa/u/ada');
  });
});

describe('what each notification says', () => {
  it('has words for every kind the contract can emit', () => {
    // Keyed by the union, so a kind added without a sentence does not compile.
    // A notification with no sentence is a row in a table.
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_TEXT[kind]?.text, `no words for ${kind}`).toBeTruthy();
    }
  });

  it('puts a name in front of the kinds that read as fragments, and not the others', () => {
    expect(notificationLine(NOTIFICATION())).toBe('ada sent you a friend request.');
    // Emitted with no source on purpose (T-271): a moderation decision belongs
    // to the platform, and a name in front of it would be wrong as well as
    // unkind.
    expect(notificationLine(NOTIFICATION({ kind: 'moderation_decision', source: null }))).toBe(
      'A moderation decision was made about your account.',
    );
  });

  it('says "Somebody" rather than leaving a gap when a source is gone', () => {
    // An account can be deleted after it caused something, and a sentence
    // starting with a space is worse than an honest indefinite.
    expect(notificationLine(NOTIFICATION({ source: null }))).toBe(
      'Somebody sent you a friend request.',
    );
  });

  it('decides on a field rather than on the wording', () => {
    // Inferring from capitalisation would work until somebody rephrased one,
    // and then be wrong silently.
    expect(LINKS).toContain('named: boolean');
    expect(LINKS).not.toMatch(/toLowerCase\(\)/);
  });
});

describe('the page', () => {
  it('shows an unopenable notification without a link, rather than hiding it', () => {
    expect(LIST).toContain('data-testid="notification-unlinked"');
    expect(LIST).toContain('href === null');
  });

  it('says a held notification was held', () => {
    expect(LIST).toContain('data-testid="notification-held"');
    expect(LIST).toMatch(/Held: \{notification\.held_reason\}/);
  });

  it('tells unreachable apart from empty', () => {
    expect(LIST).toContain('data-testid="notifications-unreachable"');
    expect(LIST).toContain('data-testid="notifications-empty"');
  });

  it('counts the unread across the inbox, not the page', () => {
    expect(LIST).toContain('page.unread');
  });

  it('revalidates so a read notification stops looking unread', () => {
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/notifications`)');
  });

  it('uses logical properties only (rule 7)', () => {
    expect(LIST).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
