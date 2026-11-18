import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  CoachPage,
  EntityNewsResponse,
  NewsSectionResponse,
  PlayerPage,
  PlayerTransfers,
  SearchResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CardStore } from '../conversations/internal/conversations-store';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NewsModule } from '../news/news.module';
import { PostgresPanelStore } from '../panel/internal/panel-store';
import { SearchModule } from '../search/search.module';
import { CatalogModule } from './catalog.module';

/**
 * Reads after a person merge (T-1865a, D-446 point 7, D-453), against the real
 * schema and `merge_person`: a merged-away duplicate (a tombstone) answers
 * `GET /players/:id` and `GET /coaches/:id` with its survivor's page and
 * `moved_to`; search leaves it out; a message card or a panel link that names
 * it shows the survivor, the member's writing untouched; and an undone merge
 * reads as before.
 */
// A merge re-points 24 columns, slow on a full local database.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const RUN = randomUUID().slice(0, 8);
// One rare word, so the search below finds exactly these persons.
const NAME = `Quillfeather Tombstone${RUN}`;
// A third id of the same man, spelled as only that id was.
const SPELLED = `Vellichor Brandywine${RUN}`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'tombstone reads (T-1865a)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const survivor = randomUUID();
    const loser = randomUUID();
    const spelled = randomUUID();
    const teams = [randomUUID(), randomUUID()];
    const fixtures = [randomUUID(), randomUUID()];
    let actor = '';
    let merge = '';
    let post = '';

    const get = <T>(url: string) =>
      app.inject({ method: 'GET', url }).then((r) => ({ status: r.statusCode, body: r.json<T>() }));
    const hits = async (q: string) =>
      (await get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&types=person`)).body.results
        .filter((r) => ([survivor, loser, spelled] as string[]).includes(r.id))
        .map((r) => ({ id: r.id, name: r.name, alias: r.alias }));
    const found = async (q = NAME) => (await hits(q)).map((r) => r.id).sort();

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, CatalogModule, SearchModule, NewsModule],
      })
        .overrideProvider(MAILER)
        .useValue(new CaptureMailer())
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({ ...DEFAULT_IDENTITY_OPTIONS, sessionSecret: 'test-secret-'.repeat(4) })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      actor = (
        await pool.query<{ id: string }>(
          `INSERT INTO user_account
             (username, display_name, email, country_id, preferred_language, timezone,
              accepted_rules_at, status)
           VALUES ($1, 'T-1865a', $2, $3, 'en', 'UTC', now(), 'active') RETURNING id`,
          [`t1865a_${RUN}`, `t1865a-${RUN}@example.com`, ENGLAND],
        )
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
        [teams[0], teams[1], `T-1865a Home ${RUN}`, `T-1865a Away ${RUN}`],
      );
      // The provider's two ids for one man: the same name on two rows.
      await pool.query(
        `INSERT INTO person (id, full_name, date_of_birth) VALUES
           ($1, $3, '1990-01-01'), ($2, $3, '1990-01-01'), ($4, $5, '1990-01-01')`,
        [survivor, loser, NAME, spelled, SPELLED],
      );
      // The provider's list of the loser id's moves, read before the merge.
      await pool.query(
        `INSERT INTO transfer_listing
           (source, subject_person_id, person_id, person_name, transfer_date, kind,
            to_team_id, to_name, fetched_at)
         VALUES ('api_football', $1, $1, $2, '2024-07-01', 'free', $3, 'T-1865a Home', now())`,
        [loser, NAME, teams[0]],
      );
      await pool.query(
        `INSERT INTO person_transfer_fetch (provider, person_id, answered_at, moves)
         VALUES ('api_football', $1, now(), 1)`,
        [survivor],
      );
      for (const fixture of fixtures) {
        await pool.query(
          `INSERT INTO fixture (id, season_id, kickoff_at, status)
           VALUES ($1, $2, now() - interval '3 days', 'finished')`,
          [fixture, PL_2025],
        );
      }
      // The survivor played the first match; the loser id the second, where
      // it is also named as the away side's coach (a player-coach).
      const sides = await pool.query<{ id: string; fixture_id: string; side: string }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side, coach_id) VALUES
           ($1, $3, 'home', NULL), ($1, $4, 'away', NULL),
           ($2, $3, 'home', NULL), ($2, $4, 'away', $5)
         RETURNING id, fixture_id, side`,
        [fixtures[0], fixtures[1], teams[0], teams[1], loser],
      );
      const side = (fixture: string, name: string) =>
        sides.rows.find((r) => r.fixture_id === fixture && r.side === name)!.id;
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role) VALUES
           ($1, $2, 'starter'), ($3, $4, 'starter')`,
        [side(fixtures[0]!, 'home'), survivor, side(fixtures[1]!, 'home'), loser],
      );
      // A member's panel post linking the loser id, written before the merge.
      await pool.query(
        `INSERT INTO match_panel (fixture_id, opened_by, reason) VALUES ($1, $2, 'T-1865a spec')`,
        [fixtures[1], actor],
      );
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $1, 'T-1865a spec', 'contributor-rules@1.0.0', now())`,
        [actor],
      );
      post = (
        await pool.query<{ id: string }>(
          `INSERT INTO panel_post (fixture_id, author_id, body, link_kind, link_person_id)
           VALUES ($1, $2, 'what a player', 'player', $3) RETURNING id`,
          [fixtures[1], actor, loser],
        )
      ).rows[0]!.id;
    });

    afterAll(async () => {
      if (pool !== undefined) {
        const client = await pool.connect();
        try {
          // The merge's audit rows and archive are immutable by trigger.
          await client.query(`SET session_replication_role = 'replica'`);
          const audits = await client.query<{ id: string }>(
            `SELECT audit_log_id AS id FROM person_merge WHERE from_person_id = ANY($1::uuid[])
             UNION SELECT undo_audit_log_id FROM person_merge WHERE from_person_id = ANY($1::uuid[])`,
            [[loser, spelled]],
          );
          await client.query(
            `DELETE FROM person_merge_moved WHERE merge_id IN
               (SELECT id FROM person_merge WHERE from_person_id = ANY($1::uuid[]))`,
            [[loser, spelled]],
          );
          await client.query(`DELETE FROM person_merge WHERE from_person_id = ANY($1::uuid[])`, [
            [loser, spelled],
          ]);
          await client.query(
            `DELETE FROM person_transfer_fetch WHERE person_id = ANY($1::uuid[])`,
            [[survivor, loser]],
          );
          await client.query(
            `DELETE FROM transfer_listing WHERE subject_person_id = ANY($1::uuid[])`,
            [[survivor, loser]],
          );
          await client.query(`DELETE FROM audit_log WHERE id = ANY($1::uuid[])`, [
            audits.rows.map((r) => r.id).filter((id) => id !== null),
          ]);
          await client.query(`DELETE FROM panel_post WHERE fixture_id = ANY($1::uuid[])`, [
            fixtures,
          ]);
          await client.query(`DELETE FROM match_panel WHERE fixture_id = ANY($1::uuid[])`, [
            fixtures,
          ]);
          await client.query(`DELETE FROM lineup WHERE person_id = ANY($1::uuid[])`, [
            [survivor, loser],
          ]);
          await client.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
            fixtures,
          ]);
          await client.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
          await client.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
            [survivor, loser, spelled],
          ]);
          await client.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
          await client.query(`DELETE FROM contributor_grant WHERE user_id = $1`, [actor]);
          await client.query(`DELETE FROM user_account WHERE id = $1`, [actor]);
        } finally {
          await client.query(`SET session_replication_role = 'origin'`);
          client.release();
        }
        await pool.end();
      }
      await app?.close();
    });

    it('reads two persons before the merge, neither moved', async () => {
      expect(await found()).toEqual([survivor, loser].sort());
      expect(await found(SPELLED)).toEqual([spelled]);
      const page = await get<PlayerPage>(`/players/${loser}`);
      expect(page.status).toBe(200);
      expect(page.body.person.id).toBe(loser);
      expect(page.body).not.toHaveProperty('moved_to');
    });

    it("answers the tombstone's player and coach pages with the survivor's and moved_to", async () => {
      merge = (
        await pool.query<{ id: string }>(`SELECT merge_person($1, $2, $3, $4) AS id`, [
          loser,
          survivor,
          actor,
          'T-1865a spec: one man under two ids',
        ])
      ).rows[0]!.id;
      await pool.query(`SELECT merge_person($1, $2, $3, 'T-1865a spec: a third id')`, [
        spelled,
        survivor,
        actor,
      ]);

      const player = await get<PlayerPage>(`/players/${loser}`);
      expect(player.status).toBe(200);
      expect(player.body.moved_to).toBe(survivor);
      expect(player.body.person.id).toBe(survivor);
      // The survivor's page, with both matches now his.
      expect(player.body.recent_matches.data?.map((m) => m.fixture.id).sort()).toEqual(
        [...fixtures].sort(),
      );
      const own = await get<PlayerPage>(`/players/${survivor}`);
      expect(own.body).not.toHaveProperty('moved_to');
      expect({ ...player.body, moved_to: undefined }).toEqual({ ...own.body, moved_to: undefined });

      const coach = await get<CoachPage>(`/coaches/${loser}`);
      expect(coach.status).toBe(200);
      expect(coach.body.moved_to).toBe(survivor);
      expect(coach.body.coach.id).toBe(survivor);
      expect(coach.body.lineups.count).toBe(1);
      const ownCoach = await get<CoachPage>(`/coaches/${survivor}`);
      expect(ownCoach.status).toBe(200);
      expect(ownCoach.body).not.toHaveProperty('moved_to');
    });

    it('finds the survivor once, by the names of any of his ids, never the tombstone', async () => {
      expect(await hits(NAME)).toEqual([{ id: survivor, name: NAME, alias: null }]);
      // A spelling only a merged-away id had still finds the man.
      expect(await hits(SPELLED)).toEqual([{ id: survivor, name: NAME, alias: SPELLED }]);
    });

    it("answers a tombstone's news and transfers with the survivor's (D-453)", async () => {
      const news = await get<EntityNewsResponse>(`/players/${loser}/news`);
      expect(news.status).toBe(200);
      expect(news.body.entity).toEqual({ type: 'person', id: survivor });
      const section = await get<NewsSectionResponse>(`/news?player=${loser}`);
      expect(section.status).toBe(200);
      expect(section.body.filters.player).toBe(survivor);

      const moved = await get<PlayerTransfers>(`/players/${loser}/transfers`);
      const own = await get<PlayerTransfers>(`/players/${survivor}/transfers`);
      expect(moved.status).toBe(200);
      expect(moved.body).toEqual(own.body);
      expect(JSON.stringify(own.body)).toContain('2024-07-01');
      const seasons = await get(`/players/${loser}/provider-seasons`);
      expect(seasons.body).toEqual((await get(`/players/${survivor}/provider-seasons`)).body);
    });

    it('shows the survivor on a message card that names the tombstone', async () => {
      const people = await new CardStore(pool).people([loser, survivor]);
      expect(people.get(loser)).toEqual({ id: survivor, name: NAME, short_name: null });
      expect(people.get(survivor)).toEqual({ id: survivor, name: NAME, short_name: null });
    });

    it('shows the survivor on a panel link to the tombstone, the post unchanged', async () => {
      const [row] = await new PostgresPanelStore(pool).links({ postIds: [post] });
      expect(row).toMatchObject({ player_id: survivor, player_name: NAME, player_side: 'home' });
      const stored = await pool.query<{ link_person_id: string }>(
        `SELECT link_person_id FROM panel_post WHERE id = $1`,
        [post],
      );
      expect(stored.rows[0]!.link_person_id).toBe(loser);
    });

    it('reads as before once the merge is undone', async () => {
      await pool.query(`SELECT merge_person_undo($1, $2, 'T-1865a spec: undo')`, [merge, actor]);
      expect(await found()).toEqual([survivor, loser].sort());
      const page = await get<PlayerPage>(`/players/${loser}`);
      expect(page.body.person.id).toBe(loser);
      expect(page.body).not.toHaveProperty('moved_to');
      const [row] = await new PostgresPanelStore(pool).links({ postIds: [post] });
      expect(row).toMatchObject({ player_id: loser, player_side: 'home' });
    });
  },
);
