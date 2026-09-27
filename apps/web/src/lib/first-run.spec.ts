import type { TeamSummary } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_GUEST_TEAMS,
  STEPS,
  TEAM_RESULTS,
  afterFirstRun,
  applyPlan,
  hasChoices,
  nextStep,
  parseGuestChoices,
  readStep,
  serializeGuestChoices,
  stepHref,
  teamMatches,
} from './first-run';

const A = '00000000-0000-4000-8000-000000000601';
const B = '00000000-0000-4000-8000-000000000602';

describe("a guest's choices in their cookie (T-620)", () => {
  it('round-trips every choice', () => {
    const choices = {
      language: 'ar' as const,
      territory: 'GB',
      timezone: 'Asia/Tehran',
      teams: [A, B],
      done: true as const,
    };
    expect(parseGuestChoices(serializeGuestChoices(choices))).toEqual(choices);
  });

  it('drops what a browser should not have sent, field by field, and never throws', () => {
    expect(parseGuestChoices(undefined)).toEqual({});
    expect(parseGuestChoices('not json')).toEqual({});
    expect(parseGuestChoices('[1,2]')).toEqual({});
    expect(
      parseGuestChoices(
        JSON.stringify({
          language: 'x-rtl',
          territory: 'gbr',
          timezone: 'Mars/Olympus',
          teams: ['Liverpool', A, A, 7],
          done: 'yes',
          dismissed: true,
        }),
      ),
    ).toEqual({ teams: [A], dismissed: true });
  });

  it('keeps at most the guest limit of teams', () => {
    const many = Array.from(
      { length: MAX_GUEST_TEAMS + 5 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(parseGuestChoices(JSON.stringify({ teams: many })).teams).toHaveLength(MAX_GUEST_TEAMS);
  });

  it('counts a dismissal alone as nothing for the account', () => {
    expect(hasChoices({ dismissed: true })).toBe(false);
    expect(hasChoices({ timezone: 'UTC' })).toBe(true);
    expect(hasChoices({ done: true })).toBe(true);
  });
});

describe('the steps', () => {
  it('are language, territory, time zone and teams, in that order', () => {
    expect(STEPS).toEqual(['language', 'territory', 'timezone', 'teams']);
    expect(nextStep('language')).toBe('territory');
    expect(nextStep('teams')).toBeNull();
  });

  it('reads an unknown step as the first', () => {
    expect(readStep('timezone')).toBe('timezone');
    expect(readStep(['teams', 'language'])).toBe('teams');
    expect(readStep('password')).toBe('language');
    expect(readStep(undefined)).toBe('language');
  });

  it('keeps where the flow returns to, and returns only to this site', () => {
    expect(stepHref('en', 'teams', '/en/u/ana?invited=1')).toBe(
      '/en/welcome?step=teams&next=%2Fen%2Fu%2Fana%3Finvited%3D1',
    );
    expect(afterFirstRun('en', '/en/u/ana?invited=1')).toBe('/en/u/ana?invited=1');
    expect(afterFirstRun('ar', undefined)).toBe('/ar');
    for (const bad of ['https://evil.test/', '//evil.test/en', '/nope/x', '/en/\\evil', 'en/x']) {
      expect(afterFirstRun('en', bad), bad).toBe('/en');
    }
  });
});

describe('picking teams', () => {
  const team = (id: string, name: string, code: string | null = null): TeamSummary => ({
    id,
    name,
    short_name: null,
    code,
    kind: 'club',
    country_id: null,
  });
  const teams = [team(A, 'Manchester United', 'MUN'), team(B, 'Liverpool', 'LIV')];

  it('matches a name or a code in any case, chosen teams first', () => {
    expect(teamMatches(teams, 'liv', new Set()).map((t) => t.id)).toEqual([B]);
    expect(teamMatches(teams, 'mun', new Set()).map((t) => t.id)).toEqual([A]);
    expect(teamMatches(teams, 'liv', new Set([A])).map((t) => t.id)).toEqual([A, B]);
    expect(teamMatches(teams, 'zzz', new Set())).toEqual([]);
  });

  it('lists a bounded number without a search', () => {
    const many = Array.from({ length: TEAM_RESULTS + 10 }, (_, i) => team(`t${i}`, `Team ${i}`));
    expect(teamMatches(many, '', new Set())).toHaveLength(TEAM_RESULTS);
  });
});

describe("applying a guest's choices to the account", () => {
  const choices = {
    language: 'en' as const,
    territory: 'IR',
    timezone: 'Asia/Tehran',
    teams: [A],
    done: true as const,
  };

  it('applies everything at sign-up, through the endpoints Settings uses', () => {
    expect(applyPlan(choices, 'sign_up', { state: 'pending' })).toEqual([
      {
        method: 'PATCH',
        path: '/me/preferences',
        body: { preferred_language: 'en', timezone: 'Asia/Tehran' },
      },
      { method: 'PUT', path: '/me/territory', body: { code: 'IR' } },
      { method: 'PUT', path: `/me/following/team/${A}`, body: { favourite: true } },
      { method: 'PUT', path: '/me/first-run' },
    ]);
  });

  it('never overwrites an account that already did its first run', () => {
    expect(applyPlan(choices, 'sign_in', { state: 'done', at: '2026-09-01T00:00:00Z' })).toEqual(
      [],
    );
    expect(applyPlan(choices, 'sign_in', { state: 'pending' })).toHaveLength(4);
  });

  it('sends only what was chosen, and never unfollows', () => {
    const plan = applyPlan({ teams: [B] }, 'sign_up', { state: 'pending' });
    expect(plan).toEqual([
      { method: 'PUT', path: `/me/following/team/${B}`, body: { favourite: true } },
    ]);
    expect(plan.some((call) => (call.method as string) === 'DELETE')).toBe(false);
  });
});
