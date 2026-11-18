import { describe, expect, it } from 'vitest';
import type { DataQualityCheck } from '@fmip/contracts';
import { DataQualityService, findingsOf } from './data-quality.service';
import {
  type GoalsRow,
  LIVE_OVERRUN_MINUTES,
  duplicateFixture,
  expectedScore,
  finishedWithoutScore,
  fixtureMappedTwice,
  goalsDisagree,
  lineupNotEleven,
  liveOverrun,
  PERSON_CANDIDATE_INTERVAL_SECONDS,
  type PersonPairRow,
  SWEPT_CHECKS,
  checkFreshness,
  checksToSweep,
  personCheckDue,
  personDuplicateCandidate,
  tableDisagreements,
} from './internal/checks';
import { type CoverageCandidateRow, coverageProposal } from './internal/coverage-proposals';

// Each check against the row shapes the store reads, recorded from the feed's
// tables. A check that cannot judge a row says nothing: absence is coverage.
const REF = {
  fixtureId: '00000000-0000-4000-8000-00000000f001',
  seasonId: '00000000-0000-4000-8000-00000000a001',
  competitionId: '00000000-0000-4000-8000-00000000c001',
};
const NOW = new Date('2026-09-28T18:00:00Z');

describe('finished_without_score', () => {
  it('names a finished match with no full-time score, and what it has instead', () => {
    expect(finishedWithoutScore({ ...REF, status: 'finished', kinds: [] })).toMatchObject({
      check: 'finished_without_score',
      subjectKey: REF.fixtureId,
      fixtureId: REF.fixtureId,
      competitionId: REF.competitionId,
      detail: 'finished with no score stored at all',
    });
    expect(
      finishedWithoutScore({ ...REF, status: 'finished', kinds: ['half_time', 'current'] })?.detail,
    ).toBe('finished with no full-time score (stored: current, half_time)');
  });

  it('is quiet for a finished match with its score, and for anything not finished', () => {
    expect(finishedWithoutScore({ ...REF, status: 'finished', kinds: ['full_time'] })).toBeNull();
    expect(finishedWithoutScore({ ...REF, status: 'live', kinds: [] })).toBeNull();
    expect(finishedWithoutScore({ ...REF, status: 'postponed', kinds: [] })).toBeNull();
  });
});

