import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresNewsReadStore } from './internal/news-read-store';
import { PostgresNewsStore, type LinkRule } from './internal/news-store';
import { FIXTURE_WINDOW, MINIMUM_NAME_LENGTH } from './news-clustering.service';

/**
 * Persons linked to stories (T-1006, D-126) against the real schema: a person
 * is linked by full name or recorded alias, as whole words, only while they
 * hold an open spell at a team the story links, and only when no other person
 * in those squads answers to the same words. A surname alone links nobody.
 * With the switch off, nobody is linked at all.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const HOME = randomUUID();
const ELSEWHERE = randomUUID();
const HOME_NAME = `Personville ${RUN}`;
const ON: LinkRule = {
  minimumKeyLength: MINIMUM_NAME_LENGTH,
  fixtureWindow: FIXTURE_WINDOW,
  persons: true,
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'persons linked to stories (T-1006)',
  () => {
    let pool: Pool;
    let store: PostgresNewsStore;
    let source: string;
    const people: Record<string, string> = {};
    const stories: string[] = [];

    /** A person, with an open (or closed) spell at a team. */
    async function person(
      label: string,
      fullName: string,
      team: string,
      open = true,
      aliases: string[] = [],
    ): Promise<void> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO person (full_name) VALUES ($1) RETURNING id`,
        [fullName],
      );
      const id = rows[0]!.id;
      people[label] = id;
      await pool.query(
        `INSERT INTO player_spell (person_id, team_id, start_date, end_date)
         VALUES ($1, $2, '2024-07-01', $3)`,
        [id, team, open ? null : '2025-06-30'],
      );
      for (const alias of aliases) {
        await pool.query(
          `INSERT INTO entity_alias (entity_type, entity_id, alias, kind, source)
           VALUES ('person', $1, $2, 'alias', 'admin')`,
          [id, alias],
        );
      }
    }

    /** An article with one headline (and summary), placed as the job places it. */
    async function article(
      headline: string,
      summary: string | null = null,
      rule: LinkRule = ON,
    ): Promise<{ articleId: string; storyId: string; persons: string[] }> {
      const { id } = await store.upsertArticle(source, randomUUID(), 'https://scripted.test/p');
      await store.addVersion(id, 'en', 1, {
        headline,
        summary,
        byline: null,
        published_at: '2026-09-20T10:00:00Z',
      });
      await store.linkEntities(id, rule);
      const storyId = await store.storyOf(id);
      stories.push(storyId);
      await store.promoteOriginal(storyId);
      const { rows } = await pool.query<{ entity_id: string }>(
        `SELECT entity_id FROM article_entity WHERE article_id = $1 AND entity_type = 'person'
          ORDER BY entity_id`,
        [id],
      );
      return { articleId: id, storyId, persons: rows.map((r) => r.entity_id) };
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new PostgresNewsStore(pool);
      await pool.query(
        `INSERT INTO team (id, country_id, name, kind, gender)
         VALUES ($1, $3, $4, 'club', 'men'), ($2, $3, $5, 'club', 'men')`,
        [HOME, ELSEWHERE, ENGLAND, HOME_NAME, `Farawayton ${RUN}`],
      );
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://scripted.test', $2, 'rss', 'summary', 'en') RETURNING id`,
        [`Persons ${RUN}`, `https://scripted.test/persons-${RUN}.xml`],
      );
      source = src.rows[0]!.id;
      await person('kai', `Kai Strikeson${RUN}`, HOME, true, [`Kaiser ${RUN}`]);
      await person('gone', `Olaf Leftson${RUN}`, HOME, false);
      await person('away', `Ivo Awayman${RUN}`, ELSEWHERE);
      await person('twinA', `Sam Twinning${RUN}`, HOME);
      await person('twinB', `Sam Twinning${RUN}`, HOME);
      await person('short', `Bruno Guim${RUN}`, HOME);
      await person('long', `Bruno Guim${RUN} Rodri`, HOME);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      if (stories.length > 0) {
        await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      }
      const ids = Object.values(people);
      await pool.query(
        `DELETE FROM entity_alias WHERE entity_type = 'person' AND entity_id = ANY($1::uuid[])`,
        [ids],
      );
      await pool.query(`DELETE FROM player_spell WHERE person_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, ELSEWHERE]]);
      await pool.end();
    });

    it('links a squad member by full name, by id, and a recorded alias from the summary', async () => {
      const byName = await article(`Kai Strikeson${RUN} scores twice for ${HOME_NAME}`);
      expect(byName.persons).toEqual([people.kai]);
      const byAlias = await article(
        `${HOME_NAME} win at last`,
        `Kaiser ${RUN} settled it in the second half.`,
      );
      expect(byAlias.persons).toEqual([people.kai]);
    });

    it('links nobody on a surname alone', async () => {
      const { persons } = await article(`Strikeson${RUN} scores twice for ${HOME_NAME}`);
      expect(persons).toEqual([]);
    });

    it('links nobody without a team the story links, or outside its current squads', async () => {
      expect((await article(`Kai Strikeson${RUN} scores twice`)).persons).toEqual([]);
      expect((await article(`Olaf Leftson${RUN} returns to ${HOME_NAME}`)).persons).toEqual([]);
      expect((await article(`Ivo Awayman${RUN} watches ${HOME_NAME}`)).persons).toEqual([]);
    });

    it('links neither of two squad members a name could mean', async () => {
      expect((await article(`Sam Twinning${RUN} injured, says ${HOME_NAME}`)).persons).toEqual([]);
      expect((await article(`Bruno Guim${RUN} Rodri signs for ${HOME_NAME}`)).persons).toEqual([]);
    });

    it('links nobody with the switch off, and says what it would link without writing', async () => {
      const off = await article(`Kai Strikeson${RUN} again for ${HOME_NAME}`, null, {
        ...ON,
        persons: false,
      });
      expect(off.persons).toEqual([]);
      const candidates = await store.personCandidates(off.articleId, MINIMUM_NAME_LENGTH);
      expect(candidates.map((c) => c.person_id)).toEqual([people.kai]);
      expect(candidates[0]!.key).toBe(`kai strikeson${RUN}`.toLowerCase());
    });

    it("puts a linked person's story in the following section of whoever follows them", async () => {
      const linked = await article(`Kai Strikeson${RUN} extends his deal with ${HOME_NAME}`);
      const read = new PostgresNewsReadStore(pool);
      const page = await read.following(
        {
          country: null,
          competition: null,
          team: null,
          language: null,
          type: null,
          player: null,
          from: null,
          to: null,
          time_zone: 'UTC',
        },
        null,
        { teams: [], competitions: [], persons: [people.kai!] },
        null,
        50,
      );
      const card = page.cards.find((c) => c.story_id === linked.storyId);
      expect(card?.entities).toContainEqual(
        expect.objectContaining({ entity_type: 'person', entity_id: people.kai }),
      );
    });
  },
);
