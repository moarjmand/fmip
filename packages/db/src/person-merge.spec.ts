import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `merge_person` and `merge_person_undo` (T-1863, D-446), against the real
 * schema. Every test runs in its own transaction and rolls it back, so the
 * immutable `audit_log` rows it writes leave nothing behind.
 */
const DATABASE_URL = process.env.DATABASE_URL;

/** Every column with a foreign key to `person`, and how a merge treats it. */
const HANDLED_FK_COLUMNS = [
  'absence_history.person_id',
  'coach_fetch.person_id',
  'coach_reference_split.person_id',
  'coach_spell.person_id',
  'fixture.referee_id',
  'fixture_absence.person_id',
  'fixture_participant.coach_id',
  'fixture_player_expected.person_id',
  'fixture_player_stat.person_id',
  'incident.person_id',
  'incident.related_person_id',
  'lineup.person_id',
  'person_bio_fetch.person_id',
  'person_name_fetch.person_id',
  'person_transfer_fetch.person_id',
  'player_career_fetch.person_id',
  'player_career_season.person_id',
  'player_season_fetch.person_id',
  'player_season_stat.person_id',
  'player_spell.person_id',
  'team_squad_member.person_id',
  'transfer_listing.person_id',
  'transfer_listing.subject_person_id',
];
/** Members' writing: stays on the tombstone, never rewritten (D-446 4). */
const KEPT_ON_TOMBSTONE = ['panel_post.link_person_id'];
/** References without a foreign key, filtered by entity type. */
const POLYMORPHIC = [
  'followed_entity.entity_id',
  'entity_alias.entity_id',
  'entity_media.entity_id',
  'article_entity.entity_id',
  'provider_mapping.internal_id',
];

const AGED = '2025-01-02T03:04:05.678901+00:00';

interface Scenario {
  actor: string;
  loser: string;
  survivor: string;
  earlier: string;
  other: string;
  fixtures: { shared: string };
  participants: { sharedHome: string };
  ids: { loserPlayer: string; loserCoach: string; survivorCoach: string };
}

type Client = pg.PoolClient;

async function one<T extends pg.QueryResultRow>(
  client: Client,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const { rows } = await client.query<T>(sql, values);
  if (rows[0] === undefined) throw new Error(`no row from ${sql}`);
  return rows[0];
}