describe('goals_disagree', () => {
  const g = (
    kind: GoalsRow['goals'][number]['kind'],
    side: 'home' | 'away' | null,
    minute = 30,
  ) => ({
    kind,
    side,
    minute,
  });
  const row = (over: Partial<GoalsRow>): GoalsRow => ({
    ...REF,
    status: 'finished',
    scores: { current: { home: 2, away: 1 }, full_time: { home: 2, away: 1 } },
    incidents: 5,
    goals: [g('goal', 'home'), g('penalty_goal', 'home'), g('goal', 'away')],
    ...over,
  });

  it('agrees when the timeline adds up to the score', () => {
    expect(goalsDisagree(row({}))).toBeNull();
  });

  it('names a timeline missing a goal, side by side against the score', () => {
    expect(goalsDisagree(row({ goals: [g('goal', 'home'), g('goal', 'away')] }))).toMatchObject({
      check: 'goals_disagree',
      detail: 'the timeline has 1-1, the score is 2-1',
    });
  });

  it('names a goal on the wrong side even when the total is right', () => {
    const swapped = row({ goals: [g('goal', 'home'), g('goal', 'away'), g('goal', 'away')] });
    expect(goalsDisagree(swapped)?.detail).toBe('the timeline has 1-2, the score is 2-1');
  });

  it('accepts an own goal filed under either side, because feeds differ', () => {
    // Credited side (incident.participant_id's meaning)...
    expect(
      goalsDisagree(row({ goals: [g('goal', 'home'), g('own_goal', 'home'), g('goal', 'away')] })),
    ).toBeNull();
    // ...or the scorer's own side.
    expect(
      goalsDisagree(row({ goals: [g('goal', 'home'), g('own_goal', 'away'), g('goal', 'away')] })),
    ).toBeNull();
  });

  it('reads the final score: current, else after extra time, else ninety minutes', () => {
    expect(
      expectedScore({
        status: 'finished',
        scores: { extra_time: { home: 3, away: 2 }, full_time: { home: 2, away: 2 } },
      }),
    ).toEqual({ home: 3, away: 2 });
    expect(
      expectedScore({ status: 'finished', scores: { full_time: { home: 2, away: 2 } } }),
    ).toEqual({
      home: 2,
      away: 2,
    });
    // Live: only the running score counts.
    expect(
      expectedScore({ status: 'live', scores: { full_time: { home: 1, away: 0 } } }),
    ).toBeNull();
    expect(
      expectedScore({ status: 'scheduled', scores: { current: { home: 0, away: 0 } } }),
    ).toBeNull();
  });

  it('does not count shoot-out kicks filed as penalty goals at 120 when a shoot-out is recorded', () => {
    const shootout = row({
      scores: {
        current: { home: 1, away: 1 },
        full_time: { home: 1, away: 1 },
        penalties: { home: 4, away: 3 },
      },
      goals: [
        g('goal', 'home'),
        g('goal', 'away'),
        g('penalty_goal', 'home', 120),
        g('penalty_goal', 'away', 120),
        g('penalty_goal', 'home', 120),
      ],
    });
    expect(goalsDisagree(shootout)).toBeNull();
    // Without a shoot-out on record the same kicks are goals, and disagree.
    const { penalties: _drop, ...noShootout } = shootout.scores;
    void _drop;
    expect(goalsDisagree({ ...shootout, scores: noShootout })?.detail).toBe(
      'the timeline has 3-2, the score is 1-1',
    );
  });

  it('names the match goals without the shoot-out kicks when a shoot-out disagrees (T-1640)', () => {
    // A home goal is missing from the timeline: the finding is real, and its
    // tally is the match's goals, not the kicks taken at 120.
    const missing = row({
      scores: {
        current: { home: 2, away: 2 },
        full_time: { home: 2, away: 2 },
        penalties: { home: 2, away: 3 },
      },
      goals: [
        g('goal', 'home'),
        g('goal', 'away'),
        g('goal', 'away'),
        g('penalty_goal', 'home', 120),
        g('penalty_goal', 'home', 120),
        g('penalty_goal', 'away', 120),
        g('penalty_goal', 'away', 120),
        g('penalty_goal', 'away', 120),
      ],
    });
    expect(goalsDisagree(missing)?.detail).toBe('the timeline has 1-2, the score is 2-2');
  });

  it('counts a goal with no side toward the total only', () => {
    expect(
      goalsDisagree(row({ goals: [g('goal', 'home'), g('goal', null), g('goal', 'away')] })),
    ).toBeNull();
    expect(goalsDisagree(row({ goals: [g('goal', null), g('goal', 'away')] }))?.detail).toBe(
      'the timeline has 0-1 and 1 with no side, the score is 2-1',
    );
  });

  it('cannot judge a fixture with no timeline, or with no score to count against', () => {
    expect(goalsDisagree(row({ incidents: 0, goals: [] }))).toBeNull();
    expect(goalsDisagree(row({ scores: {} }))).toBeNull();
  });

  it('a timeline with cards and no goals disagrees with a score that has goals', () => {
    expect(goalsDisagree(row({ incidents: 3, goals: [] }))?.detail).toBe(
      'the timeline has 0-0, the score is 2-1',
    );
  });

  it('judges a live match against its running score', () => {
    const live = row({ status: 'live', scores: { current: { home: 1, away: 0 } }, goals: [] });
    expect(goalsDisagree(live)?.detail).toBe('the timeline has 0-0, the score is 1-0');
  });
});

