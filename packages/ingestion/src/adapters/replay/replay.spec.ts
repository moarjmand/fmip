import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReplayAdapter, recordingsDir, replayAvailable } from './index';
import { REPLAY_FIXTURE, REPLAY_QUERY } from './plan';

// The replay source (T-026, D-049): the real API-Football adapter over its
// committed recordings. No key, no network, and the same six calls a live
// provider answers.
describe('the replay source', () => {
  const adapter = createReplayAdapter('api_football');

  it('says so in its manifest, and claims no quota', () => {
    expect(adapter.manifest.provider).toBe('api_football');
    expect(adapter.manifest.displayName).toContain('replay');
    expect(adapter.manifest.licence.tier).toContain('replayed');
    expect(adapter.manifest.quota).toEqual({ requestsPerDay: null, requestsPerMinute: null });
  });

  it('answers every one of the six calls from a recording', async () => {
    const fixtures = await adapter.listFixtures(REPLAY_QUERY);
    expect(fixtures.ok).toBe(true);
    expect(fixtures.ok && fixtures.data.length).toBe(10);

    const standings = await adapter.getStandings({
      competitionExternalId: REPLAY_QUERY.competitionExternalId,
      seasonLabel: REPLAY_QUERY.seasonLabel,
    });
    expect(standings.ok).toBe(true);

    const lineup = await adapter.getLineup(REPLAY_FIXTURE);
    expect(lineup.ok).toBe(true);
    expect(lineup.ok && lineup.data.home.players.length).toBeGreaterThan(10);

    const detail = await adapter.getFixtureDetail(REPLAY_FIXTURE);
    expect(detail.ok).toBe(true);

    const absences = await adapter.getAvailability(REPLAY_FIXTURE);
    expect(absences.ok && absences.data.map((a) => a.status)).toEqual(['out']);
    expect(detail.ok && detail.data.incidents.length).toBeGreaterThan(0);
    expect(detail.ok && detail.data.periods.length).toBe(2);

    // The live recording is "everything live on the day", filtered to what was
    // asked for: a match nobody follows costs nothing.
    const live = await adapter.getLive({ fixtureExternalIds: [REPLAY_FIXTURE] });
    expect(live.ok).toBe(true);
    expect(live.ok && live.data.length).toBe(0);
  });

  it('is deterministic: the same call twice gives the same answer', async () => {
    const once = await adapter.getFixtureDetail(REPLAY_FIXTURE);
    const twice = await adapter.getFixtureDetail(REPLAY_FIXTURE);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('reports honestly when the recordings are not in this build', () => {
    expect(replayAvailable('api_football')).toBe(true);
    expect(replayAvailable('api_football', join(__dirname, 'nowhere'))).toBe(false);
    expect(recordingsDir('football_data_org', '/root')).toContain('football-data-org');
  });
});
