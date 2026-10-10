import type { NormalisedFixture, NormalisedIncident, NormalisedLineup } from '@fmip/ingestion';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { PollTarget, RefResolver } from './ingest-store';
import { IngestStore } from './ingest-store';

/**
 * An id a reviewer has set aside (`ignored`, T-1338) against one still
 * waiting for review, with no database: the resolver is a table of answers
 * and the pool records what was asked of it.
 */

const TARGET: PollTarget = {
  competitionId: 'c0000000-0000-4000-8000-000000000001',
  competitionExternalId: '10',
  seasonId: 's0000000-0000-4000-8000-000000000001',
  seasonLabel: '2026',
  seasonStart: '2026-01-01',
  seasonEnd: '2026-12-31',
};

function resolverOf(answers: Record<string, 'ignored' | 'queued' | string>): RefResolver {
  return {
    resolve: (ref) => {
      const answer = answers[`${ref.entityType}:${ref.externalId}`] ?? 'queued';
      if (answer === 'ignored' || answer === 'queued') return Promise.resolve({ kind: answer });
      return Promise.resolve({ kind: 'resolved', internalId: answer });
    },
    link: () => Promise.resolve({ kind: 'linked' }),
  };
}

/** A pool that answers every statement with one row `{ id: 'participant' }` and logs the SQL. */
function recordingPool(): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  const query = (sql: string) => {
    statements.push(sql);
    return Promise.resolve({ rows: [{ id: 'participant' }], rowCount: 0 });
  };
  return {
    pool: { query, connect: () => Promise.reject(new Error('no transaction expected')) } as never,
    statements,
  };
}

function fixtureBetween(home: string, away: string): NormalisedFixture {
  return {
    externalId: '900',
    competition: { externalId: '10', name: 'Friendlies' },
    season: { label: '2026' },
    stage: null,
    round: null,
    kickoffAt: '2026-10-01T18:00:00Z',
    status: 'scheduled',
    minute: null,
    home: { externalId: home, name: `Team ${home}` },
    away: { externalId: away, name: `Team ${away}` },
    venue: null,
    referee: null,
    scores: {
      current: null,
      halfTime: null,
      fullTime: null,
      extraTime: null,
      penalties: null,
      aggregate: null,
    },
  } as unknown as NormalisedFixture;
}