describe('live_overrun', () => {
  const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);

  it('names a match still live three hours after kick-off, with its clock', () => {
    expect(
      liveOverrun({ ...REF, status: 'live', kickoffAt: at(LIVE_OVERRUN_MINUTES), minute: 90 }, NOW),
    ).toMatchObject({
      check: 'live_overrun',
      detail: "still live more than 3 hours after kick-off (the clock says 90')",
    });
    expect(
      liveOverrun({ ...REF, status: 'live', kickoffAt: at(26 * 60), minute: null }, NOW)?.detail,
    ).toBe('still live more than 26 hours after kick-off (no minute stored)');
  });

  it('is quiet inside the window, and for a match that is not live', () => {
    expect(
      liveOverrun(
        { ...REF, status: 'live', kickoffAt: at(LIVE_OVERRUN_MINUTES - 1), minute: 120 },
        NOW,
      ),
    ).toBeNull();
    expect(
      liveOverrun({ ...REF, status: 'finished', kickoffAt: at(600), minute: null }, NOW),
    ).toBeNull();
  });
});

describe('lineup_not_eleven', () => {
  const TEAM = '00000000-0000-4000-8000-00000000b001';

  it('names one side of one fixture, with the team', () => {
    expect(
      lineupNotEleven({ ...REF, side: 'away', teamId: TEAM, starters: 10, bench: 9 }),
    ).toMatchObject({
      check: 'lineup_not_eleven',
      subjectKey: `${REF.fixtureId}:away`,
      fixtureId: REF.fixtureId,
      teamId: TEAM,
      detail: 'the away line-up has 10 starters',
    });
    expect(
      lineupNotEleven({ ...REF, side: 'home', teamId: TEAM, starters: 12, bench: 0 })?.detail,
    ).toBe('the home line-up has 12 starters');
    // A bench with no starters is a line-up that is not eleven too.
    expect(
      lineupNotEleven({ ...REF, side: 'home', teamId: TEAM, starters: 0, bench: 7 })?.detail,
    ).toBe('the home line-up has 0 starters');
  });

  it('is quiet for eleven, and for a line-up not stored at all', () => {
    expect(
      lineupNotEleven({ ...REF, side: 'home', teamId: TEAM, starters: 11, bench: 12 }),
    ).toBeNull();
    expect(
      lineupNotEleven({ ...REF, side: 'home', teamId: TEAM, starters: 0, bench: 0 }),
    ).toBeNull();
  });
});

describe('fixture_mapped_twice', () => {
  it('names a fixture with two ids from one provider, per provider', () => {
    expect(fixtureMappedTwice({ ...REF, provider: 'api_football', ids: 2 })).toMatchObject({
      check: 'fixture_mapped_twice',
      subjectKey: `${REF.fixtureId}:api_football`,
      detail: '2 ids from api_football point at this fixture',
    });
    expect(fixtureMappedTwice({ ...REF, provider: 'api_football', ids: 1 })).toBeNull();
  });
});

describe('duplicate_fixture', () => {
  const OTHER = '00000000-0000-4000-8000-00000000f000';
  const pair = {
    ...REF,
    otherFixtureId: OTHER,
    kickoffAt: new Date('2026-09-20T15:00:00Z'),
    otherKickoffAt: new Date('2026-09-21T19:45:00Z'),
    status: 'postponed',
    otherStatus: 'finished',
  };

  it('names the pair once, in a stable order, whichever way it was read', () => {
    const one = duplicateFixture(pair);
    const other = duplicateFixture({
      ...pair,
      fixtureId: OTHER,
      otherFixtureId: REF.fixtureId,
      kickoffAt: pair.otherKickoffAt,
      otherKickoffAt: pair.kickoffAt,
      status: 'finished',
      otherStatus: 'postponed',
    });
    expect(one).toMatchObject({
      check: 'duplicate_fixture',
      subjectKey: `${OTHER}:${REF.fixtureId}`,
      fixtureId: OTHER,
      relatedFixtureId: REF.fixtureId,
      detail: 'the same home and away teams twice within 3 days (postponed, then finished)',
    });
    expect(other?.subjectKey).toBe(one?.subjectKey);
    expect(other?.detail).toBe(one?.detail);
  });

  it('is quiet for two matches both played on different days, a double-header (T-1473)', () => {
    const played = { ...pair, status: 'finished', otherStatus: 'finished' };
    // 28 h 45 min apart, both with a result: two matches.
    expect(duplicateFixture(played)).toBeNull();
    // Both finished within a day of each other: one match stored twice is still possible.
    expect(
      duplicateFixture({ ...played, otherKickoffAt: new Date('2026-09-21T14:00:00Z') }),
    ).toMatchObject({ check: 'duplicate_fixture' });
  });

  it('names the same two teams at the same time with sides swapped, both played (T-1475)', () => {
    const mirrored = {
      ...pair,
      otherKickoffAt: pair.kickoffAt,
      status: 'finished',
      otherStatus: 'finished',
      swapped: true,
    };
    expect(duplicateFixture(mirrored)).toMatchObject({
      check: 'duplicate_fixture',
      detail:
        'the same two teams at the same time, home and away swapped (finished, then finished)',
    });
    // A second leg, days later with the sides reversed, is a match of its own.
    expect(
      duplicateFixture({ ...mirrored, otherKickoffAt: new Date('2026-09-27T15:00:00Z') }),
    ).toBeNull();
  });

  it('is quiet for a cancelled one, and for a pair further apart than three days', () => {
    expect(duplicateFixture({ ...pair, status: 'cancelled' })).toBeNull();
    expect(
      duplicateFixture({ ...pair, otherKickoffAt: new Date('2026-09-24T15:00:01Z') }),
    ).toBeNull();
  });
});

