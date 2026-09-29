import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export type NewsRights = 'headline' | 'summary' | 'full_text';

export interface NewsSourceRow {
  id: string;
  name: string;
  homepage_url: string;
  feed_url: string;
  kind: 'rss' | 'atom';
  rights: NewsRights;
  language: string;
}

export type FetchStatus = 'succeeded' | 'partial' | 'failed';

export interface VersionFields {
  headline: string;
  summary: string | null;
  byline: string | null;
  published_at: string | null;
}

/** How the linker decides (T-142); the values live in `NewsClusteringService`. */
export interface LinkRule {
  /** A name or alias shorter than this, after folding, is too common a word to link on. */
  minimumKeyLength: number;
  /** How far from the article's time a match between the linked teams may kick off. */
  fixtureWindow: string;
  /**
   * Whether persons are linked (T-1006, D-126). Off until the rule's
   * precision has been measured on a hand-checked sample and met the bar.
   */
  persons: boolean;
}

/** A person the rule would link to an article, and the words it matched on. */
export interface PersonCandidate {
  person_id: string;
  name: string;
  key: string;
}

export interface DuplicateRule {
  /** How far apart in time two reports of one event may be. */
  window: string;
  /** Trigram similarity of the headlines with the linked names removed, 0..1. */
  threshold: number;
}

/**
 * The folded, whole-word form of a name: `search_key` (lower-cased, unaccented,
 * Arabic-folded) with every run of non-letters made one space, so "Paris
 * Saint-Germain" and "paris saint germain" are the same key and a match is a
 * match on whole words only.
 */
const KEY = (expr: string): string =>
  `btrim(regexp_replace(search_key(${expr}), '[^[:alnum:]]+', ' ', 'g'))`;

/**
 * The persons an article names (T-1006, D-126), as a CTE ending in `hit`:
 * `$1` is the article, `$2` the minimum key length.
 *
 * A person is a candidate only while they hold an open spell at a team the
 * story links, and is matched by their full name or a recorded alias, never
 * `known_as` and never one word: a key must be at least two words and `$2`
 * letters, so a surname alone ("Salah", "Silva") links nobody. The text is
 * every headline and summary of the article, folded as the team linker folds
 * them, matched on whole words. A key two squad members share links neither,
 * and so does a match inside another candidate's longer name that also
 * matched ("Bruno Guimaraes" inside "Bruno Guimaraes Rodrigues"): a name
 * that could be two people is nobody (rule 1).
 */
const PERSON_CANDIDATES = `
  WITH words AS (
    SELECT ' ' || ${KEY('v.headline')} || ' ' AS text FROM article_version v WHERE v.article_id = $1
    UNION ALL
    SELECT ' ' || ${KEY('v.summary')} || ' ' FROM article_version v
     WHERE v.article_id = $1 AND v.summary IS NOT NULL
  ),
  story_teams AS (
    SELECT DISTINCT e.entity_id AS team_id
      FROM article me
      JOIN article m ON m.story_id = me.story_id
      JOIN article_entity e ON e.article_id = m.id AND e.entity_type = 'team'
     WHERE me.id = $1
  ),
  squad AS (
    SELECT DISTINCT ps.person_id
      FROM player_spell ps JOIN story_teams st ON st.team_id = ps.team_id
     WHERE ps.end_date IS NULL
  ),
  keyed AS (
    SELECT s.person_id, ${KEY('p.full_name')} AS key
      FROM squad s JOIN person p ON p.id = s.person_id
    UNION
    SELECT s.person_id, ${KEY('a.alias')}
      FROM squad s JOIN entity_alias a ON a.entity_type = 'person' AND a.entity_id = s.person_id
  ),
  unique_key AS (
    SELECT key, (array_agg(person_id))[1] AS person_id
      FROM keyed
     WHERE length(key) >= $2 AND position(' ' IN key) > 0
     GROUP BY key
    HAVING count(DISTINCT person_id) = 1
  ),
  matched AS (
    SELECT DISTINCT u.person_id, u.key
      FROM unique_key u JOIN words w ON position(' ' || u.key || ' ' IN w.text) > 0
  ),
  hit AS (
    SELECT m.person_id, m.key
      FROM matched m
     WHERE NOT EXISTS (
             SELECT 1 FROM matched o
              WHERE o.person_id <> m.person_id
                AND (position(' ' || m.key || ' ' IN ' ' || o.key || ' ') > 0
                  OR position(' ' || o.key || ' ' IN ' ' || m.key || ' ') > 0))
  )`;

