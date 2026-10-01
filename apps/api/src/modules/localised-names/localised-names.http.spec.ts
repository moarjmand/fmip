import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionPage, ScoresResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FixturesModule } from '../fixtures/fixtures.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { LocalisedNamesModule } from './localised-names.module';
import { LocalisedNamesService } from './localised-names.service';

// Localised names on every surface (T-1312) against the real schema: a
// temporary competition in Spain with two clubs, one of them and the
// competition named in Persian, and one finished match in a window no other
// suite touches. Skipped, visibly, without DATABASE_URL (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

const SPAIN = '00000000-0000-4000-8000-000000000102';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const STAGE = randomUUID();
const ALPHA = randomUUID();
const BETA = randomUUID();
const FIXTURE = randomUUID();
const ALPHA_FA = `آلفا ${RUN}`;
const LEAGUE_FA = `لیگ آزمایشی ${RUN}`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  '?locale= on every surface',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const json = async <T>(url: string): Promise<T> => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      return response.json() as T;
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, LocalisedNamesModule, FixturesModule, CatalogModule],
      })
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender)
       VALUES ($1, $2, $3, 'TLL', 'league', 'domestic', 'men')`,
        [COMPETITION, SPAIN, `Test Locale League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2086/87', DATE '2086-08-01', DATE '2087-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES ($1, $2, 'Regular season', 'league', 1)`,
        [STAGE, SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, short_name, kind, gender) VALUES
         ($1, $3, 'ALP', 'club', 'men'), ($2, $4, 'BET', 'club', 'men')`,
        [ALPHA, BETA, `Test Alpha ${RUN}`, `Test Beta ${RUN}`],
      );
      await pool.query(
        `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES
         ($1, 'scores', 'available', 'api_football'), ($1, 'standings', 'available', 'api_football')`,
        [SEASON],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 1', TIMESTAMPTZ '2087-03-03 18:00:00+00', 'finished')`,
        [FIXTURE, SEASON, STAGE],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, ALPHA, BETA],
      );
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES
         ($1, 'full_time', 2, 1), ($1, 'current', 2, 1)`,
        [FIXTURE],
      );
      await pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source) VALUES
         ('team', $1, $2, 'fa', 'name', 'test'), ('competition', $3, $4, 'fa', 'name', 'test')`,
        [ALPHA, ALPHA_FA, COMPETITION, LEAGUE_FA],
      );
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM coverage_profile WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM stage WHERE id = $1`, [STAGE]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [
        [ALPHA, COMPETITION],
      ]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[ALPHA, BETA]]);
      await pool.end();
      await app.close();
    });

    const scores = (locale: string) =>
      json<ScoresResponse>(
        `/scores?from=2087-03-03&tz=UTC&competition=${COMPETITION}${locale === '' ? '' : `&locale=${locale}`}`,
      );
    const ours = (body: ScoresResponse) => {
      const group = body.groups.find((g) => g.competition.id === COMPETITION);
      expect(group).toBeDefined();
      return { group: group!, card: group!.fixtures.find((c) => c.id === FIXTURE)! };
    };

    it('names the clubs, the competition and the country in Persian on the scores list', async () => {
      const { group, card } = ours(await scores('fa'));
      expect(card.home).toMatchObject({ id: ALPHA, name: ALPHA_FA, short_name: null });
      expect(card.competition).toMatchObject({ name: LEAGUE_FA, short_name: null });
      expect(group.competition.name).toBe(LEAGUE_FA);
      // No Persian spelling yet: the club's own name, never an empty one.
      expect(card.away).toMatchObject({ id: BETA, name: `Test Beta ${RUN}`, short_name: 'BET' });
      // Countries have no alias rows: the CLDR region name for the ISO code.
      expect(group.country?.name).toBe('اسپانیا');
    });

    it('calls a national team what its country is called, unless it has a name row (T-1334)', async () => {
      // Women's, so the test never meets a real senior men's side for Spain.
      const team = randomUUID();
      await pool.query(
        `INSERT INTO team (id, name, kind, gender, country_id) VALUES ($1, $2, 'national', 'women', $3)`,
        [team, `Test Spain ${RUN}`, SPAIN],
      );
      try {
        const names = app.get(LocalisedNamesService);
        const payload = { home: { id: team, name: `Test Spain ${RUN}` } };
        expect((await names.localise(payload, 'fa')).home.name).toBe('اسپانیا');
        // English keeps the team's own name.
        expect((await names.localise(payload, 'en')).home.name).toBe(`Test Spain ${RUN}`);
        await pool.query(
          `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
           VALUES ('team', $1, 'تیم زنان اسپانیا', 'fa', 'name', 'test')`,
          [team],
        );
        expect((await names.localise(payload, 'fa')).home.name).toBe('تیم زنان اسپانیا');
      } finally {
        await pool.query(`DELETE FROM entity_alias WHERE entity_id = $1`, [team]);
        await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
      }
    });

    it('keeps the canonical names without a locale, and with one nobody has written', async () => {
      for (const locale of ['', 'de-x', '!!']) {
        const { group, card } = ours(await scores(locale));
        expect(card.home).toMatchObject({ name: `Test Alpha ${RUN}`, short_name: 'ALP' });
        expect(group.competition.name).toBe(`Test Locale League ${RUN}`);
        expect(group.country?.name).toBe('Spain');
      }
    });

    it('names the table in Persian and keeps the page entity canonical beside its localised name', async () => {
      const page = await json<CompetitionPage>(`/competitions/${COMPETITION}?locale=fa`);
      // T-303's pair stays as it was: the canonical name and the localised one.
      expect(page.competition.name).toBe(`Test Locale League ${RUN}`);
      expect(page.competition.localised_name).toBe(LEAGUE_FA);
      expect(page.competition.country?.name).toBe('اسپانیا');
      const rows = page.table.data ?? [];
      expect(rows.find((r) => r.team.id === ALPHA)?.team.name).toBe(ALPHA_FA);
      expect(rows.find((r) => r.team.id === BETA)?.team.name).toBe(`Test Beta ${RUN}`);
    });

    it('names the table canonically without a locale', async () => {
      const page = await json<CompetitionPage>(`/competitions/${COMPETITION}`);
      expect(page.competition.localised_name).toBeNull();
      expect(page.table.data?.find((r) => r.team.id === ALPHA)?.team.name).toBe(
        `Test Alpha ${RUN}`,
      );
    });
  },
);
