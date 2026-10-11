import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresNewsStore, type LinkRule } from './internal/news-store';
import { FIXTURE_WINDOW, MINIMUM_NAME_LENGTH } from './news-clustering.service';

/**
 * Which teams and competitions a story is filed under (T-1396, D-211),
 * against the real schema. Every headline below stood on production's English
 * pages on 2026-10-12, filed under a club it is not about; the catalogue rows
 * carry the names production stores ("Derby" for Derby County, "Junior",
 * "Trafford", "Europa", "Inter", "Championship"). A name links only where the
 * headline writes it as a name: capitalised where the headline has case, and
 * not inside a longer catalogued name written at the same place.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RULE: LinkRule = {
  minimumKeyLength: MINIMUM_NAME_LENGTH,
  fixtureWindow: FIXTURE_WINDOW,
  persons: false,
};

const ids = {
  derby: randomUUID(),
  inter: randomUUID(),
  interMiami: randomUUID(),
  trafford: randomUUID(),
  junior: randomUUID(),
  europa: randomUUID(),
  championship: randomUUID(),
  europaLeague: randomUUID(),
  persianClub: randomUUID(),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news tagging (T-1396)', () => {
  let pool: Pool;
  let store: PostgresNewsStore;
  let source: string;
  let venue: string;
  let person: string;
  const stories: string[] = [];

  /** An article with one headline, placed as the job places it; its team and competition links. */
  async function filed(
    headline: string,
    seed: string[] = [],
  ): Promise<{ id: string; links: string[] }> {
    const { id } = await store.upsertArticle(
      source,
      randomUUID(),
      `https://tagging.test/${randomUUID()}`,
    );
    await store.addVersion(id, 'en', 1, {
      headline,
      summary: null,
      byline: null,
      published_at: '2026-10-11T20:00:00Z',
    });
    // A link the rule before T-1396 made, to show placing again removes it.
    for (const entity of seed) {
      const type =
        entity === ids.championship || entity === ids.europaLeague ? 'competition' : 'team';
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [id, type, entity],
      );
    }
    stories.push(await store.storyOf(id));
    await store.linkEntities(id, RULE);
    return { id, links: await links(id) };
  }

  async function links(articleId: string): Promise<string[]> {
    const { rows } = await pool.query<{ entity_id: string }>(
      `SELECT entity_id FROM article_entity
          WHERE article_id = $1 AND entity_type IN ('team', 'competition')`,
      [articleId],
    );
    return rows.map((r) => r.entity_id).filter((e) => (Object.values(ids) as string[]).includes(e));
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PostgresNewsStore(pool);
    const teams: [string, string][] = [
      [ids.derby, 'Derby'],
      [ids.inter, 'Inter'],
      [ids.interMiami, 'Inter Miami'],
      [ids.trafford, 'Trafford'],
      [ids.junior, 'Junior'],
      [ids.europa, 'Europa'],
      [ids.persianClub, 'Tastabad'],
    ];
    for (const [id, name] of teams) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
        [id, ENGLAND, name],
      );
    }
    await pool.query(
      `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, 'تست‌آباد', 'fa', 'transliteration', 'test')`,
      [ids.persianClub],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $3, 'Championship', 'league', 'domestic', 'men'),
                ($2, NULL, 'UEFA Europa League', 'cup', 'continental', 'men')`,
      [ids.championship, ids.europaLeague, ENGLAND],
    );
    // What migration 1765855000000 records for the provider's league 3.
    await pool.query(
      `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('competition', $1, 'Europa League', 'en', 'alias', 'test')`,
      [ids.europaLeague],
    );
    const v = await pool.query<{ id: string }>(
      `INSERT INTO venue (name, city) VALUES ('Old Trafford', 'Manchester') RETURNING id`,
    );
    venue = v.rows[0]!.id;
    const p = await pool.query<{ id: string }>(
      `INSERT INTO person (full_name, known_as)
         VALUES ('Vinícius José Paixão de Oliveira Júnior', 'Vinícius Júnior') RETURNING id`,
    );
    person = p.rows[0]!.id;
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://tagging.test', NULL, 'licensed', 'summary', 'en') RETURNING id`,
      // No feed: a job reading every active feed (another spec's) never reaches it.
      [`Tagging ${randomUUID()}`],
    );
    source = src.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    if (stories.length > 0) {
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    }
    const all = Object.values(ids);
    await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [all]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [all]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [all]);
    await pool.query(`DELETE FROM venue WHERE id = $1`, [venue]);
    await pool.query(`DELETE FROM person WHERE id = $1`, [person]);
    await pool.end();
  });

  it('does not file a derby under Derby: the noun is written in lower case', async () => {
    for (const headline of [
      '📋 Grêmio and Internacional line-ups for the relegation-battle derby',
      '📋 High stakes! Flamengo and Fluminense line-ups for the Maracanã derby',
      '10-man Southampton battle to derby win in Tonda Eckert’s first game since Spygate punishment',
      'Ten-man Southampton beat Portsmouth in heated derby',
      '🔥 That’s a Rhine derby! Köln and Gladbach put on a superb show',
    ]) {
      expect((await filed(headline, [ids.derby])).links, headline).toEqual([]);
    }
    // The club, written as a name, is still filed.
    expect((await filed('Derby defeat ‘one that got away’ for Pompey')).links).toEqual([ids.derby]);
  });

  it('does not file the Championship under a lower-case championship', async () => {
    for (const headline of [
      'Morgan Park holds off King’s challenge, will play in Public League championship next week',
      'UCLA Bruins upset Oregon Ducks to stay unbeaten and change the Big Ten championship picture',
    ]) {
      expect((await filed(headline, [ids.championship])).links, headline).toEqual([]);
    }
    expect((await filed('Championship leaders stretch their lead')).links).toEqual([
      ids.championship,
    ]);
  });

  it('does not file a name written inside a longer name', async () => {
    // Another club's name.
    expect(
      (
        await filed(
          'MLS: Inter Miami’s Lionel Messi nets twice against DC United in first match since Argentina farewell',
          [ids.inter, ids.interMiami],
        )
      ).links,
    ).toEqual([ids.interMiami]);
    // A ground's name.
    expect(
      (
        await filed('Soccer-Spurs show fight as United’s struggles deepen at Old Trafford', [
          ids.trafford,
        ])
      ).links,
    ).toEqual([]);
    // A player's name.
    expect(
      (
        await filed('🤔 What punishment could Vinicius Junior face before El Clásico?', [
          ids.junior,
        ])
      ).links,
    ).toEqual([]);
    // A competition's name, which is filed instead.
    expect(
      (
        await filed(
          'Lyon striker Loïs Openda likely to miss Europa League clash with Crystal Palace',
          [ids.europa],
        )
      ).links,
    ).toEqual([ids.europaLeague]);
    // The shorter name on its own is still the club.
    expect((await filed('Today’s Papers – Inter’s sprint, Fabregas taunts Italy')).links).toEqual([
      ids.inter,
    ]);
  });

  it('still links a name in a script without case', async () => {
    expect((await filed('پیروزی تست‌آباد در هفته دوم')).links).toEqual([ids.persianClub]);
  });

  it('re-checks the links already stored by the same rule, as the migration does', async () => {
    // Stored by the old rule, not placed again: the migration's question.
    const { id } = await store.upsertArticle(
      source,
      randomUUID(),
      `https://tagging.test/${randomUUID()}`,
    );
    stories.push(await store.storyOf(id));
    await store.addVersion(id, 'en', 1, {
      headline: 'Ten-man Southampton beat Derby in heated derby',
      summary: null,
      byline: null,
      published_at: '2026-10-11T20:00:00Z',
    });
    await pool.query(
      `INSERT INTO article_entity (article_id, entity_type, entity_id)
         VALUES ($1, 'team', $2), ($1, 'team', $3)`,
      [id, ids.derby, ids.trafford],
    );
    const { rows } = await pool.query<{ entity_type: string; entity_id: string }>(
      `SELECT entity_type, entity_id FROM news_named_entities($1, $2, true)`,
      [id, MINIMUM_NAME_LENGTH],
    );
    // "Derby" is written once as a name; nothing writes "Trafford".
    expect(rows).toEqual([{ entity_type: 'team', entity_id: ids.derby }]);
  });

  it('can remove a stored link: the tag table has no immutability trigger', async () => {
    const { rows } = await pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'article_entity'::regclass AND NOT tgisinternal`,
    );
    expect(rows).toEqual([]);
  });
});
