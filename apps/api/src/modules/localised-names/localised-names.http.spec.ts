import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const MIGRATION = '1765853000000_english-club-names.sql';
const MORE = '1765861000000_english-club-names-more.sql';
const PERSIAN_CLUBS = '1765867000000_persian-club-names.sql';
const PERSIAN_CLUBS_EUROPE = '1765868000000_persian-club-names-europe.sql';
const PERSIAN_CLUBS_CUPS = '1765869000000_persian-club-names-cups.sql';
const PERSIAN_CLUBS_FA_CUP = '1765870000000_persian-club-names-fa-cup.sql';

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

    it("names a country without an ISO code by its national team's name row (T-1346)", async () => {
      // QQ? is no FIFA code, so the test never meets a real country.
      const code = `QQ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
      const country = randomUUID();
      const team = randomUUID();
      await pool.query(`INSERT INTO country (id, code, name) VALUES ($1, $2, $3)`, [
        country,
        code,
        `Test Nation ${RUN}`,
      ]);
      try {
        const names = app.get(LocalisedNamesService);
        const payload = { group: { country: { id: country, name: `Test Nation ${RUN}` } } };
        // No ISO code and no team: its own name.
        expect((await names.localise(payload, 'fa')).group.country.name).toBe(`Test Nation ${RUN}`);
        await pool.query(
          `INSERT INTO team (id, name, kind, gender, country_id) VALUES ($1, $2, 'national', 'men', $3)`,
          [team, `Test Nation ${RUN}`, country],
        );
        await pool.query(
          `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
           VALUES ('team', $1, 'ملت آزمایشی', 'fa', 'name', 'test')`,
          [team],
        );
        expect((await names.localise(payload, 'fa')).group.country.name).toBe('ملت آزمایشی');
        expect((await names.localise(payload, 'en')).group.country.name).toBe(`Test Nation ${RUN}`);
      } finally {
        await pool.query(`DELETE FROM entity_alias WHERE entity_id = $1`, [team]);
        await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
        await pool.query(`DELETE FROM country WHERE id = $1`, [country]);
      }
    });

    it("names a club in English from its 'en' name row, and nowhere else (T-1395)", async () => {
      await pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, $2, 'en', 'name', 'test')`,
        [BETA, `Beta English ${RUN}`],
      );
      try {
        const { card } = ours(await scores('en'));
        expect(card.away).toMatchObject({ id: BETA, name: `Beta English ${RUN}` });
        // No English row for the other club: its own name, short form kept.
        expect(card.home).toMatchObject({ name: `Test Alpha ${RUN}`, short_name: 'ALP' });
        // Persian and a caller without a locale never see the English row.
        expect(ours(await scores('fa')).card.away.name).toBe(`Test Beta ${RUN}`);
        expect(ours(await scores('')).card.away.name).toBe(`Test Beta ${RUN}`);
      } finally {
        await pool.query(
          `DELETE FROM entity_alias WHERE entity_id = $1 AND language = 'en' AND source = 'test'`,
          [BETA],
        );
      }
    });

    it("writes the English club names by the provider's id, never by the name (D-210)", async () => {
      // The migration's own up section, run again inside a transaction that is
      // rolled back, against a club stored under the feed's name and mapped to
      // the provider's id for Bayern Munich. A database that already maps that
      // id to a real club has nothing to prove here and is left alone.
      const sql = readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', MIGRATION),
        'utf8',
      );
      const up = sql.slice(0, sql.indexOf('-- Down Migration'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `SELECT 1 FROM provider_mapping
            WHERE provider = 'api_football' AND entity_type = 'team' AND external_id IN ('157', '505')`,
        );
        if (rowCount !== 0) return;
        const bayern = randomUUID();
        const namesake = randomUUID();
        await client.query(
          `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, 'Bayern München', 'club', 'men'), ($2, 'Bayern Munich', 'club', 'men')`,
          [bayern, namesake],
        );
        await client.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id) VALUES
           ('api_football', 'team', '157', $1), ('api_football', 'team', '505', $2)`,
          [bayern, namesake],
        );
        await client.query(up);
        const { rows } = await client.query<{ entity_id: string; alias: string }>(
          `SELECT entity_id::text, alias FROM entity_alias
            WHERE entity_id = ANY($1::uuid[]) AND kind = 'name' AND language = 'en'`,
          [[bayern, namesake]],
        );
        // Found by id 157; the other club carries the same stored name as the
        // English one but a different id, and gets nothing.
        expect(rows).toEqual([{ entity_id: bayern, alias: 'Bayern Munich' }]);
        // Running it twice writes nothing more.
        await client.query(up);
        const again = await client.query(
          `SELECT 1 FROM entity_alias WHERE entity_id = $1 AND kind = 'name' AND language = 'en'`,
          [bayern],
        );
        expect(again.rowCount).toBe(1);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('writes the remaining English club names by id and re-reads their news links (D-215)', async () => {
      // Migration 1765861000000's up section, run again inside a transaction
      // that is rolled back: "Derby" (the provider's 69) becomes Derby County,
      // a club that already has an English name (62 here) keeps it, and a
      // stored link the longer name now refuses ("Fla-Flu, Derby and Gre-Nal")
      // goes. A database that already maps those ids is left alone.
      const sql = readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', MORE),
        'utf8',
      );
      const up = sql.slice(0, sql.indexOf('-- Down Migration'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `SELECT 1 FROM provider_mapping
            WHERE provider = 'api_football' AND entity_type = 'team' AND external_id IN ('69', '62')`,
        );
        if (rowCount !== 0) return;
        const derby = randomUUID();
        const sheffield = randomUUID();
        await client.query(
          `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, 'Derby', 'club', 'men'), ($2, 'Sheffield Utd', 'club', 'men')`,
          [derby, sheffield],
        );
        await client.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id) VALUES
           ('api_football', 'team', '69', $1), ('api_football', 'team', '62', $2)`,
          [derby, sheffield],
        );
        await client.query(
          `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
           VALUES ('team', $1, 'Sheffield United FC', 'en', 'name', 'test')`,
          [sheffield],
        );
        const source = await client.query<{ id: string }>(
          `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
           VALUES ($1, 'https://names.test', NULL, 'licensed', 'summary', 'en') RETURNING id`,
          [`Names ${RUN}`],
        );
        const story = await client.query<{ id: string }>(
          `INSERT INTO story DEFAULT VALUES RETURNING id`,
        );
        const article = await client.query<{ id: string }>(
          `INSERT INTO article (source_id, story_id, external_id, url)
           VALUES ($1, $2, $3, $3) RETURNING id`,
          [source.rows[0]!.id, story.rows[0]!.id, `https://names.test/${RUN}`],
        );
        const articleId = article.rows[0]!.id;
        await client.query(
          `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
           VALUES ($1, 'en', 1, '⚔️ Fla-Flu, Derby and Gre-Nal: share your predictions for today’s derbies',
                   'The Brasileirão will feature THREE derbies this Sunday.', now())`,
          [articleId],
        );
        await client.query(
          `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
          [articleId, derby],
        );
        await client.query(up);
        const { rows } = await client.query<{ entity_id: string; alias: string }>(
          `SELECT entity_id::text, alias FROM entity_alias
            WHERE entity_id = ANY($1::uuid[]) AND kind = 'name' AND language = 'en'
            ORDER BY alias`,
          [[derby, sheffield]],
        );
        expect(rows).toEqual([
          { entity_id: derby, alias: 'Derby County' },
          { entity_id: sheffield, alias: 'Sheffield United FC' },
        ]);
        const links = await client.query(`SELECT 1 FROM article_entity WHERE article_id = $1`, [
          articleId,
        ]);
        expect(links.rowCount).toBe(0);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    // Each Persian club-name migration: a club mapped to a listed id, a
    // namesake under another id and a national team under a listed id.
    const PERSIAN_CASES = [
      {
        task: 'T-1420',
        file: PERSIAN_CLUBS,
        id: '541',
        name: 'Real Madrid',
        fa: 'رئال مادرید',
        national: '2939',
      },
      {
        task: 'T-1421',
        file: PERSIAN_CLUBS_EUROPE,
        id: '247',
        name: 'Celtic',
        fa: 'سلتیک',
        national: '575',
      },
      {
        task: 'T-1423',
        file: PERSIAN_CLUBS_CUPS,
        id: '161',
        name: 'Wolfsburg',
        fa: 'ولفسبورگ',
        national: '400',
      },
      {
        task: 'T-1424',
        file: PERSIAN_CLUBS_FA_CUP,
        id: '1377',
        name: 'Yeovil Town',
        fa: 'یوویل تاون',
        national: '1819',
      },
    ];
    it.each(PERSIAN_CASES)(
      "writes the Persian club names by the provider's id, for clubs only ($task)",
      async (club) => {
        // The up section again, rolled back: a club mapped to Real Madrid's id,
        // a namesake club under another id and a national team under an id the
        // list holds. Only the first is named.
        const sql = readFileSync(
          join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations', club.file),
          'utf8',
        );
        const up = sql.slice(0, sql.indexOf('-- Down Migration'));
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { rowCount } = await client.query(
            `SELECT 1 FROM provider_mapping
            WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = ANY($1::text[])`,
            [[club.id, club.national, `9999${club.id}`]],
          );
          if (rowCount !== 0) return;
          const madrid = randomUUID();
          const namesake = randomUUID();
          const side = randomUUID();
          await client.query(
            `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $3, 'club', 'men'), ($2, $3, 'club', 'men')`,
            [madrid, namesake, club.name],
          );
          await client.query(
            `INSERT INTO team (id, name, kind, gender, country_id)
           SELECT $1, 'Al-Nassr', 'national', 'men', c.id FROM country c
            WHERE NOT EXISTS (SELECT 1 FROM team t WHERE t.country_id = c.id AND t.kind = 'national')
            ORDER BY c.code LIMIT 1`,
            [side],
          );
          await client.query(
            `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id) VALUES
           ('api_football', 'team', $4, $1), ('api_football', 'team', $5, $2),
           ('api_football', 'team', $6, $3)`,
            [madrid, namesake, side, club.id, `9999${club.id}`, club.national],
          );
          await client.query(up);
          const { rows } = await client.query<{ entity_id: string; alias: string }>(
            `SELECT entity_id::text, alias FROM entity_alias
            WHERE entity_id = ANY($1::uuid[]) AND kind = 'name' AND language = 'fa'`,
            [[madrid, namesake, side]],
          );
          expect(rows).toEqual([{ entity_id: madrid, alias: club.fa }]);
          await client.query(up);
          const again = await client.query(
            `SELECT 1 FROM entity_alias WHERE entity_id = $1 AND kind = 'name' AND language = 'fa'`,
            [madrid],
          );
          expect(again.rowCount).toBe(1);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

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