async function seed(client: Client): Promise<Scenario> {
  const tag = randomUUID().slice(0, 8);
  const country = await client.query<{ id: string }>(
    `SELECT id FROM country ORDER BY code LIMIT 2`,
  );
  const [c1, c2] = country.rows.map((r) => r.id);
  const user = async (name: string) =>
    (
      await one<{ id: string }>(
        client,
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, status)
         VALUES ($1, 'T-1863', $2, $3, 'en', 'UTC', now(), 'active') RETURNING id`,
        [`t1863_${name}_${tag}`, `t1863-${name}-${tag}@example.com`, c1],
      )
    ).id;
  const actor = await user('a');
  const follower = await user('f');

  const competition = (
    await one<{ id: string }>(
      client,
      `INSERT INTO competition (name, kind, scope, gender)
       VALUES ('T-1863 cup', 'league', 'international', 'men') RETURNING id`,
    )
  ).id;
  const season = (
    await one<{ id: string }>(
      client,
      `INSERT INTO season (competition_id, label, start_date, end_date)
       VALUES ($1, '2026/27', '2026-08-01', '2027-05-31') RETURNING id`,
      [competition],
    )
  ).id;
  const team = async (name: string) =>
    (
      await one<{ id: string }>(
        client,
        `INSERT INTO team (name, kind, gender) VALUES ($1, 'club', 'men') RETURNING id`,
        [`T-1863 ${name}`],
      )
    ).id;
  const [teamA, teamB, teamC] = [await team('A'), await team('B'), await team('C')];

  const person = async (fields: Record<string, unknown>) =>
    (
      await one<{ id: string }>(
        client,
        `INSERT INTO person (full_name, known_as, date_of_birth, nationality_id, height_cm, preferred_foot)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          fields.full_name,
          fields.known_as ?? null,
          fields.date_of_birth ?? null,
          fields.nationality_id ?? null,
          fields.height_cm ?? null,
          fields.preferred_foot ?? null,
        ],
      )
    ).id;
  // The loser has the profile the survivor lacks, and a foot the survivor
  // already has (never overwritten).
  const loser = await person({
    full_name: 'T-1863 Ali Helichi',
    known_as: 'A. Helichi',
    date_of_birth: '1995-03-04',
    nationality_id: c2,
    height_cm: 181,
    preferred_foot: 'right',
  });
  const survivor = await person({ full_name: 'T-1863 Ali Helichi', preferred_foot: 'left' });
  const earlier = await person({ full_name: 'T-1863 Ali Helichi (third id)' });
  const other = await person({ full_name: 'T-1863 Someone Else' });

  const fixture = async () =>
    (
      await one<{ id: string }>(
        client,
        `INSERT INTO fixture (season_id, kickoff_at) VALUES ($1, '2026-09-01T18:00Z') RETURNING id`,
        [season],
      )
    ).id;
  const participant = async (fixtureId: string, teamId: string, side: string) =>
    (
      await one<{ id: string }>(
        client,
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, $3) RETURNING id`,
        [fixtureId, teamId, side],
      )
    ).id;
  const fLoser = await fixture();
  const pLoserHome = await participant(fLoser, teamA, 'home');
  const pLoserAway = await participant(fLoser, teamB, 'away');
  const fShared = await fixture();
  const pSharedHome = await participant(fShared, teamA, 'home');
  const pSharedAway = await participant(fShared, teamB, 'away');

  const q = (sql: string, values: unknown[]) => client.query(sql, values);

  // Line-ups: the loser in one match, the survivor in another; in the shared
  // match only the survivor is on the team sheet and the loser holds the
  // statistics, events and expected goals (one human, two provider ids), and
  // the loser is the away side's coach (a coach link is not a line-up).
  await q(`INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter')`, [
    pLoserHome,
    loser,
  ]);
  await q(`INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter')`, [
    pSharedHome,
    survivor,
  ]);
  await q(`INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter')`, [
    pSharedHome,
    other,
  ]);
  await q(
    `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
     VALUES ($1, $2, 'rating', 7.1), ($1, $2, 'goals', 1), ($1, $3, 'rating', 6.8), ($4, $2, 'minutes', 90)`,
    [pSharedHome, loser, survivor, pLoserHome],
  );
  await q(
    `INSERT INTO fixture_player_expected (participant_id, person_id, source, metric, value)
     VALUES ($1, $2, 'highlightly', 'xg', 0.4), ($1, $2, 'highlightly', 'xa', 0.1),
            ($1, $3, 'highlightly', 'xg', 0.3)`,
    [pSharedHome, loser, survivor],
  );
  await q(
    `INSERT INTO fixture_absence (fixture_id, participant_id, person_id, status)
     VALUES ($1, $2, $3, 'out'), ($4, $5, $3, 'doubtful'), ($4, $5, $6, 'out')`,
    [fLoser, pLoserHome, loser, fShared, pSharedHome, survivor],
  );
  await q(
    `INSERT INTO incident (fixture_id, participant_id, kind, minute, sequence, person_id, related_person_id)
     VALUES ($1, $2, 'goal', 10, 1, $3, $4), ($1, $2, 'substitution', 60, 2, $4, $3)`,
    [fShared, pSharedHome, loser, other],
  );
  await q(`UPDATE fixture_participant SET coach_id = $1 WHERE id = $2`, [loser, pSharedAway]);
  await q(`UPDATE fixture SET referee_id = $1 WHERE id = $2`, [loser, fLoser]);
  await q(
    `INSERT INTO coach_reference_split (participant_id, person_id, provider, coach_external_id)
     VALUES ($1, $2, 'api_football', 'coach:1')`,
    [pLoserAway, loser],
  );

  // Careers: an open spell at A on both (collision), a closed one at B.
  await q(
    `INSERT INTO player_spell (person_id, team_id, start_date, end_date)
     VALUES ($1, $3, '2025-07-01', NULL), ($1, $4, '2020-07-01', '2022-06-30'),
            ($2, $3, '2025-07-01', NULL)`,
    [loser, survivor, teamA, teamB],
  );
  await q(
    `INSERT INTO team_squad_member (team_id, person_id, provider)
     VALUES ($1, $3, 'api_football'), ($2, $3, 'api_football'), ($1, $4, 'api_football')`,
    [teamA, teamB, loser, survivor],
  );
  await q(
    `INSERT INTO player_season_stat (source, person_id, season_year, competition_id, team_id, appearances, fetched_at)
     VALUES ('api_football', $1, 2026, $3, $4, 3, now()), ('api_football', $1, 2025, $3, $4, 20, now()),
            ('api_football', $2, 2026, $3, $4, 4, now())`,
    [loser, survivor, competition, teamA],
  );
  await q(
    `INSERT INTO player_career_season (source, person_id, team_id, season_year, fetched_at)
     VALUES ('api_football', $1, $3, 2026, now()), ('api_football', $1, $4, 2021, now()),
            ('api_football', $2, $3, 2026, now())`,
    [loser, survivor, teamA, teamB],
  );
  await q(
    `INSERT INTO coach_spell (source, person_id, team_id, fetched_at) VALUES ('api_football', $1, $2, now())`,
    [loser, teamC],
  );
  await q(
    `INSERT INTO transfer_listing (source, person_name, transfer_date, kind, fetched_at,
                                   subject_person_id, person_id, to_name)
     VALUES ('api_football', 'Ali Helichi', '2025-07-01', 'transfer', now(), $1, $1, 'T-1863 A')`,
    [loser],
  );
  await q(
    `INSERT INTO absence_history (provider, fixture_id, season_id, team_id, provider_person_id,
                                  status, fetched_at, person_id)
     VALUES ('api_football', $1, $2, $3, $4, 'out', now(), $5)`,
    [fLoser, season, teamA, `t1863-${tag}`, loser],
  );

  // Provider-ask records: all six for the loser, one for the survivor.
  for (const table of [
    'person_name_fetch',
    'person_bio_fetch',
    'person_transfer_fetch',
    'player_career_fetch',
  ]) {
    await q(`INSERT INTO ${table} (provider, person_id) VALUES ('api_football', $1)`, [loser]);
  }
  await q(`INSERT INTO person_name_fetch (provider, person_id) VALUES ('api_football', $1)`, [
    survivor,
  ]);
  await q(
    `INSERT INTO player_season_fetch (provider, person_id, season_year) VALUES ('api_football', $1, 2026)`,
    [loser],
  );
  await q(
    `INSERT INTO coach_fetch (source, person_id, fetched_at, spells_listed, spells_kept, spells_unmapped)
     VALUES ('api_football', $1, now(), 1, 1, 0)`,
    [loser],
  );

  // Polymorphic references.
  await q(
    `INSERT INTO followed_entity (user_id, entity_type, entity_id)
     VALUES ($1, 'person', $3), ($1, 'person', $4), ($2, 'person', $3)`,
    [actor, follower, loser, survivor],
  );
  await q(
    `INSERT INTO entity_alias (entity_type, entity_id, alias, kind, source, language)
     VALUES ('person', $1, 'Ali Helichi', 'alias', 't1863', NULL),
            ('person', $1, 'Helichi Ali', 'alias', 't1863', NULL),
            ('person', $1, 'علی هلیچی', 'name', 't1863', 'fa'),
            ('person', $2, 'ALI HELICHI', 'alias', 't1863', NULL),
            ('person', $2, 'علی', 'name', 't1863', 'fa')`,
    [loser, survivor],
  );
  await q(
    `INSERT INTO entity_media (entity_type, entity_id, kind, source_provider, source_url)
     VALUES ('person', $1, 'photo', 'api_football', 'https://example.com/l.png'),
            ('person', $2, 'photo', 'api_football', 'https://example.com/s.png')`,
    [loser, survivor],
  );
  const source = (
    await one<{ id: string }>(
      client,
      `INSERT INTO news_source (name, homepage_url, kind, rights, language, feed_url)
       VALUES ($1, 'https://example.com', 'rss', 'headline', 'en', 'https://example.com/feed')
       RETURNING id`,
      [`T-1863 ${tag}`],
    )
  ).id;
  const article = async (n: number) => {
    const story = (
      await one<{ id: string }>(client, `INSERT INTO story DEFAULT VALUES RETURNING id`)
    ).id;
    return (
      await one<{ id: string }>(
        client,
        `INSERT INTO article (source_id, story_id, external_id, url) VALUES ($1, $2, $3, $4) RETURNING id`,
        [source, story, `t1863-${tag}-${n}`, `https://example.com/${tag}/${n}`],
      )
    ).id;
  };
  const [a1, a2] = [await article(1), await article(2)];
  await q(
    `INSERT INTO article_entity (article_id, entity_type, entity_id)
     VALUES ($1, 'person', $3), ($1, 'person', $4), ($2, 'person', $3)`,
    [a1, a2, loser, survivor],
  );

  // Mappings: the loser holds a player id and a coach id; the survivor a
  // player id and another coach id, so it ends with two coach ids.
  const ids = {
    loserPlayer: `t1863-${tag}-1`,
    loserCoach: `coach:t1863-${tag}-1`,
    survivorCoach: `coach:t1863-${tag}-2`,
  };
  await q(
    `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
     VALUES ('api_football', 'person', $1, $4), ('api_football', 'person', $2, $4),
            ('api_football', 'person', $3, $5), ('api_football', 'person', $6, $5),
            ('api_football', 'person', $7, $8)`,
    [
      ids.loserPlayer,
      ids.loserCoach,
      `t1863-${tag}-2`,
      loser,
      survivor,
      ids.survivorCoach,
      `t1863-${tag}-3`,
      earlier,
    ],
  );

  // Age every timestamp the trigger would stamp, so a stray update shows.
  await client.query(`SELECT set_config('fmip.keep_updated_at', 'on', true)`);
  const people = [loser, survivor, earlier, other];
  for (const [table, column] of [
    ['person', 'id'],
    ['lineup', 'person_id'],
    ['fixture_player_stat', 'person_id'],
    ['fixture_player_expected', 'person_id'],
    ['fixture_absence', 'person_id'],
    ['incident', 'person_id'],
    ['player_spell', 'person_id'],
    ['followed_entity', 'entity_id'],
    ['entity_media', 'entity_id'],
    ['provider_mapping', 'internal_id'],
  ] as const) {
    await q(`UPDATE ${table} SET updated_at = $1 WHERE ${column} = ANY($2)`, [AGED, people]);
  }
  await q(`UPDATE fixture SET updated_at = $1 WHERE id = ANY($2)`, [AGED, [fLoser, fShared]]);
  await q(`UPDATE fixture_participant SET updated_at = $1 WHERE fixture_id = ANY($2)`, [
    AGED,
    [fLoser, fShared],
  ]);
  await client.query(`SELECT set_config('fmip.keep_updated_at', 'off', true)`);

  return {
    actor,
    loser,
    survivor,
    earlier,
    other,
    fixtures: { shared: fShared },
    participants: { sharedHome: pSharedHome },
    ids,
  };
}

