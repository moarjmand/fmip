import type { NormalisedFixture, NormalisedLineup } from '@fmip/ingestion';
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
});
