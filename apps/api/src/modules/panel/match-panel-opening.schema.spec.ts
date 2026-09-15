import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Which fixtures have a panel at all, against the real schema (T-253).
 *
 * Until this migration every fixture had one, because nothing said which ones
 * did — a public discussion attached to all ten thousand fixtures in a season,
 * each of which can still be used to reach the public and each of which costs
 * the same to moderate as a room somebody wanted.
 *
 * Two things are worth testing and only one is obvious. The obvious one: a post
 * to a fixture nobody opened is refused. The other is the **order** the refusals
 * come in, which is easy to get wrong and impossible to notice — the write
 * still fails, and the member is simply told the wrong reason for it.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

interface Codeful {
  code?: string;
  hint?: string;
}

const sqlstate = (error: unknown): string | undefined => (error as Codeful).code;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'which fixtures have a panel',
  () => {
    let pool: Pool;
    const members: string[] = [];
    const teams = [randomUUID(), randomUUID()];
    const fixtures: string[] = [];
    let contributor = '';
    let operator = '';

    async function member(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [
          `mo${label}${RUN}`.toLowerCase().slice(0, 20),
          `Opening ${label}`,
          `mo${label}${RUN}@example.test`.toLowerCase(),
          ENGLAND,
        ],
      );
      const id = rows[0]?.id ?? '';
      members.push(id);
      return id;
    }

    async function fixture(): Promise<string> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() + interval '2 days', 'scheduled')`,
        [id, PL_2025, REGULAR_SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
      return id;
    }

    const open = (fixtureId: string) =>
      pool.query(
        `INSERT INTO match_panel (fixture_id, opened_by, reason)
         VALUES ($1, $2, 'a match worth arguing about')`,
        [fixtureId, operator],
      );

    const close = (fixtureId: string) =>
      pool.query(
        `UPDATE match_panel
            SET closed_at = now(), closed_by = $2, close_reason = 'the argument ran out'
          WHERE fixture_id = $1`,
        [fixtureId, operator],
      );

    const post = (fixtureId: string, authorId = contributor) =>
      pool.query(
        `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'A word about it.')`,
        [fixtureId, authorId],
      );

    const isOpen = (fixtureId: string) =>
      pool
        .query<{ yes: boolean }>(`SELECT fixture_panel_open($1) AS yes`, [fixtureId])
        .then(({ rows }) => rows[0]?.yes ?? false);

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      contributor = await member('c');
      operator = await member('o');
      for (const [index, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
          [id, ENGLAND, `Opening Team ${index}${RUN}`, `OT${index}`],
        );
      }
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the panel opening suite', 'contributor-rules@1.0.0', now())`,
        [contributor, operator],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM panel_post WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
        await client.query(`DELETE FROM match_panel WHERE fixture_id = ANY($1::uuid[])`, [
          fixtures,
        ]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [members]);
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          members,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
    });

    describe('a panel exists because somebody opened it', () => {
      it('refuses a post to a fixture nobody opened, even from an approved contributor', async () => {
        const quiet = await fixture();
        expect(await isOpen(quiet)).toBe(false);
        // The default this migration changes. Before it, this write succeeded.
        await expect(post(quiet)).rejects.toMatchObject({ code: 'PL015' });
      });

      it('admits the same post once an operator opens one', async () => {
        const featured = await fixture();
        await open(featured);
        expect(await isOpen(featured)).toBe(true);
        await expect(post(featured)).resolves.toBeTruthy();
      });

      it('refuses an opening with no reason', async () => {
        const nameless = await fixture();
        await expect(
          pool.query(
            `INSERT INTO match_panel (fixture_id, opened_by, reason) VALUES ($1, $2, '  ')`,
            [nameless, operator],
          ),
        ).rejects.toMatchObject({ constraint: 'match_panel_reason_not_blank' });
      });

      it('allows one panel per fixture and no more', async () => {
        const once = await fixture();
        await open(once);
        await expect(open(once)).rejects.toMatchObject({ code: '23505' });
      });
    });

    describe('closing keeps the words and stops the writing', () => {
      it('refuses new posts and leaves the old ones exactly where they are', async () => {
        const ending = await fixture();
        await open(ending);
        await post(ending);
        await close(ending);

        expect(await isOpen(ending)).toBe(false);
        await expect(post(ending)).rejects.toMatchObject({ code: 'PL015' });

        // A closed panel is still readable. Taking the words down when the
        // argument ends would rewrite a record people were told was public, and
        // the reader who followed a link should find what they were shown.
        const still = await pool.query(`SELECT 1 FROM panel_post WHERE fixture_id = $1`, [ending]);
        expect(still.rows).toHaveLength(1);
      });

      it('refuses a closing that names nobody or gives no reason', async () => {
        const half = await fixture();
        await open(half);
        await expect(
          pool.query(`UPDATE match_panel SET closed_at = now() WHERE fixture_id = $1`, [half]),
        ).rejects.toMatchObject({ constraint: 'match_panel_close_is_whole' });
        await expect(
          pool.query(
            `UPDATE match_panel SET closed_at = now(), closed_by = $2, close_reason = '  '
              WHERE fixture_id = $1`,
            [half, operator],
          ),
        ).rejects.toMatchObject({ constraint: 'match_panel_close_is_whole' });
      });

      it('can be reopened, and the reopening is the same row saying so', async () => {
        const again = await fixture();
        await open(again);
        await close(again);
        await pool.query(
          `UPDATE match_panel SET closed_at = NULL, closed_by = NULL, close_reason = NULL
            WHERE fixture_id = $1`,
          [again],
        );
        expect(await isOpen(again)).toBe(true);
        await expect(post(again)).resolves.toBeTruthy();
      });
    });

    describe('the refusals come in the order that is true of the most people', () => {
      it('tells an unapproved member that there is no discussion, not that they are unapproved', async () => {
        const quiet = await fixture();
        const ordinary = await member('u1');

        // Both refusals apply. The one heard is `PL015`, because a member told
        // they are not an approved contributor would go and read about approval
        // and none of it would help: there is no panel here, and there would not
        // be one for them if they were approved tomorrow.
        const failure = await post(quiet, ordinary).catch((error: unknown) => error);
        expect(sqlstate(failure)).toBe('PL015');
      });

      it('and tells them about approval once a panel exists', async () => {
        const featured = await fixture();
        await open(featured);
        const ordinary = await member('u2');
        const failure = await post(featured, ordinary).catch((error: unknown) => error);
        // Now the approval refusal is the true one, and it is what they hear.
        expect(sqlstate(failure)).toBe('PL014');
      });
    });
  },
);