/** Every row that references any of `people`, table by table, as JSON. */
async function snapshot(client: Client, people: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const columns = [...HANDLED_FK_COLUMNS, ...POLYMORPHIC, 'person.id'];
  for (const qualified of columns) {
    const [table, column] = qualified.split('.') as [string, string];
    const { rows } = await client.query<{ row: string }>(
      `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE t.${column} = ANY($1::uuid[])`,
      [people],
    );
    out[qualified] = rows.map((r) => r.row).sort();
  }
  return out;
}

async function refusal(
  client: Client,
  sql: string,
  values: unknown[],
): Promise<string | undefined> {
  await client.query('SAVEPOINT refusal');
  try {
    await client.query(sql, values);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT refusal');
    const e = error as { code?: string; hint?: string };
    expect(e.code).toBe('PL024');
    return e.hint;
  }
  await client.query('RELEASE SAVEPOINT refusal');
  return undefined;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'merging duplicate persons',
  () => {
    let pool: pg.Pool;
    beforeAll(() => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
    });
    afterAll(async () => {
      await pool.end();
    });

    const inTransaction = async (body: (client: Client) => Promise<void>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await body(client);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };

    it('knows every column with a foreign key to person', async () => {
      const { rows } = await pool.query<{ col: string }>(
        `SELECT c.conrelid::regclass::text || '.' || a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'public.person'::regclass
          AND c.conrelid::regclass::text NOT IN ('person_merge', 'person_not_duplicate')`,
      );
      expect(rows.map((r) => r.col).sort()).toEqual(
        [...HANDLED_FK_COLUMNS, ...KEPT_ON_TOMBSTONE].sort(),
      );
      expect(HANDLED_FK_COLUMNS.length + KEPT_ON_TOMBSTONE.length).toBe(24);
    });

    it('moves every reference and mapping, keeps collisions aside, audits, and undoes exactly', async () => {
      await inTransaction(async (client) => {
        const s = await seed(client);
        const people = [s.loser, s.survivor, s.earlier, s.other];

        // An earlier merge into the loser, so this merge must flatten it.
        await client.query(`SELECT merge_person($1, $2, $3, 'third id of the same man')`, [
          s.earlier,
          s.loser,
          s.actor,
        ]);
        const before = await snapshot(client, people);

        const merge = (
          await one<{ id: string }>(client, `SELECT merge_person($1, $2, $3, $4) AS id`, [
            s.loser,
            s.survivor,
            s.actor,
            'same name, birth date, club and nationality',
          ])
        ).id;

        // Nothing references the loser any more, except what stays on the tombstone.
        for (const qualified of [...HANDLED_FK_COLUMNS, ...POLYMORPHIC]) {
          const [table, column] = qualified.split('.') as [string, string];
          const { rows } = await client.query(`SELECT 1 FROM ${table} t WHERE t.${column} = $1`, [
            s.loser,
          ]);
          expect(rows, qualified).toHaveLength(0);
        }
        const { rows: tomb } = await client.query(`SELECT id FROM person WHERE id = $1`, [s.loser]);
        expect(tomb).toHaveLength(1);
        expect((await one(client, `SELECT person_merged_into($1) AS m`, [s.loser])).m).toBe(
          s.survivor,
        );
        // Flattened: the third id now redirects to the survivor in one step.
        expect((await one(client, `SELECT person_merged_into($1) AS m`, [s.earlier])).m).toBe(
          s.survivor,
        );

        // Every provider id is the survivor's now, two coach ids included.
        const { rows: mappings } = await client.query<{ external_id: string }>(
          `SELECT external_id FROM provider_mapping WHERE entity_type = 'person' AND internal_id = $1`,
          [s.survivor],
        );
        const external = mappings.map((m) => m.external_id);
        expect(external).toEqual(
          expect.arrayContaining([s.ids.loserPlayer, s.ids.loserCoach, s.ids.survivorCoach]),
        );
        expect(external.filter((e) => e.startsWith('coach:'))).toHaveLength(2);
        expect(external).toHaveLength(5);

        // Collisions: the survivor's row stayed, the loser's is kept aside.
        const moved = await client.query<{ table_name: string; action: string; n: number }>(
          `SELECT table_name, action, count(*)::int AS n FROM person_merge_moved
          WHERE merge_id = $1 AND action <> 'repointed' GROUP BY 1, 2`,
          [merge],
        );
        const aside = Object.fromEntries(
          moved.rows.map((r) => [`${r.action}:${r.table_name}`, r.n]),
        );
        expect(aside).toEqual({
          'collision:player_spell': 1,
          'collision:fixture_player_stat': 1,
          'collision:fixture_player_expected': 1,
          'collision:fixture_absence': 1,
          'collision:team_squad_member': 1,
          'collision:player_season_stat': 1,
          'collision:player_career_season': 1,
          'collision:followed_entity': 1,
          'collision:entity_alias': 2,
          'collision:entity_media': 1,
          'collision:article_entity': 1,
          'fetch_state:person_name_fetch': 1,
          'fetch_state:person_bio_fetch': 1,
          'fetch_state:player_season_fetch': 1,
          'fetch_state:player_career_fetch': 1,
          'fetch_state:coach_fetch': 1,
          'fetch_state:person_transfer_fetch': 1,
        });
        const rating = await client.query<{ value: string }>(
          `SELECT value FROM fixture_player_stat WHERE participant_id = $1 AND person_id = $2 AND metric = 'rating'`,
          [s.participants.sharedHome, s.survivor],
        );
        expect(rating.rows.map((r) => Number(r.value))).toEqual([6.8]);
        const { rows: survivorFetch } = await client.query(
          `SELECT 1 FROM person_name_fetch WHERE person_id = $1`,
          [s.survivor],
        );
        expect(survivorFetch).toHaveLength(1);

        // A re-pointed row keeps its timestamp; the survivor's profile is filled
        // only where it was empty.
        const lineup = await one<{ updated_at: Date }>(
          client,
          `SELECT l.updated_at FROM lineup l JOIN fixture_participant p ON p.id = l.participant_id
          WHERE l.person_id = $1 AND p.fixture_id <> $2`,
          [s.survivor, s.fixtures.shared],
        );
        expect(lineup.updated_at.toISOString()).toBe('2025-01-02T03:04:05.678Z');
        const profile = await one<Record<string, unknown>>(
          client,
          `SELECT known_as, date_of_birth::text AS dob, height_cm, preferred_foot FROM person WHERE id = $1`,
          [s.survivor],
        );
        expect(profile).toEqual({
          known_as: 'A. Helichi',
          dob: '1995-03-04',
          height_cm: 181,
          preferred_foot: 'left',
        });

        // Rule 10: one audit row with actor, reason, previous value and counts.
        const audit = await one<{
          actor_id: string;
          reason: string;
          target_type: string;
          previous: {
            merged_into: null;
            survivor_profile: { known_as: null; preferred_foot: string };
          };
          next: { merge_id: string; merged_into: string; repointed: Record<string, number> };
        }>(
          client,
          `SELECT a.* FROM audit_log a JOIN person_merge m ON m.audit_log_id = a.id
          WHERE m.id = $1 AND a.action = 'person.merge' AND a.target_id = $2`,
          [merge, s.loser],
        );
        expect(audit.actor_id).toBe(s.actor);
        expect(audit.reason).toBe('same name, birth date, club and nationality');
        expect(audit.target_type).toBe('person');
        expect(audit.previous.merged_into).toBeNull();
        expect(audit.previous.survivor_profile).toMatchObject({
          known_as: null,
          preferred_foot: 'left',
        });
        expect(audit.next).toMatchObject({ merge_id: merge, merged_into: s.survivor });
        expect(audit.next.repointed).toMatchObject({
          'lineup.person_id': 1,
          'provider_mapping.internal_id': 3, // two of its own, one from the third id
          'person_merge.into_person_id': 1,
          'incident.related_person_id': 1,
        });

        // Undo: every touched row is back, byte for byte.
        await client.query(`SELECT merge_person_undo($1, $2, 'test of the undo')`, [
          merge,
          s.actor,
        ]);
        expect(await snapshot(client, people)).toEqual(before);
        expect((await one(client, `SELECT person_merged_into($1) AS m`, [s.loser])).m).toBeNull();
        expect((await one(client, `SELECT person_merged_into($1) AS m`, [s.earlier])).m).toBe(
          s.loser,
        );
        const undo = await one<{ actor_id: string; reason: string }>(
          client,
          `SELECT a.actor_id, a.reason FROM audit_log a JOIN person_merge m ON m.undo_audit_log_id = a.id
          WHERE m.id = $1 AND a.action = 'person.unmerge'`,
          [merge],
        );
        expect(undo).toEqual({ actor_id: s.actor, reason: 'test of the undo' });
        expect(
          await refusal(client, `SELECT merge_person_undo($1, $2, 'again')`, [merge, s.actor]),
        ).toBe('already_undone');
      });
    });

    it('refuses two persons on one line-up, and allows a line-up beside statistics or a coach link', async () => {
      await inTransaction(async (client) => {
        const s = await seed(client);
        // The seed already shares a match through statistics, events, expected
        // goals, an absence and a coach link, never a line-up: allowed.
        await client.query('SAVEPOINT allowed');
        await client.query(`SELECT merge_person($1, $2, $3, 'allowed')`, [
          s.loser,
          s.survivor,
          s.actor,
        ]);
        await client.query('ROLLBACK TO SAVEPOINT allowed');

        // Now the loser is on the bench of the same match: two people.
        await client.query(
          `INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'bench')`,
          [s.participants.sharedHome, s.loser],
        );
        const before = await snapshot(client, [s.loser, s.survivor]);
        expect(
          await refusal(client, `SELECT merge_person($1, $2, $3, 'x')`, [
            s.loser,
            s.survivor,
            s.actor,
          ]),
        ).toBe('shared_lineup');
        expect(await snapshot(client, [s.loser, s.survivor])).toEqual(before);
        expect(
          (
            await one(client, `SELECT person_shared_lineup_fixture($1, $2) AS f`, [
              s.survivor,
              s.loser,
            ])
          ).f,
        ).toBe(s.fixtures.shared);
      });
    });

    it('refuses what is not a merge a person confirmed', async () => {
      await inTransaction(async (client) => {
        const s = await seed(client);
        const merge = (sql: string, values: unknown[]) => refusal(client, sql, values);
        expect(await merge(`SELECT merge_person($1, $1, $2, 'x')`, [s.loser, s.actor])).toBe(
          'same_person',
        );
        expect(await merge(`SELECT merge_person($1, $2, NULL, 'x')`, [s.loser, s.survivor])).toBe(
          'actor',
        );
        expect(
          await merge(`SELECT merge_person($1, $2, $3, ' ')`, [s.loser, s.survivor, s.actor]),
        ).toBe('reason');
        expect(
          await merge(`SELECT merge_person($1, $2, $3, 'x')`, [randomUUID(), s.survivor, s.actor]),
        ).toBe('not_found');

        await client.query(
          `INSERT INTO person_not_duplicate (low_person_id, high_person_id, decided_by, reason)
         VALUES (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), $3, 'different fathers')`,
          [s.other, s.survivor, s.actor],
        );
        expect(
          await merge(`SELECT merge_person($1, $2, $3, 'x')`, [s.other, s.survivor, s.actor]),
        ).toBe('judged_different');

        const first = (
          await one<{ id: string }>(client, `SELECT merge_person($1, $2, $3, 'one') AS id`, [
            s.earlier,
            s.loser,
            s.actor,
          ])
        ).id;
        expect(
          await merge(`SELECT merge_person($1, $2, $3, 'x')`, [s.earlier, s.survivor, s.actor]),
        ).toBe('already_merged');
        expect(
          await merge(`SELECT merge_person($1, $2, $3, 'x')`, [s.survivor, s.earlier, s.actor]),
        ).toBe('into_merged');
        // The survivor of the first merge is merged further: undo that first.
        const second = (
          await one<{ id: string }>(client, `SELECT merge_person($1, $2, $3, 'two') AS id`, [
            s.loser,
            s.survivor,
            s.actor,
          ])
        ).id;
        expect(await merge(`SELECT merge_person_undo($1, $2, 'x')`, [first, s.actor])).toBe(
          'survivor_merged',
        );
        await client.query(`SELECT merge_person_undo($1, $2, 'wrong pair')`, [second, s.actor]);
        await client.query(`SELECT merge_person_undo($1, $2, 'wrong pair')`, [first, s.actor]);

        // A merge is never rewritten or deleted, and what it moved is immutable.
        await client.query('SAVEPOINT fixed');
        await expect(
          client.query(`DELETE FROM person_merge WHERE id = $1`, [first]),
        ).rejects.toMatchObject({
          code: 'PL007',
        });
        await client.query('ROLLBACK TO SAVEPOINT fixed');
        await expect(
          client.query(`UPDATE person_merge SET reason = 'other' WHERE id = $1`, [first]),
        ).rejects.toMatchObject({ code: 'PL007' });
        await client.query('ROLLBACK TO SAVEPOINT fixed');
        await expect(
          client.query(`DELETE FROM person_merge_moved WHERE merge_id = $1`, [first]),
        ).rejects.toThrow(/immutable/);
        await client.query('ROLLBACK TO SAVEPOINT fixed');
      });
    });

    it('leaves forecasts, predictions and settlements alone: none of them names a person', async () => {
      const { rows } = await pool.query<{ col: string }>(
        `SELECT c.conrelid::regclass::text AS col
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid = 'public.person'::regclass
          AND c.conrelid::regclass::text ~ '(forecast|input_snapshot|prediction|settlement|rating|points|evaluation|power_index)'`,
      );
      expect(rows).toEqual([]);
    });
  },
);