describe('table_disagrees', () => {
  const season = { seasonId: REF.seasonId, competitionId: REF.competitionId };
  const TEAM_A = '00000000-0000-4000-8000-00000000b00a';
  const TEAM_B = '00000000-0000-4000-8000-00000000b00b';

  it('names each team whose played count is not the provider’s, and the unmapped ones once', () => {
    const found = tableDisagreements(
      season,
      [
        { teamId: TEAM_A, providerPlayed: 5, ourPlayed: 4 },
        { teamId: TEAM_B, providerPlayed: 5, ourPlayed: undefined },
      ],
      2,
    );
    expect(found.map((f) => [f.subjectKey, f.teamId, f.detail])).toEqual([
      [`${REF.seasonId}:${TEAM_A}`, TEAM_A, "the provider's table has 5 played, ours 4"],
      [`${REF.seasonId}:${TEAM_B}`, TEAM_B, "the provider's table has 5 played, ours has no row"],
      [`${REF.seasonId}:unmapped`, null, "2 teams in the provider's table have no mapping"],
    ]);
  });

  it('is quiet when the counts agree, or when a team has not played yet', () => {
    expect(
      tableDisagreements(
        season,
        [
          { teamId: TEAM_A, providerPlayed: 5, ourPlayed: 5 },
          { teamId: TEAM_B, providerPlayed: 0, ourPlayed: undefined },
        ],
        0,
      ),
    ).toEqual([]);
  });
});

describe('findingsOf', () => {
  it('runs every swept check and keeps one finding per check and subject', () => {
    const found = findingsOf(
      {
        scores: [{ ...REF, status: 'finished', kinds: [] }],
        goals: [],
        live: [],
        lineups: [
          { ...REF, side: 'home', teamId: 'x', starters: 10, bench: 0 },
          { ...REF, side: 'home', teamId: 'x', starters: 10, bench: 0 },
        ],
        mappings: [],
        pairs: [],
        people: [PEOPLE, { ...PEOPLE }],
      },
      NOW,
    );
    expect(found.map((f) => f.check)).toEqual([
      'finished_without_score',
      'lineup_not_eleven',
      'person_duplicate_candidate',
    ]);
  });
});

// T-1864 (D-446): which pairs are candidates is the database function's
// (`packages/db/src/person-candidates.spec.ts`); the check names the pair with
// its signals and the proposed survivor, never a fixture.
const LOW = '00000000-0000-4000-8000-0000000000a1';
const HIGH = '00000000-0000-4000-8000-0000000000b2';
const PEOPLE: PersonPairRow = {
  lowPersonId: LOW,
  highPersonId: HIGH,
  lowName: 'Ali Karimi',
  highName: 'Ali Karimi',
  dateOfBirth: '2001-04-05',
  matchedOn: 'full_name',
  sameNationality: true,
  commonTeams: ['Esteghlal', 'Sepahan'],
  lowLineups: 3,
  highLineups: 41,
  appearancesDisjoint: true,
  lowCoachOnly: false,
  highCoachOnly: false,
  proposedInto: HIGH,
  proposedBecause: 'more_lineups',
};

