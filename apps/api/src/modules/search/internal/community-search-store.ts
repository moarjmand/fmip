import { Inject, Injectable } from '@nestjs/common';
import type { GroupSearchResult, MemberSearchResult, StorySearchResult } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { MIN_SIMILARITY } from './search-store';

/**
 * SQL for the kinds members and publishers make (T-642, D-087): the same
 * matching as the catalog's -- `search_key()` on both sides, trigram word
 * similarity or prefix, the same threshold -- so a headline, a group name and
 * a display name fold accents and Arabic-script letter forms exactly as a
 * team's name does.
 *
 * **Who can be found is decided here, in the WHERE clause, and nowhere else.**
 * Nothing is fetched and filtered afterwards, so a row the rules exclude never
 * leaves the database:
 *
 *   - a story is its promoted original from a source that has not been
 *     dropped (the news page's own rule, D-061), headline and link only;
 *   - a group is public or discoverable -- invite-only is never a result,
 *     because being found is exactly what that visibility withholds;
 *   - a member has an active account and a **public** profile (no
 *     `privacy_setting` row means public, as everywhere else). A friends-only
 *     profile is not a result even for a friend: search is not the place a
 *     friendship is looked up, and a guest and a member must not be able to
 *     tell a friends-only member from one who does not exist. When the viewer
 *     is signed in, `users_blocked()` removes anybody on either side of a
 *     block.
 */
@Injectable()
export class PostgresCommunitySearchStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Over the report each story shows this reader (D-178); no locale, the promoted original. */
  async stories(
    q: string,
    limit: number,
    locale: string | null = null,
  ): Promise<StorySearchResult[]> {
    const { rows } = await this.pool.query<{
      story_id: string;
      headline: string;
      language: string;
      source_name: string;
      url: string;
      published_at: Date;
      score: string;
    }>(
      `WITH q AS (SELECT search_key($1) AS key),
       hits AS (
         SELECT DISTINCT ON (s.id)
                s.id AS story_id, v.headline, v.language, src.name AS source_name, a.url,
                v.published_at,
                GREATEST(
                  word_similarity(q.key, search_key(v.headline)),
                  CASE WHEN search_key(v.headline) LIKE q.key || '%' THEN 1 ELSE 0 END
                ) AS score
           FROM story s
           JOIN article a ON a.id = story_shown_article(s.id, s.promoted_article_id, $4::text)
           JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
           -- The newest version in each language: an older headline is what
           -- the story used to say, not what it says.
           JOIN LATERAL (
             SELECT DISTINCT ON (language) headline, language, published_at
               FROM article_version
              WHERE article_id = a.id
              ORDER BY language, created_at DESC, version_number DESC
           ) v ON TRUE
           CROSS JOIN q
          ORDER BY s.id, score DESC, v.language
       )
       SELECT story_id, headline, language, source_name, url, published_at,
              round(score::numeric, 3)::text AS score
         FROM hits
        WHERE score >= $3
        ORDER BY score DESC, published_at DESC, story_id
        LIMIT $2`,
      [q, limit, MIN_SIMILARITY, locale],
    );
    return rows.map((r) => ({
      story_id: r.story_id,
      headline: r.headline,
      language: r.language,
      source_name: r.source_name,
      url: r.url,
      published_at: r.published_at.toISOString(),
      score: Number(r.score),
    }));
  }

  async groups(q: string, limit: number): Promise<GroupSearchResult[]> {
    const { rows } = await this.pool.query<{
      slug: string;
      name: string;
      visibility: GroupSearchResult['visibility'];
      member_count: number;
      score: string;
    }>(
      `WITH q AS (SELECT search_key($1) AS key),
       hits AS (
         SELECT g.slug, g.name, g.visibility,
                (SELECT count(*)::int FROM group_member m WHERE m.group_id = g.id) AS member_count,
                GREATEST(
                  word_similarity(q.key, search_key(g.name)),
                  CASE WHEN search_key(g.name) LIKE q.key || '%' THEN 1 ELSE 0 END,
                  CASE WHEN g.slug LIKE q.key || '%' THEN 1 ELSE 0 END
                ) AS score
           FROM user_group g CROSS JOIN q
          WHERE g.visibility IN ('public', 'discoverable') AND g.closed_at IS NULL
       )
       SELECT slug, name, visibility, member_count, round(score::numeric, 3)::text AS score
         FROM hits
        WHERE score >= $3
        ORDER BY score DESC, member_count DESC, name, slug
        LIMIT $2`,
      [q, limit, MIN_SIMILARITY],
    );
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      visibility: r.visibility,
      member_count: r.member_count,
      score: Number(r.score),
    }));
  }

  async members(q: string, viewerId: string | null, limit: number): Promise<MemberSearchResult[]> {
    const { rows } = await this.pool.query<{
      username: string;
      display_name: string;
      score: string;
    }>(
      `WITH q AS (SELECT search_key($1) AS key),
       hits AS (
         SELECT u.username, u.display_name,
                GREATEST(
                  word_similarity(q.key, search_key(u.display_name)),
                  CASE WHEN search_key(u.display_name) LIKE q.key || '%' THEN 1 ELSE 0 END,
                  CASE WHEN u.username LIKE q.key || '%' THEN 1 ELSE 0 END
                ) AS score
           FROM user_account u
           CROSS JOIN q
           LEFT JOIN privacy_setting ps ON ps.user_id = u.id
          WHERE u.status = 'active'
            AND COALESCE(ps.profile_visibility, 'public') = 'public'
            AND ($4::uuid IS NULL OR NOT users_blocked($4::uuid, u.id))
       )
       SELECT username, display_name, round(score::numeric, 3)::text AS score
         FROM hits
        WHERE score >= $3
        ORDER BY score DESC, username
        LIMIT $2`,
      [q, limit, MIN_SIMILARITY, viewerId],
    );
    return rows.map((r) => ({
      username: r.username,
      display_name: r.display_name,
      score: Number(r.score),
    }));
  }
}
