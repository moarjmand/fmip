import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminUser, ContributorFlag, PredictionHistoryItem } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { exactMember, flagsOf, isTombstone, settlementRows, yesNo } from './member-page';

/** A member's page in the console (T-1164): one page, the API's answers only, no write. */
const user = (username: string, status: AdminUser['status'] = 'active'): AdminUser => ({
  id: `${username}-id`,
  username,
  display_name: username,
  email: `${username}@example.test`,
  status,
  email_verified: true,
  roles: [],
  created_at: '2026-01-01T00:00:00.000Z',
});

describe('finding the account', () => {
  it('takes only the exact username, whatever else the search matched', () => {
    const found = exactMember([user('alice'), user('ali'), user('malik')], 'Ali');
    expect(found?.username).toBe('ali');
    expect(exactMember([user('alice')], 'ali')).toBeNull();
  });

  it('shows a deleted account as a tombstone (D-094)', () => {
    expect(isTombstone(user('deleted_0123456789ab', 'deleted'))).toBe(true);
    expect(isTombstone(user('ali', 'suspended'))).toBe(false);
  });
});

describe('the settlements', () => {
  const item = (id: string, settlement: unknown): PredictionHistoryItem =>
    ({
      fixture: {
        id,
        kickoff_at: '2026-09-20T15:00:00.000Z',
        status: 'finished',
        competition: { id: 'pl', name: 'Premier League' },
        home: { id: 'h', name: 'Home', short_name: null },
        away: { id: 'a', name: 'Away', short_name: null },
        score: { home: 1, away: 0 },
      },
      prediction: { id: `${id}-p`, settlement },
    }) as unknown as PredictionHistoryItem;

  it('lists the stored settlements and leaves an unsettled prediction out', () => {
    const rows = settlementRows([
      item('one', {
        status: 'settled',
        void_reason: null,
        outcome_correct: true,
        score_correct: null,
        settled_at: '2026-09-20T17:00:00.000Z',
      }),
      item('two', null),
      item('three', {
        status: 'void',
        void_reason: 'postponed',
        outcome_correct: null,
        score_correct: null,
        settled_at: '2026-09-21T17:00:00.000Z',
      }),
    ]);
    expect(rows.map((r) => [r.fixtureId, r.status, r.voidReason, yesNo(r.outcomeCorrect)])).toEqual(
      [
        ['one', 'settled', null, 'yes'],
        ['three', 'void', 'postponed', '—'],
      ],
    );
    expect(rows[0]?.match).toBe('Home v Away');
  });
});

describe('the flags', () => {
  it('are this member’s only', () => {
    const flags = [
      { id: '1', username: 'Ali' },
      { id: '2', username: 'alice' },
    ] as ContributorFlag[];
    expect(flagsOf(flags, 'ali').map((f) => f.id)).toEqual(['1']);
  });
});

describe('the page', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', 'app', '[locale]', 'admin', 'members', '[username]', 'page.tsx'),
    'utf8',
  );
  const ADMIN = readFileSync(join(__dirname, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

  it('is reached from the member search', () => {
    expect(ADMIN).toContain('/admin/members/${encodeURIComponent(user.username)}');
  });

  it('writes nothing: no form, no action, no method other than a read', () => {
    expect(PAGE).not.toMatch(/<form|Action\b|method:/);
  });

  it('reads only what the API already gives an administrator', () => {
    for (const read of [
      'fetchAdminUsers(',
      'fetchAudit(cookie, user.id)',
      'fetchMemberModerationHistory(',
      'fetchContributorStatus(',
      'fetchContributorFlags(',
      'fetchRating(',
      'fetchRatingHistory(',
      'fetchPredictionHistory(',
      'fetchCareerPoints(',
    ])
      expect(PAGE).toContain(read);
    expect(PAGE).not.toMatch(/apiRequest/);
  });

  it('refuses a non-administrator, pointing a moderator to what they already have', () => {
    expect(PAGE).toContain('data-testid="member-page-forbidden"');
    expect(PAGE).toContain('/admin/moderation/');
    expect(PAGE).not.toMatch(/hasRole|'admin'/);
  });

  it('says a private history is private, and shows a tombstone as one', () => {
    expect(PAGE).toContain('data-testid="member-history-restricted"');
    expect(PAGE).toContain('data-testid="member-tombstone"');
  });

  it('links to the existing audited actions', () => {
    for (const link of ['/admin?q=', '/admin/contributors', '/admin/moderation/'])
      expect(PAGE).toContain(link);
  });

  it('uses no physical side', () => {
    expect(PAGE).not.toMatch(/\b(ml|mr|pl|pr|left|right)-|text-left|text-right/);
  });
});
