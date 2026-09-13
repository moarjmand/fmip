import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { SearchResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { SearchModule } from './search.module';

// Searching in Arabic script (T-152).
//
// The gap this closes was measured, not guessed: the seeded Persian alias for
// Manchester United scored 0.467 against the same name typed with Arabic letter
// forms, against a 0.45 threshold. A near-miss is worse than a clean failure —
// it works for one name and not the next, and nobody can tell why.
//
// What is deliberately *not* claimed: folding is not transliteration. An Arabic
// spelling finds an entity because somebody recorded that alias, never because
// a rule guessed it.
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const TEAM = randomUUID();
const PERSON = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'searching in Arabic script',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    async function search(q: string): Promise<SearchResponse> {
      const response = await app.inject({
        method: 'GET',
        url: `/search?q=${encodeURIComponent(q)}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json() as SearchResponse;
    }

    const found = (results: SearchResponse, id: string): boolean =>
      results.results.some((r) => r.id === id);

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(`INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men')`, [
        TEAM,
        `Arabic Search FC ${RUN}`,
      ]);
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $2)`, [
        PERSON,
        `Arabic Search Player ${RUN}`,
      ]);

      // The alias is written with Persian letter forms, as the existing seed's
      // aliases are. A reader typing the Arabic forms must still find it.
      await pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, $2, 'fa', 'transliteration', 'test'),
                ('person', $3, $4, 'ar', 'transliteration', 'test')`,
        [TEAM, `کلوب ${RUN}`, PERSON, `لاعب ${RUN}`],
      );

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, SearchModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM entity_alias WHERE source = 'test' AND alias LIKE $1`, [
        `%${RUN}%`,
      ]);
      await pool.query(`DELETE FROM person WHERE id = $1`, [PERSON]);
      await pool.query(`DELETE FROM team WHERE id = $1`, [TEAM]);
      await pool.end();
      await app.close();
    });

    it('finds an entity from its alias written in either letter form', async () => {
      // Persian keheh (ک, U+06A9) as stored.
      expect(found(await search(`کلوب ${RUN}`), TEAM)).toBe(true);
      // Arabic kaf (ك, U+0643) as a reader of Arabic would type it. Before the
      // fold these were different strings; they look nearly identical.
      expect(found(await search(`كلوب ${RUN}`), TEAM)).toBe(true);
    });

    it('is unaffected by the marks a reader does not type', async () => {
      // Harakat are optional in writing and almost never typed into a search
      // box; tatweel is decoration.
      expect(found(await search(`لاعِب ${RUN}`), PERSON)).toBe(true);
      expect(found(await search(`لاـعب ${RUN}`), PERSON)).toBe(true);
    });

    it('still finds the entity by its Latin name', async () => {
      // The fold must not cost anything on the script the catalogue is in.
      expect(found(await search(`Arabic Search FC ${RUN}`), TEAM)).toBe(true);
      expect(found(await search(`Arabic Search Player ${RUN}`), PERSON)).toBe(true);
    });

    it('does not invent a match across scripts', async () => {
      // Folding is not transliteration. An Arabic query finds this team because
      // an alias was recorded, and an unrelated Arabic word must not find it
      // just because both are Arabic.
      //
      // Deliberately without the run suffix: including it would share a token
      // with the alias, and the match would come from that rather than from the
      // Arabic — which is how the first version of this test passed for the
      // wrong reason.
      expect(found(await search('مدرسة'), TEAM)).toBe(false);
      // And the Latin name of this team does not answer an unrelated word either.
      expect(found(await search('Unrelated Query Words'), TEAM)).toBe(false);
    });
  },
);