describe('person_duplicate_candidate', () => {
  it('names the pair, its signals and the proposed merge, on no fixture', () => {
    const finding = personDuplicateCandidate(PEOPLE);
    expect(finding).toMatchObject({
      check: 'person_duplicate_candidate',
      subjectKey: `${LOW}:${HIGH}`,
      fixtureId: null,
      relatedFixtureId: null,
      teamId: null,
      seasonId: null,
      competitionId: null,
    });
    expect(finding?.detail).toContain('born 2001-04-05');
    expect(finding?.detail).toContain('same nationality: yes');
    expect(finding?.detail).toContain('clubs in common: Esteghlal, Sepahan');
    expect(finding?.detail).toContain('line-ups: 3 and 41');
    expect(finding?.detail).toContain('appearances disjoint: yes');
    expect(finding?.detail).toContain(`proposed: --from ${LOW} --into ${HIGH} (more line-ups)`);
  });

  it('says unknown where a signal cannot be judged, and names a coach row', () => {
    const detail = personDuplicateCandidate({
      ...PEOPLE,
      matchedOn: 'known_as',
      sameNationality: null,
      commonTeams: [],
      highLineups: 0,
      appearancesDisjoint: null,
      highCoachOnly: true,
      proposedInto: LOW,
      proposedBecause: 'player_row',
    })?.detail;
    expect(detail).toContain("one's full name the other's known-as");
    expect(detail).toContain('same nationality: unknown');
    expect(detail).toContain('clubs in common: none');
    expect(detail).toContain('appearances disjoint: unknown');
    expect(detail).toContain(`${HIGH}, a coach id only`);
    expect(detail).toContain(
      `proposed: --from ${HIGH} --into ${LOW} (the player row of a player and coach pair)`,
    );
  });

  it('runs at most hourly, only in an unscoped sweep, and is stale after three hours', () => {
    const hour = PERSON_CANDIDATE_INTERVAL_SECONDS * 1000;
    expect(personCheckDue(null, NOW)).toBe(true);
    expect(personCheckDue(new Date(NOW.getTime() - hour + 1000), NOW)).toBe(false);
    expect(personCheckDue(new Date(NOW.getTime() - hour), NOW)).toBe(true);
    expect(checksToSweep(null, undefined, NOW)).toEqual(SWEPT_CHECKS);
    expect(checksToSweep(null, new Date(NOW.getTime() - 5 * 60_000), NOW)).not.toContain(
      'person_duplicate_candidate',
    );
    expect(checksToSweep('a-season', null, NOW)).not.toContain('person_duplicate_candidate');
    expect(checksToSweep('a-season', null, NOW)).toContain('lineup_not_eleven');
    const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    expect(checkFreshness('person_duplicate_candidate', ago(150), NOW)).toBe('current');
    expect(checkFreshness('person_duplicate_candidate', ago(181), NOW)).toBe('stale');
    expect(checkFreshness('lineup_not_eleven', ago(16), NOW)).toBe('stale');
  });

  it('a sweep between hourly runs neither reads the persons nor passes the check to record, so its findings stay open', async () => {
    const calls: { people: boolean; checks: readonly DataQualityCheck[] }[] = [];
    const sweepAfter = async (minutes: number | null, seasonId: string | null = null) => {
      const runs = new Map<DataQualityCheck, Date>(
        minutes === null
          ? []
          : [['person_duplicate_candidate', new Date(NOW.getTime() - minutes * 60_000)]],
      );
      let people = false;
      const store = {
        checkRuns: async () => runs,
        read: async (_now: Date, _season: string | null, wanted: boolean) => {
          people = wanted;
          return {
            scores: [],
            goals: [],
            live: [],
            lineups: [],
            mappings: [],
            pairs: [],
            people: wanted ? [PEOPLE] : [],
          };
        },
        locked: async <T>(work: (client: unknown) => Promise<T>) => work({}),
        record: async (_client: unknown, checks: readonly DataQualityCheck[]) => {
          calls.push({ people, checks });
          return { opened: 0, seen: 0, resolved: 0 };
        },
      };
      await new DataQualityService(store as never).sweep(NOW, seasonId);
      return calls.at(-1)!;
    };
    const skipped = await sweepAfter(10);
    expect(skipped.people).toBe(false);
    expect(skipped.checks).not.toContain('person_duplicate_candidate');
    expect(skipped.checks).toContain('duplicate_fixture');
    for (const due of [await sweepAfter(61), await sweepAfter(null)]) {
      expect(due.people).toBe(true);
      expect(due.checks).toContain('person_duplicate_candidate');
    }
    const scoped = await sweepAfter(null, 'a-season');
    expect(scoped.people).toBe(false);
    expect(scoped.checks).not.toContain('person_duplicate_candidate');
  });

  it('keeps one subject whichever way round the pair is read, and never pairs a row with itself', () => {
    const swapped = personDuplicateCandidate({ ...PEOPLE, lowPersonId: HIGH, highPersonId: LOW });
    expect(swapped?.subjectKey).toBe(`${LOW}:${HIGH}`);
    expect(personDuplicateCandidate({ ...PEOPLE, highPersonId: LOW })).toBeNull();
  });
});

