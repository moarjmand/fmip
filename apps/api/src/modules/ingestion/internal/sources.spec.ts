import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { BudgetedTransport, HIGHLIGHTLY_DEFAULT_BUDGET, resolveSources } from './sources';

const RECORDINGS = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'ingestion',
  'src',
  'adapters',
  '_fixtures',
);

function counting(): { transport: Transport; calls: () => number } {
  let calls = 0;
  return {
    transport: {
      async request(): Promise<TransportResponse> {
        calls += 1;
        return { status: 200, body: {}, receivedAt: new Date().toISOString() };
      },
    },
    calls: () => calls,
  };
}

describe('which provider answers which job (D-049)', () => {
  it('defaults to replay, which needs no key', () => {
    const sources = resolveSources({}, { recordingsRoot: RECORDINGS });
    expect(sources.kind).toBe('replay');
    expect(sources.reason).toBeNull();
    for (const job of ['fixtures', 'live', 'lineups', 'standings', 'post_match'] as const) {
      expect(sources.forJob(job)?.provider).toBe('api_football');
    }
  });

  it('splits the live profile by module and never blends the two providers', () => {
    const sources = resolveSources({
      INGESTION_SOURCE: 'live',
      FOOTBALL_DATA_ORG_KEY: 'spine',
      HIGHLIGHTLY_KEY: 'detail',
    });
    expect(sources.kind).toBe('live');
    expect(sources.reason).toBeNull();
    expect(sources.forJob('fixtures')?.provider).toBe('football_data_org');
    expect(sources.forJob('live')?.provider).toBe('football_data_org');
    expect(sources.forJob('standings')?.provider).toBe('football_data_org');
    expect(sources.forJob('lineups')?.provider).toBe('highlightly');
    expect(sources.forJob('post_match')?.provider).toBe('highlightly');
  });

  it('says which half is missing when only one key is set', () => {
    const spineOnly = resolveSources({
      INGESTION_SOURCE: 'live',
      FOOTBALL_DATA_ORG_KEY: 'spine',
    });
    expect(spineOnly.kind).toBe('live');
    expect(spineOnly.reason).toContain('lineups and incidents have no source');
    expect(spineOnly.forJob('lineups')).toBeNull();
    expect(spineOnly.forJob('fixtures')).not.toBeNull();

    const detailOnly = resolveSources({ INGESTION_SOURCE: 'live', HIGHLIGHTLY_KEY: 'detail' });
    expect(detailOnly.reason).toContain('fixtures, live and standings have no source');
    expect(detailOnly.forJob('fixtures')).toBeNull();
  });

  it('is off, with a reason, when nothing is configured or the name is wrong', () => {
    expect(resolveSources({ INGESTION_SOURCE: 'off' })).toMatchObject({ kind: 'off' });
    expect(resolveSources({ INGESTION_SOURCE: 'live' }).reason).toContain('neither');
    expect(resolveSources({ INGESTION_SOURCE: 'espn' }).reason).toContain(
      'is not one of replay, live, off',
    );
    const noRecordings = resolveSources(
      { INGESTION_SOURCE: 'replay' },
      { recordingsRoot: join(RECORDINGS, 'nowhere') },
    );
    expect(noRecordings.kind).toBe('off');
    expect(noRecordings.reason).toContain('no recordings are present');
  });
});

describe('the Highlightly daily budget', () => {
  it('spends up to the ceiling, then answers 429 instead of calling the provider', async () => {
    const inner = counting();
    const transport = new BudgetedTransport(inner.transport, 3);

    for (let i = 0; i < 3; i += 1) {
      expect((await transport.request('https://example.test')).status).toBe(200);
    }
    expect(transport.remaining).toBe(0);

    const refused = await transport.request('https://example.test');
    expect(refused.status).toBe(429);
    expect(JSON.stringify(refused.body)).toContain('daily request budget of 3 spent');
    // The provider was never asked: the ceiling is enforced here, not there.
    expect(inner.calls()).toBe(3);
  });

  it('resets at the UTC day boundary, which is when the free plans reset', async () => {
    const inner = counting();
    let now = new Date('2026-09-12T23:59:00Z');
    const transport = new BudgetedTransport(inner.transport, 1, () => now);

    expect((await transport.request('https://example.test')).status).toBe(200);
    expect((await transport.request('https://example.test')).status).toBe(429);

    now = new Date('2026-09-13T00:01:00Z');
    expect(transport.remaining).toBe(1);
    expect((await transport.request('https://example.test')).status).toBe(200);
    expect(inner.calls()).toBe(2);
  });

  it('defaults to the hundred a day the free plan allows', () => {
    expect(HIGHLIGHTLY_DEFAULT_BUDGET).toBe(100);
  });
});
