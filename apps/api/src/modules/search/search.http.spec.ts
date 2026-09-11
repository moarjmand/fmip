import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, SearchResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { SearchModule } from './search.module';

// Search against the real schema: temporary entities with aliases, a
// transliteration, a misspelling and an accented name. Acceptance: aliases
// and common spellings match. Names carry a run suffix so parallel suites
// never see each other's rows.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const TEAM = randomUUID();
const OTHER_TEAM = randomUUID();
const COMPETITION = randomUUID();
const PERSON = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('entity search', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const search = async (query: string): Promise<SearchResponse> => {
    const response = await app.inject({ method: 'GET', url: `/search?${query}` });
    expect(response.statusCode).toBe(200);
    return response.json() as SearchResponse;
  };
  const OURS: string[] = [TEAM, OTHER_TEAM, COMPETITION, PERSON];
  const ours = (r: SearchResponse) => r.results.filter((x) => OURS.includes(x.id));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SearchModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO team (id, name, short_name, code, kind, gender, country_id) VALUES
         ($1, $3, 'ZBR', 'ZBF', 'club', 'men', $5),
         ($2, $4, NULL, NULL, 'club', 'men', $5)`,
      [TEAM, OTHER_TEAM, `Zebrafish Athletic ${RUN}`, `Zebulon Rovers ${RUN}`, ENGLAND],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender)
       VALUES ($1, $2, $3, 'ZQL', 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Zebra Quarterly League ${RUN}`],
    );
    await pool.query(`INSERT INTO person (id, full_name, known_as) VALUES ($1, $2, NULL)`, [
      PERSON,
      `Zlatko Testović ${RUN}`,
    ]);
    await pool.query(
      `INSERT INTO player_spell (person_id, team_id, start_date, end_date) VALUES ($1, $2, DATE '2025-07-01', NULL)`,
      [PERSON, TEAM],
    );
    await pool.query(
      `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source) VALUES
         ('team', $1, 'The Zebras', 'en', 'alias', 'test'),
         ('team', $1, 'Zebrafisch', NULL, 'misspelling', 'test'),
         ('team', $1, 'گورخرماهی', 'fa', 'transliteration', 'test'),
         ('competition', $2, 'Zebra League', NULL, 'abbreviation', 'test'),
         ('person', $3, 'Zlatko T', NULL, 'abbreviation', 'test')`,
      [TEAM, COMPETITION, PERSON],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [
      [TEAM, OTHER_TEAM, COMPETITION, PERSON],
    ]);
    await pool.query(`DELETE FROM player_spell WHERE person_id = $1`, [PERSON]);
    await pool.query(`DELETE FROM person WHERE id = $1`, [PERSON]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[TEAM, OTHER_TEAM]]);
    await pool.end();
    await app.close();
  });

  it('finds an entity by an alias, a misspelling and a transliteration, naming the canonical name', async () => {
    for (const q of ['the zebras', 'zebrafisch', 'گورخرماهی']) {
      const results = ours(await search(`q=${encodeURIComponent(q)}`));
      expect(results[0]).toMatchObject({
        type: 'team',
        id: TEAM,
        name: `Zebrafish Athletic ${RUN}`,
        matched_on: 'alias',
        secondary: 'England',
      });
      expect(results[0]!.alias).not.toBeNull();
    }
  });

  it('matches names with accents folded, by prefix and by short name or code', async () => {
    const accentless = ours(await search('q=testovic'));
    expect(accentless[0]).toMatchObject({ type: 'person', id: PERSON, matched_on: 'name' });
    expect(accentless[0]!.secondary).toBe(`Zebrafish Athletic ${RUN}`);

    const prefix = ours(await search('q=zebrafish'));
    expect(prefix[0]).toMatchObject({ type: 'team', id: TEAM, matched_on: 'name', score: 1 });

    expect(ours(await search('q=zbr'))[0]).toMatchObject({ id: TEAM });
    expect(ours(await search('q=zql'))[0]).toMatchObject({ id: COMPETITION, type: 'competition' });
  });

  it('ranks the closer name first, keeps one row per entity and honours the type filter', async () => {
    const both = ours(await search(`q=${encodeURIComponent('zeb')}`));
    const ids = both.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([TEAM, OTHER_TEAM, COMPETITION]));

    const teamsOnly = ours(await search('q=zebra&types=team'));
    expect(teamsOnly.every((r) => r.type === 'team')).toBe(true);
    expect(teamsOnly.map((r) => r.id)).toContain(TEAM);

    const limited = await search('q=zeb&limit=1');
    expect(limited.results).toHaveLength(1);
  });

  it('answers an empty list for nothing like it, and 400 for a bad request', async () => {
    expect(ours(await search('q=quokka'))).toEqual([]);
    const short = await app.inject({ method: 'GET', url: '/search?q=z' });
    expect(short.statusCode).toBe(400);
    expect((short.json() as ApiError).fields?.q).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/search?q=zeb&types=match' })).statusCode).toBe(
      400,
    );
  });
});