// T-914, D-109: a past season's coverage is proposed as `limited` only on what
// is left after adoption and one re-ask, and the proposal names its counts.
describe('coverage proposals', () => {
  const ROW: CoverageCandidateRow = {
    season_id: REF.seasonId,
    season_label: '2024/25',
    competition_id: REF.competitionId,
    competition_name: 'Cup',
    check_kind: 'lineup_not_eleven',
    finished: 200,
    fetched: 200,
    open: 30,
    open_after_reask: 20,
    fetch_provider: 'api_football',
    pending_people: 0,
    coverage_state: 'available',
    coverage_provider: 'api_football',
    coverage_note: null,
  };

  it('proposes limited line-ups when a tenth of the season is still short after a re-ask', () => {
    expect(coverageProposal(ROW)).toEqual({
      competition: { id: REF.competitionId, name: 'Cup' },
      season: { id: REF.seasonId, label: '2024/25' },
      module: 'lineups',
      check: 'lineup_not_eleven',
      current: { state: 'available', provider: 'api_football', note: null },
      proposed: {
        state: 'limited',
        provider: 'api_football',
        note: '20 of 200 finished matches still show a line-up that is not eleven after the feed was asked again.',
      },
      counts: { finished: 200, fetched: 200, open: 30, open_after_reask: 20 },
    });
  });

  it('proposes incidents for goals that disagree, with the fetching provider when none is declared', () => {
    const proposal = coverageProposal({
      ...ROW,
      check_kind: 'goals_disagree',
      coverage_state: null,
      coverage_provider: null,
    });
    expect(proposal?.module).toBe('incidents');
    expect(proposal?.proposed.provider).toBe('api_football');
    expect(proposal?.current.state).toBeNull();
  });

  it('says nothing while any condition does not hold', () => {
    expect(coverageProposal({ ...ROW, open_after_reask: 19 })).toBeNull(); // under 10%
    expect(coverageProposal({ ...ROW, fetched: 199 })).toBeNull(); // a match not yet fetched
    expect(coverageProposal({ ...ROW, pending_people: 1 })).toBeNull(); // our adoption lag
    expect(coverageProposal({ ...ROW, finished: 0, fetched: 0 })).toBeNull();
    expect(coverageProposal({ ...ROW, coverage_state: 'limited' })).toBeNull(); // already said
    expect(coverageProposal({ ...ROW, coverage_state: 'not_supplied' })).toBeNull();
    expect(coverageProposal({ ...ROW, coverage_provider: null, fetch_provider: null })).toBeNull();
  });

  it('never leaves a mostly incomplete season available (rule 3)', () => {
    const proposal = coverageProposal({ ...ROW, open: 150, open_after_reask: 120 });
    expect(proposal?.proposed.state).toBe('limited');
  });
});
