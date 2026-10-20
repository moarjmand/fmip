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
      ['country', 'id', 'kind', 'logo', 'name', 'order', 'scope', 'short_name'].sort(),
    );
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
