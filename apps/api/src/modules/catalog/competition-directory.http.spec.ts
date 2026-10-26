import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionDirectoryResponse } from '@fmip/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule, PG_POOL } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const LA_LIGA = '00000000-0000-4000-8000-000000000202';
const PRO_LEAGUE = '00000000-0000-4000-8000-000000000203';
const UCL = '00000000-0000-4000-8000-000000000205';

/**
 * A language subtag no product locale uses, so the order this spec states is
 * its own and a parallel spec's order for `en` is never read or disturbed.
 */
const LANGUAGE = 'zq';

/**
 * `GET /competitions/directory` (T-1433): the header's competitions bar and
 * the All competitions page read every active competition from here, with
 * its country, in the product's order for the reader's language (D-207).
 */
describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('competitions directory', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get<Pool>(PG_POOL);
    await pool.query(`DELETE FROM competition_display_order WHERE locale = $1`, [LANGUAGE]);
    await pool.query(
      `INSERT INTO competition_display_order (competition_id, locale, position)
         VALUES ($1, $3, 1), ($2, $3, 2)`,
      [LA_LIGA, PRO_LEAGUE, LANGUAGE],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM competition_display_order WHERE locale = $1`, [LANGUAGE]);
    await app.close();
  });

  const directory = async (query = '') => {
    const response = await app.inject({ method: 'GET', url: `/competitions/directory${query}` });
    expect(response.statusCode).toBe(200);
    return (response.json() as CompetitionDirectoryResponse).competitions;
  };

  it('names each competition with its country, scope and kind, and no provider field', async () => {
    const all = await directory();
    const premier = all.find((c) => c.id === PREMIER_LEAGUE);
    expect(premier).toMatchObject({
      name: 'Premier League',
      short_name: 'PL',
      scope: 'domestic',
      kind: 'league',
      country: { name: 'England', code: 'ENG' },
    });
    // A continental competition belongs to no country; nothing is invented.
    expect(all.find((c) => c.id === UCL)).toMatchObject({ scope: 'continental', country: null });
    // The logo is a coverage state, never a provider address (rule 2).
    expect(premier?.logo.coverage).toMatch(/^(available|not_supplied)$/);
    expect(Object.keys(premier ?? {}).sort()).toEqual(
      [
        'country',
        'id',
        'kind',
        'logo',
        'name',
        'next_kickoff_at',
        'order',
        'scope',
        'season',
        'short_name',
      ].sort(),
    );
    // The current season as the competition page names it (T-1612); the seed's
    // Premier League has one, and a label is never invented for none.
    expect(premier?.season).toMatch(/^\d{4}(\/\d{2})?$/);
    for (const c of all) expect(c.season === null || typeof c.season === 'string').toBe(true);
  });

  it('gives each country its flag from our own origin, and a competition of no country none (T-1611)', async () => {
    const SPAIN = '00000000-0000-4000-8000-000000000102';
    const sha = 'f1a9'.repeat(16);
    await pool.query(`DELETE FROM entity_media WHERE entity_type = 'country' AND entity_id = $1`, [
      SPAIN,
    ]);
    try {
      await pool.query(
        `INSERT INTO entity_media
           (entity_type, entity_id, kind, source_provider, source_url, state, storage_key,
            content_type, byte_size, sha256, source_fetched_at, last_checked_at)
         VALUES ('country', $1, 'flag', 'api_football', 'https://media.api-sports.io/flags/es.svg',
                 'available', $2, 'image/svg+xml', 1200, $3, now(), now())`,
        [SPAIN, `${sha.slice(0, 2)}/${sha}.svg`, sha],
      );
      const response = await app.inject({ method: 'GET', url: '/competitions/directory' });
      const all = (response.json() as CompetitionDirectoryResponse).competitions;
      expect(all.find((c) => c.id === LA_LIGA)?.country).toEqual({
        id: SPAIN,
        name: 'Spain',
        code: 'ESP',
        flag: { coverage: 'available', url: `/api/media/flag/${SPAIN}/${sha.slice(0, 12)}.svg` },
      });
      // A country with no stored flag says so; one of no country has no flag at all.
      expect(all.find((c) => c.id === PREMIER_LEAGUE)?.country?.flag?.coverage).toMatch(
        /^(available|not_supplied)$/,
      );
      expect(all.find((c) => c.id === UCL)?.country).toBeNull();
      expect(response.body).not.toContain('api-sports.io');
    } finally {
      await pool.query(
        `DELETE FROM entity_media WHERE entity_type = 'country' AND entity_id = $1`,
        [SPAIN],
      );
    }
  });

  it('names each competition its next kick-off: the earliest scheduled match ahead, else null (T-1623)', async () => {
    // Two competitions of this spec's own, so no other spec's matches count.
    const id = {
      ahead: '00000000-0000-4000-8000-0000016230a1',
      none: '00000000-0000-4000-8000-0000016230a2',
      current: '00000000-0000-4000-8000-0000016230b1',
      next: '00000000-0000-4000-8000-0000016230b2',
      over: '00000000-0000-4000-8000-0000016230b3',
    };
    const fixtures = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-0000016230c${n}`);
    const cleanUp = async () => {
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
        [id.current, id.next, id.over],
      ]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[id.ahead, id.none]]);
    };
    await cleanUp();
    try {
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender) VALUES
           ($1, 'T-1623 Ahead', 'league', 'international', 'men'),
           ($2, 'T-1623 Nothing', 'cup', 'international', 'men')`,
        [id.ahead, id.none],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
           ($1, $4, '2026/27', '2026-08-01', '2027-05-31', true),
           ($2, $4, '2027/28', '2027-08-01', '2028-05-31', false),
           ($3, $5, '2026', '2026-01-01', '2026-12-31', true)`,
        [id.current, id.next, id.over, id.ahead, id.none],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
           -- A match whose kick-off has passed is not ahead, whatever its status says.
           ($1, $6, now() - interval '2 hours', 'scheduled'),
           -- A postponed match has no kick-off to count on.
           ($2, $6, now() + interval '1 day', 'postponed'),
           -- The earliest scheduled match ahead, in a season not the current one.
           ($3, $7, now() + interval '3 days', 'scheduled'),
           ($4, $6, now() + interval '9 days', 'scheduled'),
           -- The other competition played its last match.
           ($5, $8, now() - interval '5 days', 'finished')`,
        [...fixtures, id.current, id.next, id.over],
      );
      const { rows } = await pool.query<{ at: Date }>(
        `SELECT kickoff_at AS at FROM fixture WHERE id = $1`,
        [fixtures[2]],
      );

      const all = await directory();
      expect(all.find((c) => c.id === id.ahead)?.next_kickoff_at).toBe(rows[0]?.at.toISOString());
      expect(all.find((c) => c.id === id.none)?.next_kickoff_at).toBeNull();
      // Every answer is an instant or null, never a guess.
      for (const c of all) {
        expect(
          c.next_kickoff_at === null || !Number.isNaN(Date.parse(c.next_kickoff_at ?? '')),
        ).toBe(true);
      }
    } finally {
      await cleanUp();
    }
  });

  it("reads the language's own order, every unplaced competition after it", async () => {
    // `zq-GB` reads the `zq` order, as `en-GB` reads `en` (D-207).
    const all = await directory(`?locale=${LANGUAGE}-GB`);
    expect(all.slice(0, 2).map((c) => [c.id, c.order])).toEqual([
      [LA_LIGA, 1],
      [PRO_LEAGUE, 2],
    ]);
    // A competition the language does not place has no place at all, not
    // the default one: the order is whole per language.
    expect(all.slice(2).every((c) => c.order === null)).toBe(true);
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([PREMIER_LEAGUE, UCL]));
  });

  it('reads the default order for a language with none of its own', async () => {
    const all = await directory('?locale=tr');
    const stated = all.filter((c) => c.order !== null).map((c) => c.order ?? 0);
    expect(stated).toEqual([...stated].sort((a, b) => a - b));
    // Placed first, then the rest.
    const firstUnplaced = all.findIndex((c) => c.order === null);
    if (firstUnplaced >= 0) {
      expect(all.slice(firstUnplaced).every((c) => c.order === null)).toBe(true);
    }
  });
});