/** SQL for the news job (T-142). Writes only what the job may write. */
@Injectable()
export class PostgresNewsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Feed sources that may be read: not dropped, with a feed to read. */
  async activeSources(): Promise<NewsSourceRow[]> {
    const { rows } = await this.pool.query<NewsSourceRow>(
      `SELECT id, name, homepage_url, feed_url, kind, rights, language
         FROM news_source
        WHERE dropped_at IS NULL AND kind IN ('rss', 'atom') AND feed_url IS NOT NULL
        ORDER BY name`,
    );
    return rows;
  }

  /** Opens a run. Throws a unique violation when one is already open for the source. */
  async startFetch(sourceId: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO news_fetch (source_id) VALUES ($1) RETURNING id`,
      [sourceId],
    );
    return rows[0]!.id;
  }

  async finishFetch(
    id: string,
    outcome: { status: FetchStatus; itemsSeen: number; itemsWritten: number; error: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE news_fetch
          SET status = $2, finished_at = now(), items_seen = $3, items_written = $4, error = $5
        WHERE id = $1 AND status = 'running'`,
      [id, outcome.status, outcome.itemsSeen, outcome.itemsWritten, outcome.error],
    );
  }

  /**
   * The article for a feed item, by the identity the feed gave it. An item
   * seen before is touched (`fetched_at`, and the link, which publishers do
   * move); a new one gets a story of its own, which clustering may later merge.
   */
  async upsertArticle(
    sourceId: string,
    externalId: string,
    url: string,
  ): Promise<{ id: string; inserted: boolean }> {
    const existing = await this.pool.query<{ id: string }>(
      `UPDATE article SET fetched_at = now(), url = $3
        WHERE source_id = $1 AND external_id = $2
        RETURNING id`,
      [sourceId, externalId, url],
    );
    const found = existing.rows[0];
    if (found !== undefined) return { id: found.id, inserted: false };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const story = await client.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [sourceId, story.rows[0]!.id, externalId, url],
      );
      await client.query('COMMIT');
      return { id: rows[0]!.id, inserted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The newest version in a language, or null when there is none yet. */
  async newestVersion(
    articleId: string,
    language: string,
  ): Promise<(VersionFields & { version_number: number }) | null> {
    const { rows } = await this.pool.query<VersionFields & { version_number: number }>(
      `SELECT version_number, headline, summary, byline, published_at
         FROM article_version
        WHERE article_id = $1 AND language = $2
        ORDER BY version_number DESC
        LIMIT 1`,
      [articleId, language],
    );
    return rows[0] ?? null;
  }

  async addVersion(
    articleId: string,
    language: string,
    versionNumber: number,
    fields: VersionFields,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO article_version
         (article_id, language, version_number, headline, summary, byline, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        articleId,
        language,
        versionNumber,
        fields.headline,
        fields.summary,
        fields.byline,
        fields.published_at,
      ],
    );
  }

  /**
   * Links the teams and competitions a headline names, by a whole-word match
   * of the entity's own name or a recorded alias (rule 1: by id, never by
   * guess), across every version the article has. Then the match: when
   * exactly one fixture between the linked teams kicks off within the window
   * of the article's time, the article is about it; two candidates link none.
   * Then, when `rule.persons` is on, the persons of `PERSON_CANDIDATES`.
   * Returns how many links the article has afterwards.
   */
  async linkEntities(articleId: string, rule: LinkRule): Promise<number> {
    await this.pool.query(
      `WITH headline AS (
         SELECT ' ' || ${KEY('v.headline')} || ' ' AS text
           FROM article_version v
          WHERE v.article_id = $1
       ),
       candidate AS (
         SELECT 'team' AS entity_type, t.id AS entity_id, t.name AS label FROM team t
         UNION ALL
         SELECT 'competition', c.id, c.name FROM competition c
         UNION ALL
         SELECT a.entity_type, a.entity_id, a.alias
           FROM entity_alias a
          WHERE a.entity_type IN ('team', 'competition')
       ),
       keyed AS (
         SELECT entity_type, entity_id, ${KEY('label')} AS key FROM candidate
       )
       INSERT INTO article_entity (article_id, entity_type, entity_id)
       SELECT DISTINCT $1::uuid, k.entity_type, k.entity_id
         FROM keyed k CROSS JOIN headline h
        WHERE length(k.key) >= $2 AND position(' ' || k.key || ' ' IN h.text) > 0
       ON CONFLICT DO NOTHING`,
      [articleId, rule.minimumKeyLength],
    );
    await this.pool.query(
      `WITH moment AS (
         SELECT COALESCE(
                  (SELECT min(published_at) FROM article_version WHERE article_id = a.id),
                  a.fetched_at) AS at
           FROM article a
          WHERE a.id = $1
       ),
       linked AS (
         SELECT entity_id AS team_id FROM article_entity WHERE article_id = $1 AND entity_type = 'team'
       ),
       candidate AS (
         SELECT f.id
           FROM fixture f, moment m
          WHERE f.kickoff_at BETWEEN m.at - $2::interval AND m.at + $2::interval
            AND (SELECT count(*)
                   FROM fixture_participant p JOIN linked l ON l.team_id = p.team_id
                  WHERE p.fixture_id = f.id) = 2
       )
       INSERT INTO article_entity (article_id, entity_type, entity_id)
       SELECT $1::uuid, 'fixture', id
         FROM candidate
        WHERE (SELECT count(*) FROM candidate) = 1
       ON CONFLICT DO NOTHING`,
      [articleId, rule.fixtureWindow],
    );
    if (rule.persons) {
      await this.pool.query(
        `${PERSON_CANDIDATES}
         INSERT INTO article_entity (article_id, entity_type, entity_id)
         SELECT DISTINCT $1::uuid, 'person', person_id FROM hit
         ON CONFLICT DO NOTHING`,
        [articleId, rule.minimumKeyLength],
      );
    }
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM article_entity WHERE article_id = $1`,
      [articleId],
    );
    return Number(rows[0]!.n);
  }

  /**
   * The persons the rule would link to an article, without writing anything:
   * what `linkEntities` inserts when persons are on, and what the precision
   * sample (`cli/person-link-sample.ts`) shows a person to check by hand.
   */
  async personCandidates(articleId: string, minimumKeyLength: number): Promise<PersonCandidate[]> {
    const { rows } = await this.pool.query<PersonCandidate>(
      `${PERSON_CANDIDATES}
       SELECT h.person_id, p.full_name AS name, h.key
         FROM hit h JOIN person p ON p.id = h.person_id
        ORDER BY h.key, h.person_id`,
      [articleId, minimumKeyLength],
    );
    return rows;
  }

  /**
   * A random sample of stored articles that link at least one team (the only
   * ones the person rule can speak about), each with its newest headline and
   * summary: the input of the precision check (D-126). Read-only.
   */
  async samplePersonArticles(
    size: number,
  ): Promise<{ id: string; headline: string; summary: string | null }[]> {
    const { rows } = await this.pool.query<{
      id: string;
      headline: string;
      summary: string | null;
    }>(
      `SELECT a.id, v.headline, v.summary
         FROM article a
         JOIN LATERAL (
           SELECT headline, summary FROM article_version
            WHERE article_id = a.id ORDER BY created_at DESC, version_number DESC LIMIT 1
         ) v ON TRUE
        WHERE EXISTS (SELECT 1 FROM article_entity e WHERE e.article_id = a.id AND e.entity_type = 'team')
        ORDER BY random()
        LIMIT $1`,
      [size],
    );
    return rows;
  }

  /**
   * The story another publisher's report of the same event already has, or
   * null. A candidate links exactly the same teams, comes from a different
   * source, and was published within the window. The headlines are compared
   * with every name and alias of the linked entities removed first: two
   * headlines that both say "Arsenal" and "Chelsea" look alike to a trigram
   * whether they report the same match or not, and the words left after the
   * names are what tells a duplicate from a different story.
   */
  async duplicateOf(
    articleId: string,
    rule: DuplicateRule,
  ): Promise<{ storyId: string; score: number } | null> {
    const { rows } = await this.pool.query<{ story_id: string; score: number }>(
      `WITH me AS (
         SELECT a.id, a.source_id, a.story_id,
                COALESCE((SELECT min(published_at) FROM article_version WHERE article_id = a.id),
                         a.fetched_at) AS at
           FROM article a
          WHERE a.id = $1
       ),
       my_teams AS (
         SELECT array_agg(entity_id ORDER BY entity_id) AS teams
           FROM article_entity
          WHERE article_id = $1 AND entity_type = 'team'
       ),
       near AS (
         SELECT b.id, b.story_id, b.at
           FROM (SELECT b.id, b.story_id, b.source_id,
                        COALESCE((SELECT min(published_at) FROM article_version WHERE article_id = b.id),
                                 b.fetched_at) AS at
                   FROM article b) b, me, my_teams
          WHERE my_teams.teams IS NOT NULL
            AND b.id <> me.id
            AND b.source_id <> me.source_id
            AND b.story_id <> me.story_id
            AND b.at BETWEEN me.at - $2::interval AND me.at + $2::interval
            AND (SELECT array_agg(entity_id ORDER BY entity_id)
                   FROM article_entity
                  WHERE article_id = b.id AND entity_type = 'team') = my_teams.teams
       ),
       involved AS (SELECT id FROM me UNION SELECT id FROM near),
       pattern AS (
         SELECT e.article_id, '\\m(' || string_agg(DISTINCT k.key, '|') || ')\\M' AS re
           FROM article_entity e
           JOIN involved i ON i.id = e.article_id
           JOIN LATERAL (
             SELECT ${KEY('t.name')} AS key FROM team t
              WHERE e.entity_type = 'team' AND t.id = e.entity_id
             UNION ALL
             SELECT ${KEY('c.name')} FROM competition c
              WHERE e.entity_type = 'competition' AND c.id = e.entity_id
             UNION ALL
             SELECT ${KEY('al.alias')} FROM entity_alias al
              WHERE al.entity_type = e.entity_type AND al.entity_id = e.entity_id
           ) k ON k.key <> ''
          GROUP BY e.article_id
       ),
       remainder AS (
         SELECT v.article_id,
                btrim(regexp_replace(
                  CASE WHEN p.re IS NULL THEN ${KEY('v.headline')}
                       ELSE regexp_replace(${KEY('v.headline')}, p.re, ' ', 'g') END,
                  '\\s+', ' ', 'g')) AS words
           FROM article_version v
           JOIN involved i ON i.id = v.article_id
           LEFT JOIN pattern p ON p.article_id = v.article_id
       )
       SELECT n.story_id, max(similarity(mine.words, theirs.words))::float8 AS score
         FROM near n
         JOIN remainder mine ON mine.article_id = $1
         JOIN remainder theirs ON theirs.article_id = n.id
        WHERE mine.words <> '' AND theirs.words <> ''
        GROUP BY n.id, n.story_id, n.at
       HAVING max(similarity(mine.words, theirs.words)) >= $3
        ORDER BY score DESC, n.at ASC
        LIMIT 1`,
      [articleId, rule.window, rule.threshold],
    );
    const hit = rows[0];
    return hit === undefined ? null : { storyId: hit.story_id, score: hit.score };
  }

  async storyOf(articleId: string): Promise<string> {
    const { rows } = await this.pool.query<{ story_id: string }>(
      `SELECT story_id FROM article WHERE id = $1`,
      [articleId],
    );
    return rows[0]!.story_id;
  }

  /**
   * Moves an article into a story, drops the story it leaves when that one is
   * now empty (moving any saves of it onto the target, T-842), and promotes the target's original -- one transaction, so no
   * reader sees a story with nothing in it or a cluster with no original.
   */
  async moveToStory(articleId: string, storyId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ story_id: string }>(
        `SELECT story_id FROM article WHERE id = $1 FOR UPDATE`,
        [articleId],
      );
      const from = rows[0]!.story_id;
      await client.query(`UPDATE article SET story_id = $2 WHERE id = $1`, [articleId, storyId]);
      // A member who saved the story being emptied keeps it, as the story it
      // joined (T-842); the delete below would otherwise take their row with it.
      await client.query(
        `INSERT INTO saved_article (user_id, story_id, article_id, source_id, saved_at)
         SELECT sa.user_id, $2, sa.article_id, sa.source_id, sa.saved_at
           FROM saved_article sa
          WHERE sa.story_id = $1
            AND NOT EXISTS (SELECT 1 FROM article WHERE story_id = $1)
         ON CONFLICT (user_id, story_id) DO NOTHING`,
        [from, storyId],
      );
      await client.query(
        `DELETE FROM story WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM article WHERE story_id = $1)`,
        [from],
      );
      await client.query(PROMOTE, [storyId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Sets the story's original: the earliest published report, then the earliest fetched. */
  async promoteOriginal(storyId: string): Promise<void> {
    await this.pool.query(PROMOTE, [storyId]);
  }
}

/**
 * The original of a story is the report that came first (blueprint 3.3: "the
 * strongest original"), and first means published first, then fetched first
 * for the ones whose publisher gave no time. A story with one article is its
 * own original, so the column always answers.
 */
const PROMOTE = `
  UPDATE story s
     SET promoted_article_id = (
       SELECT a.id
         FROM article a
        WHERE a.story_id = s.id
        ORDER BY (SELECT min(published_at) FROM article_version WHERE article_id = a.id) ASC NULLS LAST,
                 a.fetched_at ASC, a.id ASC
        LIMIT 1)
   WHERE s.id = $1`;