describe('the ingest store and ids set aside (T-1338)', () => {
  it('skips a fixture with an ignored side without reporting either side', async () => {
    const { pool, statements } = recordingPool();
    const store = new IngestStore(pool, resolverOf({ 'team:1': 'ignored' }));

    // The other side is unknown too: the match is out of coverage all the same.
    const write = await store.saveFixture('api_football', TARGET, fixtureBetween('1', '2'), 'live');

    expect(write).toEqual({ changed: 0, unresolved: [] });
    expect(statements).toEqual([]);
  });

  it('skips it when the ignored side is away and the home side is ours', async () => {
    const { pool, statements } = recordingPool();
    const store = new IngestStore(
      pool,
      resolverOf({ 'team:1': '00000000-0000-4000-8000-0000000000aa', 'team:2': 'ignored' }),
    );

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      fixtureBetween('1', '2'),
      'fixtures',
    );

    expect(write).toEqual({ changed: 0, unresolved: [] });
    expect(statements).toEqual([]);
  });

  it('still reports a side nobody has reviewed', async () => {
    const { pool } = recordingPool();
    const store = new IngestStore(
      pool,
      resolverOf({ 'team:1': '00000000-0000-4000-8000-0000000000aa' }),
    );

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      fixtureBetween('1', '2'),
      'fixtures',
    );

    expect(write).toEqual({ changed: 0, unresolved: ['team:2'] });
  });

  it('skips an ignored player in a line-up without reporting them, and reports an unknown one', async () => {
    const { pool, statements } = recordingPool();
    const store = new IngestStore(pool, resolverOf({ 'person:7': 'ignored' }));
    const side = {
      formation: null,
      coach: null,
      players: [
        { externalId: '7', name: 'Set aside' },
        { externalId: '8', name: 'Unknown' },
      ],
    };
    const lineup = { home: side, away: { ...side, players: [] } } as unknown as NormalisedLineup;

    const write = await store.saveLineup('api_football', 'fixture', lineup);

    expect(write.unresolved).toEqual(['person:8']);
    expect(statements.some((sql) => sql.includes('INSERT INTO lineup'))).toBe(false);
  });

  it('moves a shirt the provider gave to another player, and drops a player it no longer lists', async () => {
    // Provider fixture 1528919: Denmark's 13 was corrected from one player to
    // another after the first line-up was stored (T-539).
    const { pool, statements } = recordingPool();
    const store = new IngestStore(
      pool,
      resolverOf({ 'person:533': '00000000-0000-4000-8000-000000000533' }),
    );
    const side = {
      formation: null,
      coach: null,
      players: [{ externalId: '533', name: 'Corrected', shirtNumber: 13 }],
    };
    const lineup = { home: side, away: { ...side, players: [] } } as unknown as NormalisedLineup;

    await store.saveLineup('api_football', 'fixture', lineup);

    const lineupSql = statements.filter(
      (sql) => sql.includes(' lineup ') && !sql.includes('formation'),
    );
    expect(lineupSql.map((sql) => sql.trim().split(/\s+/)[0])).toEqual([
      'DELETE',
      'UPDATE',
      'INSERT',
    ]);
    expect(lineupSql[1]).toContain('SET shirt_number = NULL');
  });

  it('removes nothing when the feed lists no player for a side', async () => {
    const { pool, statements } = recordingPool();
    const store = new IngestStore(pool, resolverOf({}));
    const empty = { formation: null, coach: null, players: [] };
    const lineup = { home: empty, away: empty } as unknown as NormalisedLineup;

    await store.saveLineup('api_football', 'fixture', lineup);

    expect(statements.some((sql) => sql.includes('DELETE FROM lineup'))).toBe(false);
  });
});

describe('the incident list is the whole truth for its fixture (T-1382)', () => {
  function paramsPool(): { pool: Pool; calls: { sql: string; params: unknown[] }[] } {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query = (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [{ id: 'participant' }], rowCount: 0 });
    };
    return { pool: { query } as never, calls };
  }
  const goal = (sequence: number, player: string): NormalisedIncident =>
    ({
      fixtureExternalId: '900',
      sequence,
      minute: sequence * 10,
      addedTime: null,
      kind: 'goal',
      side: 'home',
      player: { externalId: player, name: `Player ${player}` },
      relatedPlayer: null,
      detail: 'Normal Goal',
    }) as NormalisedIncident;

  it('deletes every row at a place this answer did not write, a skipped one included', async () => {
    const { pool, calls } = paramsPool();
    // Player 2 is waiting for review, so place 2 is skipped; whatever row
    // stood there, and any row past place 3, is an older incident.
    const store = new IngestStore(
      pool,
      resolverOf({ 'person:1': 'p0000000-0000-4000-8000-000000000001', 'person:3': 'p3' }),
    );
    const write = await store.saveIncidents('api_football', 'fixture', [
      goal(1, '1'),
      goal(2, '2'),
      goal(3, '3'),
    ]);
    expect(write.unresolved).toEqual(['person:2']);
    const deletes = calls.filter((c) => c.sql.includes('DELETE FROM incident'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.params).toEqual(['fixture', [1, 3]]);
  });

  it('deletes nothing on an empty answer', async () => {
    const { pool, calls } = paramsPool();
    const store = new IngestStore(pool, resolverOf({}));
    await store.saveIncidents('api_football', 'fixture', []);
    expect(calls.some((c) => c.sql.includes('DELETE FROM incident'))).toBe(false);
  });
});
