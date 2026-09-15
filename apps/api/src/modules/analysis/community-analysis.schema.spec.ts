import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Community-written match analysis against the real schema (T-260).
 *
 * Nothing in the API writes these yet — the workflow is T-261 — so this writes
 * what the service will write and checks what belongs to the database.
 *
 * **The thing most worth testing is the thing that is easiest to get right and
 * hardest to keep right**: this is a fourth signed opinion and it shares nothing
 * with `founder_analysis`. The one-line wrong version of this epic is a second
 * `author_id` on the founder's table, and it would pass every test about
 * content.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'community-written analysis',
  () => {
    let pool: Pool;
    const members: string[] = [];
    const teams = [randomUUID(), randomUUID()];
    const fixtures: string[] = [];
    let analyst = '';
    let approver = '';

    async function member(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [
          `ca${label}${RUN}`.toLowerCase().slice(0, 20),
          `Analyst ${label}`,
          `ca${label}${RUN}@example.test`.toLowerCase(),
          ENGLAND,
        ],
      );
      const id = rows[0]?.id ?? '';
      members.push(id);
      return id;
    }

    async function fixture(kickoff = `now() + interval '2 days'`): Promise<string> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', ${kickoff}, 'scheduled')`,
        [id, PL_2025, REGULAR_SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
      return id;
    }

    const start = (fixtureId: string, authorId = analyst) =>
      pool
        .query<{ id: string }>(
          `INSERT INTO community_analysis (fixture_id, author_id) VALUES ($1, $2) RETURNING id`,
          [fixtureId, authorId],
        )
        .then(({ rows }) => rows[0]?.id ?? '');

    const draft = (analysisId: string, over: Record<string, unknown> = {}) =>
      pool.query(
        `INSERT INTO community_analysis_draft
           (analysis_id, predicted_outcome, predicted_home, predicted_away, confidence, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          analysisId,
          over.outcome ?? 'home',
          over.home ?? null,
          over.away ?? null,
          over.confidence ?? 3,
          over.reasoning ?? 'The home side press high and the visitors play out from the back.',
        ],
      );

    const submit = (analysisId: string, attempt = 1) =>
      pool
        .query<{ id: string }>(
          `INSERT INTO community_analysis_submission
             (analysis_id, attempt, predicted_outcome, confidence, reasoning)
           VALUES ($1, $2, 'home', 3, 'Because of the full-backs.') RETURNING id`,
          [analysisId, attempt],
        )
        .then(({ rows }) => rows[0]?.id ?? '');

    const review = (submissionId: string, decision: string) =>
      pool.query(
        `INSERT INTO community_analysis_review (submission_id, reviewer_id, decision, reason)
         VALUES ($1, $2, $3, 'the analysis schema suite')`,
        [submissionId, approver, decision],
      );

    const publish = (analysisId: string, submissionId: string, version = 1) =>
      pool.query(
        `INSERT INTO community_analysis_version
           (analysis_id, submission_id, version_number, predicted_outcome, confidence, reasoning)
         VALUES ($1, $2, $3, 'home', 3, 'Because of the full-backs.')`,
        [analysisId, submissionId, version],
      );

    const state = (analysisId: string) =>
      pool
        .query<{ s: string }>(`SELECT community_analysis_state($1) AS s`, [analysisId])
        .then(({ rows }) => rows[0]?.s ?? '');

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      analyst = await member('a');
      approver = await member('r');
      for (const [index, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
          [id, ENGLAND, `Analysis Team ${index}${RUN}`, `AT${index}`],
        );
      }
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the analysis schema suite', 'contributor-rules@1.0.0', now())`,
        [analyst, approver],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM community_analysis_version WHERE analysis_id IN
             (SELECT id FROM community_analysis WHERE author_id = ANY($1::uuid[]))`,
          [members],
        );
        await client.query(
          `DELETE FROM community_analysis_review WHERE reviewer_id = ANY($1::uuid[])`,
          [members],
        );
        await client.query(
          `DELETE FROM community_analysis_submission WHERE analysis_id IN
             (SELECT id FROM community_analysis WHERE author_id = ANY($1::uuid[]))`,
          [members],
        );
        await client.query(`DELETE FROM community_analysis WHERE author_id = ANY($1::uuid[])`, [
          members,
        ]);
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

    describe('it is a fourth opinion, in its own tables', () => {
      it('shares no table with the founder analysis', async () => {
        const { rows } = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name LIKE 'community_analysis%'
            ORDER BY table_name`,
        );
        // Five tables of its own. The one-line wrong version of this epic is a
        // second author_id on `founder_analysis`, and it would pass every test
        // about content while making the founder's signature mean nothing.
        expect(rows.map((r) => r.table_name)).toEqual([
          'community_analysis',
          'community_analysis_draft',
          'community_analysis_review',
          'community_analysis_submission',
          'community_analysis_version',
        ]);
      });

      it('leaves the founder analysis exactly as it was: one per fixture', async () => {
        const { rows } = await pool.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'founder_analysis_one_per_fixture'`,
        );
        // Still unique per fixture. If community analysis had been folded in,
        // this constraint would have had to go -- which is how the change would
        // announce itself.
        expect(rows[0]?.def).toMatch(/UNIQUE \(fixture_id\)/);
      });

      it('allows many analysts on one match and one analysis each', async () => {
        const match = await fixture();
        const second = await member('b');
        await pool.query(
          `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
           VALUES ($1, $2, 'the analysis schema suite', 'contributor-rules@1.0.0', now())`,
          [second, approver],
        );

        await expect(start(match)).resolves.toBeTruthy();
        // A match carries many opinions; that is the feature.
        await expect(start(match, second)).resolves.toBeTruthy();
        // And one analyst says one thing about it. Revising is a new version.
        await expect(start(match)).rejects.toMatchObject({ code: '23505' });
      });
    });

    describe('writing one needs a person to have approved you', () => {
      it('refuses a member with no contributor grant', async () => {
        const match = await fixture();
        const unapproved = await member('u');
        await expect(start(match, unapproved)).rejects.toMatchObject({ code: 'PL014' });
      });
    });

    describe('the draft is the only mutable thing here', () => {
      it('can be rewritten, because it is where somebody is still thinking', async () => {
        const match = await fixture();
        const analysis = await start(match);
        await draft(analysis);
        await expect(
          pool.query(
            `UPDATE community_analysis_draft SET reasoning = 'A second thought.' WHERE analysis_id = $1`,
            [analysis],
          ),
        ).resolves.toBeTruthy();
      });

      it('refuses a score that contradicts the call', async () => {
        const match = await fixture();
        const analysis = await start(match);
        // Two calls in one row, and a page would have to choose which to
        // believe.
        await expect(draft(analysis, { outcome: 'home', home: 0, away: 2 })).rejects.toMatchObject({
          constraint: 'community_draft_score_matches_outcome',
        });
      });

      it('refuses an analysis with no reasoning, because that is a prediction', async () => {
        const match = await fixture();
        const analysis = await start(match);
        await expect(draft(analysis, { reasoning: '   ' })).rejects.toMatchObject({
          constraint: 'community_draft_reasoning_not_blank',
        });
      });
    });

    describe('a submission is a copy, and a decision is a record', () => {
      it('cannot be edited once made, so a reviewer can say what they read', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const submission = await submit(analysis);
        await expect(
          pool.query(
            `UPDATE community_analysis_submission SET reasoning = 'different' WHERE id = $1`,
            [submission],
          ),
        ).rejects.toThrow();
      });

      it('takes one decision and no second opinion', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const submission = await submit(analysis);
        await review(submission, 'changes_requested');
        // Two reviewers disagreeing about one submission is a situation the
        // product has no answer for, so it is made impossible rather than
        // resolved arbitrarily.
        await expect(review(submission, 'approved')).rejects.toMatchObject({ code: '23505' });
      });

      it('requires a reason even for an approval', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const submission = await submit(analysis);
        await expect(
          pool.query(
            `INSERT INTO community_analysis_review (submission_id, reviewer_id, decision, reason)
             VALUES ($1, $2, 'approved', '  ')`,
            [submission, approver],
          ),
        ).rejects.toMatchObject({ constraint: 'community_review_reason_not_blank' });
      });

      it('cannot be rewritten afterwards', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const submission = await submit(analysis);
        await review(submission, 'rejected');
        await expect(
          pool.query(
            `UPDATE community_analysis_review SET decision = 'approved' WHERE submission_id = $1`,
            [submission],
          ),
        ).rejects.toThrow();
      });
    });

    describe('what is published stays published, and stays as it was', () => {
      it('is immutable, and one version per approved submission', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const submission = await submit(analysis);
        await review(submission, 'approved');
        await publish(analysis, submission);

        await expect(
          pool.query(
            `UPDATE community_analysis_version SET reasoning = 'revised' WHERE analysis_id = $1`,
            [analysis],
          ),
        ).rejects.toThrow();
        // Publishing the same approval twice would be two versions saying the
        // same thing with different numbers.
        await expect(publish(analysis, submission, 2)).rejects.toMatchObject({ code: '23505' });
      });
    });

    describe('the kick-off wall', () => {
      it('refuses a submission once the match has started', async () => {
        const started = await fixture(`now() - interval '10 minutes'`);
        const analysis = await start(started);
        // A call revised after the result is known is not a call, and the
        // database's clock is the authority rather than the API's (T-051,
        // T-130).
        await expect(submit(analysis)).rejects.toMatchObject({ code: 'PL002' });
      });

      it('refuses a publication once the match has started', async () => {
        const later = await fixture();
        const analysis = await start(later);
        const submission = await submit(analysis);
        await review(submission, 'approved');
        await pool.query(
          `UPDATE fixture SET kickoff_at = now() - interval '1 minute' WHERE id = $1`,
          [later],
        );
        await expect(publish(analysis, submission)).rejects.toMatchObject({ code: 'PL002' });
      });

      it('lets an analyst keep editing their own unpublished draft', async () => {
        const started = await fixture(`now() - interval '10 minutes'`);
        const analysis = await start(started);
        // Nobody has been shown it and nothing is being claimed, so there is
        // nothing to protect a reader from.
        await expect(draft(analysis)).resolves.toBeTruthy();
      });
    });

    describe('the state is derived, never stored', () => {
      it('walks draft, submitted, changes_requested, approved and published', async () => {
        const match = await fixture();
        const analysis = await start(match);
        expect(await state(analysis)).toBe('draft');

        const first = await submit(analysis, 1);
        expect(await state(analysis)).toBe('submitted');

        await review(first, 'changes_requested');
        expect(await state(analysis)).toBe('changes_requested');

        const second = await submit(analysis, 2);
        expect(await state(analysis)).toBe('submitted');

        await review(second, 'approved');
        expect(await state(analysis)).toBe('approved');

        await publish(analysis, second);
        expect(await state(analysis)).toBe('published');
      });

      it('stays published even if a later attempt is refused', async () => {
        const match = await fixture();
        const analysis = await start(match);
        const first = await submit(analysis, 1);
        await review(first, 'approved');
        await publish(analysis, first);

        const second = await submit(analysis, 2);
        await review(second, 'rejected');
        // A refused revision does not unpublish what the public has already
        // read. It stays, and the record of the refusal stays beside it.
        expect(await state(analysis)).toBe('published');
      });
    });
  },
);
