import { Inject, Injectable } from '@nestjs/common';
import { TRENDING_WEIGHTS } from '@fmip/contracts';
import type {
  NewsEntity,
  NewsFilters,
  NewsImage,
  NewsImageLicence,
  NewsReport,
  NewsRights,
  NewsStoryCard,
  ReviewState,
  StoryLabelOrigin,
  StoryPage,
  StoryType,
  VersionOrigin,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { shownImageJoin } from './news-image-store';

/** The shown photo's columns, as every card query selects them (T-1322). */
interface ImageColumns {
  image_file_key: string | null;
  image_credit: string | null;
  image_licence: NewsImageLicence | null;
  image_licence_url: string | null;
  image_width: number | null;
  image_height: number | null;
}

/** Our own URL for a stored photo, and what a reader must see beside it (D-177). */
function imageOf(r: ImageColumns): NewsImage | null {
  if (
    r.image_file_key === null ||
    r.image_credit === null ||
    r.image_licence === null ||
    r.image_licence_url === null
  ) {
    return null;
  }
  return {
    url: `/media/${r.image_file_key}`,
    credit: r.image_credit,
    licence: r.image_licence,
    licence_url: r.image_licence_url,
    width: r.image_width,
    height: r.image_height,
  };
}

/** The ids a member follows, by type; what the following section is computed from. */
export interface Followed {
  teams: string[];
  competitions: string[];
  persons: string[];
}

/** One page of a section. */
export interface StoryPage_ {
  cards: NewsStoryCard[];
  /** The `at` of the last card when more exist beyond `limit`; the next page's `before`. */
  nextBefore: string | null;
}

interface CardRow extends ImageColumns {
  story_id: string;
  article_id: string;
  headline: string;
  summary: string | null;
  byline: string | null;
  language: string;
  origin: VersionOrigin;
  review_state: ReviewState | null;
  published_at: Date | null;
  fetched_at: Date;
  url: string;
  source_id: string;
  source_name: string;
  homepage_url: string;
  rights: NewsRights;
  other_reports: number;
  story_type: StoryType | null;
  type_origin: StoryLabelOrigin | null;
  labelled_at: Date | null;
  breaking_note: string | null;
  breaking_marked_at: Date | null;
  breaking_ends_at: Date | null;
  at: Date;
  participants: number | null;
  /** Trending only (T-1008); the other sections do not select it. */
  savers?: number | null;
  debate_selected_at: Date | null;
  debate_note: string | null;
}

interface EntityRow {
  story_id: string;
  entity_type: NewsEntity['entity_type'];
  entity_id: string;
  name: string | null;
  localised_name: string | null;
}

/**
 * The read side of news (T-143): a story as its promoted original, from a
 * publisher that still grants it, with only what the source's rights allow.
 *
 * Every section starts from the same card and differs in what it joins and
 * how it orders; the filters apply to the whole cluster (a story about a team
 * is a story any of whose reports links the team), so a filter never hides a
 * story because the original happened to name the club differently.
 */
@Injectable()
export class PostgresNewsReadStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** When the feeds were last read: the freshness a page carries (rule 4). */
  async lastFetchedAt(): Promise<string | null> {
    const { rows } = await this.pool.query<{ at: Date | null }>(
      `SELECT max(finished_at) AS at FROM news_fetch WHERE status IN ('succeeded', 'partial')`,
    );
    return rows[0]?.at?.toISOString() ?? null;
  }

  /**
   * With a type filter (T-1003, D-124): how many stories matching every other
   * filter have no current type, so a reader is told what the filter cannot
   * place rather than seeing a short list as the whole of it.
   */
  async untyped(filters: NewsFilters): Promise<number> {
    const q = new Query({ ...filters, type: null }, null);
    const { rows } = await this.pool.query<{ n: number }>(
      `${q.storyCard()} SELECT count(*)::int AS n FROM story_card sc WHERE sc.story_type IS NULL`,
      q.params,
    );
    return rows[0]?.n ?? 0;
  }

  /** Whether any report links any person yet (T-1006 writes them); a player filter needs one. */
  async anyPersonLinked(): Promise<boolean> {
    const { rows } = await this.pool.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM article_entity WHERE entity_type = 'person') AS found`,
    );
    return rows[0]?.found === true;
  }

  /** Newest first, by the publisher's time (else the fetch time); `before` pages back. */
  async latest(
    filters: NewsFilters,
    locale: string | null,
    before: string | null,
    limit: number,
  ): Promise<StoryPage_> {
    const q = new Query(filters, locale);
    const cursor = before === null ? '' : `AND sc.at < ${q.param(before)}::timestamptz`;
    return this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note
         FROM story_card sc
        WHERE TRUE ${cursor}
        ORDER BY sc.at DESC, sc.story_id
        LIMIT ${q.param(limit + 1)}`,
      limit,
    );
  }

  /**
   * Stories discussed or saved inside the window (T-1008, D-128), ranked by
   * `TRENDING_WEIGHTS`: distinct members on the public panel of the story's
   * matches -- a post or a reaction, each member once -- and distinct members
   * who saved the story. A save moved onto a story by a cluster merge is one
   * row per member (`saved_article`'s key), so it counts once, at the time it
   * was first saved. Views and shares are not measured and are not pretended
   * (rule 3, N-3).
   */
  async trending(
    filters: NewsFilters,
    locale: string | null,
    windowHours: number,
    limit: number,
  ): Promise<StoryPage_> {
    const q = new Query(filters, locale);
    q.windowHours = windowHours;
    const window = q.param(`${windowHours} hours`);
    const discussionWeight = q.param(TRENDING_WEIGHTS.discussion);
    const saveWeight = q.param(TRENDING_WEIGHTS.saves);
    return this.page(
      q,
      `, discussed AS (
         SELECT m.story_id, count(DISTINCT u.user_id)::int AS participants
           FROM story_card sc
           JOIN article m ON m.story_id = sc.story_id
           JOIN article_entity e ON e.article_id = m.id AND e.entity_type = 'fixture'
           JOIN (
             SELECT p.fixture_id, p.author_id AS user_id, p.created_at
               FROM panel_post p
              WHERE p.removed_at IS NULL
             UNION ALL
             SELECT p.fixture_id, r.user_id, r.created_at
               FROM panel_reaction r
               JOIN panel_post p ON p.id = r.post_id
              WHERE p.removed_at IS NULL
           ) u ON u.fixture_id = e.entity_id AND u.created_at >= now() - ${window}::interval
          GROUP BY m.story_id
       ),
       saved AS (
         SELECT sa.story_id, count(DISTINCT sa.user_id)::int AS savers
           FROM saved_article sa
           JOIN story_card sc ON sc.story_id = sa.story_id
          WHERE sa.saved_at >= now() - ${window}::interval
          GROUP BY sa.story_id
       ),
       signal AS (
         SELECT COALESCE(d.story_id, s.story_id) AS story_id,
                COALESCE(d.participants, 0) AS participants,
                COALESCE(s.savers, 0) AS savers
           FROM discussed d
           FULL JOIN saved s ON s.story_id = d.story_id
       )
       SELECT sc.*, sg.participants, sg.savers, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note
         FROM story_card sc
         JOIN signal sg ON sg.story_id = sc.story_id
        ORDER BY sg.participants * ${discussionWeight}::int + sg.savers * ${saveWeight}::int DESC,
                 sc.at DESC, sc.story_id
        LIMIT ${q.param(limit)}`,
      limit,
    );
  }

  /**
   * The stories marked breaking now (T-1004, D-125), newest mark first. The
   * window is read here, against `now()`, so an expired mark is gone at the
   * next render rather than at the next job.
   */
  async breaking(locale: string | null, limit: number): Promise<StoryPage_> {
    const q = new Query(NO_FILTERS, locale);
    return this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note
         FROM story_card sc
        WHERE sc.breaking_ends_at IS NOT NULL
        ORDER BY sc.breaking_marked_at DESC, sc.story_id
        LIMIT ${q.param(limit)}`,
      limit,
    );
  }

  /** What editors selected and have not cleared, newest selection first. */
  async debate(filters: NewsFilters, locale: string | null, limit: number): Promise<StoryPage_> {
    const q = new Query(filters, locale);
    return this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, d.selected_at AS debate_selected_at, d.note AS debate_note
         FROM story_card sc
         JOIN story_debate d ON d.story_id = sc.story_id AND d.cleared_at IS NULL
        ORDER BY d.selected_at DESC, sc.story_id
        LIMIT ${q.param(limit)}`,
      limit,
    );
  }

  /** Stories any of whose reports links something the member follows, newest first. */
  async following(
    filters: NewsFilters,
    locale: string | null,
    followed: Followed,
    before: string | null,
    limit: number,
  ): Promise<StoryPage_> {
    const q = new Query(filters, locale);
    const cursor = before === null ? '' : `AND sc.at < ${q.param(before)}::timestamptz`;
    const teams = q.param(followed.teams);
    const competitions = q.param(followed.competitions);
    const persons = q.param(followed.persons);
    return this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note
         FROM story_card sc
        WHERE EXISTS (
                SELECT 1
                  FROM article m
                  JOIN article_entity e ON e.article_id = m.id
                 WHERE m.story_id = sc.story_id
                   AND ((e.entity_type = 'team' AND e.entity_id = ANY(${teams}::uuid[]))
                     OR (e.entity_type = 'competition' AND e.entity_id = ANY(${competitions}::uuid[]))
                     OR (e.entity_type = 'person' AND e.entity_id = ANY(${persons}::uuid[]))))
          ${cursor}
        ORDER BY sc.at DESC, sc.story_id
        LIMIT ${q.param(limit + 1)}`,
      limit,
    );
  }

  /**
   * The story page (T-144): the promoted original in the language asked for
   * when it has one, else the source's own; its languages, corrections and
   * the other publishers' reports. Null when the story does not exist or its
   * original's publisher has been dropped (D-061).
   */
  async story(
    storyId: string,
    locale: string | null,
    language: string | null,
  ): Promise<StoryPage | null> {
    const version = (alias: string, sourceLanguage: string) => `
      SELECT id, headline, summary, body, byline, language, published_at, created_at,
             origin, review_state
        FROM article_version
       WHERE article_id = ${alias}.id
       ORDER BY COALESCE(language = $2::text, FALSE) DESC,
                (language = ${sourceLanguage}) DESC,
                created_at DESC, version_number DESC
       LIMIT 1`;
    const { rows } = await this.pool.query<
      CardRow & { body: string | null; created_at: Date; source_language: string }
    >(
      `SELECT s.id AS story_id, a.id AS article_id, a.url, a.fetched_at,
              src.id AS source_id, src.name AS source_name, src.homepage_url, src.rights,
              src.language AS source_language,
              v.headline, v.summary, v.body, v.byline, v.language, v.published_at, v.created_at,
              v.origin, v.review_state,
              COALESCE((SELECT min(published_at) FROM article_version WHERE article_id = a.id),
                       a.fetched_at) AS at,
              (SELECT count(*)::int - 1 FROM article m WHERE m.story_id = s.id) AS other_reports,
              lb.story_type, lb.origin AS type_origin, lb.created_at AS labelled_at,
              br.note AS breaking_note, br.marked_at AS breaking_marked_at,
              br.ends_at AS breaking_ends_at,
              img.file_key AS image_file_key, img.credit AS image_credit,
             img.licence AS image_licence, img.licence_url AS image_licence_url,
             img.width AS image_width, img.height AS image_height,
              NULL::int AS participants,
              d.selected_at AS debate_selected_at, d.note AS debate_note
         FROM story s
         JOIN article a ON a.id = s.promoted_article_id
         JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
         JOIN LATERAL (${version('a', 'src.language')}) v ON TRUE
         ${shownImageJoin('a')}
         LEFT JOIN story_debate d ON d.story_id = s.id AND d.cleared_at IS NULL
         LEFT JOIN story_label lb ON lb.story_id = s.id AND lb.superseded_at IS NULL
         LEFT JOIN LATERAL (SELECT note, marked_at, ends_at FROM story_breaking b
                     WHERE b.story_id = s.id AND b.cleared_at IS NULL AND b.ends_at > now()
                     ORDER BY b.marked_at DESC LIMIT 1) br ON TRUE
        WHERE s.id = $1`,
      [storyId, language],
    );
    const r = rows[0];
    if (r === undefined) return null;

    const [entities, versions, corrections, reports, lastUpdatedAt] = await Promise.all([
      this.entities([storyId], locale),
      this.pool.query<{
        language: string;
        version_number: number;
        updated_at: Date;
        origin: VersionOrigin;
        review_state: ReviewState | null;
      }>(
        `SELECT DISTINCT ON (language)
                language, version_number, created_at AS updated_at, origin, review_state
           FROM article_version
          WHERE article_id = $1
          ORDER BY language, version_number DESC, created_at DESC`,
        [r.article_id],
      ),
      this.pool.query<{ note: string; noted_at: Date }>(
        `SELECT note, noted_at FROM article_correction WHERE article_id = $1 ORDER BY noted_at DESC`,
        [r.article_id],
      ),
      this.pool.query<
        {
          article_id: string;
          url: string;
          source_id: string;
          source_name: string;
          homepage_url: string;
          rights: NewsRights;
          headline: string;
          summary: string | null;
          byline: string | null;
          language: string;
          published_at: Date | null;
        } & ImageColumns
      >(
        `SELECT a.id AS article_id, a.url,
                src.id AS source_id, src.name AS source_name, src.homepage_url, src.rights,
                v.headline, v.summary, v.byline, v.language, v.published_at,
                img.file_key AS image_file_key, img.credit AS image_credit,
             img.licence AS image_licence, img.licence_url AS image_licence_url,
             img.width AS image_width, img.height AS image_height
           FROM article a
           JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
           JOIN LATERAL (${version('a', 'src.language')}) v ON TRUE
           ${shownImageJoin('a')}
          WHERE a.story_id = $1 AND a.id <> $3
          ORDER BY COALESCE(v.published_at, a.fetched_at) DESC, a.id`,
        [storyId, language, r.article_id],
      ),
      this.lastFetchedAt(),
    ]);

    const granted = r.rights === 'full_text' && r.body !== null;
    return {
      story: this.card(r, entities.get(storyId) ?? [], null),
      updated_at: r.created_at.toISOString(),
      versions: versions.rows.map((v) => ({
        language: v.language,
        version_number: v.version_number,
        updated_at: v.updated_at.toISOString(),
        origin: v.origin,
        review_state: v.review_state,
      })),
      body: granted
        ? { coverage: 'available', last_updated_at: r.created_at.toISOString(), data: r.body }
        : { coverage: 'not_supplied', last_updated_at: null, data: null },
      corrections: corrections.rows.map((c) => ({
        note: c.note,
        noted_at: c.noted_at.toISOString(),
      })),
      reports: reports.rows.map((p): NewsReport => ({
        article_id: p.article_id,
        headline: p.headline,
        summary: p.summary,
        byline: p.byline,
        language: p.language,
        published_at: p.published_at?.toISOString() ?? null,
        url: p.url,
        source: {
          id: p.source_id,
          name: p.source_name,
          homepage_url: p.homepage_url,
          rights: p.rights,
        },
        image: imageOf(p),
      })),
      last_updated_at: lastUpdatedAt,
    };
  }

  /**
   * Related news for one match (blueprint 4.2, T-145): stories any of whose
   * reports link the match itself or either side, inside a window around the
   * kick-off -- a week before, three days after -- so the list is current
   * rather than a club's whole archive. Reports about the match come first,
   * then reports about one of its sides, each group newest first. `null` when
   * the id is not a match.
   */
  async forFixture(
    fixtureId: string,
    locale: string | null,
    limit: number,
  ): Promise<{ window: { since: Date; until: Date }; page: StoryPage_ } | null> {
    const fixture = await this.pool.query<{ kickoff_at: Date; teams: string[] | null }>(
      `SELECT f.kickoff_at, array_remove(array_agg(p.team_id), NULL) AS teams
         FROM fixture f
         LEFT JOIN fixture_participant p ON p.fixture_id = f.id
        WHERE f.id = $1
        GROUP BY f.id`,
      [fixtureId],
    );
    const found = fixture.rows[0];
    if (found === undefined) return null;
    const since = new Date(found.kickoff_at.getTime() - 7 * 24 * 60 * 60 * 1000);
    const until = new Date(found.kickoff_at.getTime() + 3 * 24 * 60 * 60 * 1000);
    const q = new Query(NO_FILTERS, locale);
    const match = q.param(fixtureId);
    const teams = q.param(found.teams ?? []);
    const from = q.param(since.toISOString());
    const to = q.param(until.toISOString());
    const page = await this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note,
              EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
                       WHERE m.story_id = sc.story_id
                         AND e.entity_type = 'fixture' AND e.entity_id = ${match}::uuid) AS about_match
         FROM story_card sc
        WHERE sc.at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
          AND EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
                       WHERE m.story_id = sc.story_id
                         AND ((e.entity_type = 'fixture' AND e.entity_id = ${match}::uuid)
                           OR (e.entity_type = 'team' AND e.entity_id = ANY(${teams}::uuid[]))))
        ORDER BY about_match DESC, sc.at DESC, sc.story_id
        LIMIT ${q.param(limit + 1)}`,
      limit,
    );
    return { window: { since, until }, page };
  }

  /**
   * Whether a team or competition exists (T-944), so its news answers 404
   * for an id that is neither rather than an empty list about nothing.
   */
  async entityExists(type: 'team' | 'competition' | 'person', id: string): Promise<boolean> {
    const table = type === 'team' ? 'team' : type === 'competition' ? 'competition' : 'person';
    const { rows } = await this.pool.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1) AS found`,
      [id],
    );
    return rows[0]?.found === true;
  }

  /**
   * A player's related news (T-1007, D-127): stories any of whose reports
   * link the person, newest first, the latest section's cards.
   */
  async forPerson(personId: string, locale: string | null, limit: number): Promise<StoryPage_> {
    const q = new Query(
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
      locale,
    );
    return this.page(
      q,
      `SELECT sc.*, NULL::int AS participants, NULL::timestamptz AS debate_selected_at, NULL::text AS debate_note
         FROM story_card sc
        WHERE EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
                       WHERE m.story_id = sc.story_id
                         AND e.entity_type = 'person' AND e.entity_id = ${q.param(personId)}::uuid)
        ORDER BY sc.at DESC, sc.story_id
        LIMIT ${q.param(limit + 1)}`,
      limit,
    );
  }

  private async page(q: Query, select: string, limit: number): Promise<StoryPage_> {
    const { rows } = await this.pool.query<CardRow>(`${q.storyCard()} ${select}`, q.params);
    const more = rows.length > limit;
    const shown = more ? rows.slice(0, limit) : rows;
    const entities = await this.entities(
      shown.map((r) => r.story_id),
      q.locale,
    );
    const cards = shown.map((r) => this.card(r, entities.get(r.story_id) ?? [], q.windowHours));
    const last = shown[shown.length - 1];
    return { cards, nextBefore: more && last !== undefined ? last.at.toISOString() : null };
  }

  private card(r: CardRow, entities: NewsEntity[], windowHours: number | null): NewsStoryCard {
    return {
      story_id: r.story_id,
      article_id: r.article_id,
      headline: r.headline,
      summary: r.summary,
      byline: r.byline,
      language: r.language,
      origin: r.origin,
      review_state: r.review_state,
      published_at: r.published_at?.toISOString() ?? null,
      fetched_at: r.fetched_at.toISOString(),
      url: r.url,
      source: {
        id: r.source_id,
        name: r.source_name,
        homepage_url: r.homepage_url,
        rights: r.rights,
      },
      entities,
      other_reports: r.other_reports,
      type:
        r.story_type === null || r.type_origin === null || r.labelled_at === null
          ? { coverage: 'not_supplied', last_updated_at: null, data: null }
          : {
              coverage: 'available',
              last_updated_at: r.labelled_at.toISOString(),
              data: { type: r.story_type, origin: r.type_origin },
            },
      discussion:
        r.participants === null
          ? null
          : {
              participants: r.participants,
              savers: r.savers ?? 0,
              window_hours: windowHours ?? 0,
            },
      debate:
        r.debate_selected_at === null || r.debate_note === null
          ? null
          : { selected_at: r.debate_selected_at.toISOString(), note: r.debate_note },
      breaking:
        r.breaking_note === null || r.breaking_marked_at === null || r.breaking_ends_at === null
          ? null
          : {
              note: r.breaking_note,
              marked_at: r.breaking_marked_at.toISOString(),
              ends_at: r.breaking_ends_at.toISOString(),
            },
      image: imageOf(r),
    };
  }

  /** The union of every report's links in each story, named for the reader. */
  private async entities(
    storyIds: string[],
    locale: string | null,
  ): Promise<Map<string, NewsEntity[]>> {
    const out = new Map<string, NewsEntity[]>();
    if (storyIds.length === 0) return out;
    const { rows } = await this.pool.query<EntityRow>(
      `SELECT DISTINCT ON (m.story_id, e.entity_type, e.entity_id)
              m.story_id, e.entity_type, e.entity_id,
              CASE e.entity_type
                WHEN 'team' THEN t.name
                WHEN 'competition' THEN c.name
                WHEN 'person' THEN COALESCE(p.known_as, p.full_name)
              END AS name,
              CASE WHEN $2::text IS NULL OR e.entity_type = 'fixture' THEN NULL
                   ELSE localised_name(e.entity_type, e.entity_id, $2::text) END AS localised_name
         FROM article m
         JOIN article_entity e ON e.article_id = m.id
         LEFT JOIN team t ON e.entity_type = 'team' AND t.id = e.entity_id
         LEFT JOIN competition c ON e.entity_type = 'competition' AND c.id = e.entity_id
         LEFT JOIN person p ON e.entity_type = 'person' AND p.id = e.entity_id
        WHERE m.story_id = ANY($1::uuid[])
        ORDER BY m.story_id, e.entity_type, e.entity_id`,
      [storyIds, locale],
    );
    for (const r of rows) {
      const list = out.get(r.story_id) ?? [];
      list.push({
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        name: r.name,
        localised_name: r.localised_name,
      });
      out.set(r.story_id, list);
    }
    return out;
  }
}

/** No filter at all: the match page's related news reads every story. */
export const NO_FILTERS: NewsFilters = {
  country: null,
  competition: null,
  team: null,
  language: null,
  type: null,
  player: null,
  from: null,
  to: null,
  time_zone: 'UTC',
};

/**
 * The card every section starts from, with the filters folded into its WHERE
 * and the parameters numbered as they are added. Building the text and the
 * list together is what keeps `$n` and `params[n-1]` the same thing.
 */
class Query {
  readonly params: unknown[] = [];
  windowHours: number | null = null;
  private readonly where: string[] = [];
  private readonly language: string;

  constructor(
    filters: NewsFilters,
    readonly locale: string | null,
  ) {
    this.language = this.param(filters.language);
    if (filters.team !== null) {
      this.where.push(`EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
         WHERE m.story_id = s.id AND e.entity_type = 'team' AND e.entity_id = ${this.param(filters.team)}::uuid)`);
    }
    if (filters.competition !== null) {
      this.where.push(`EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
         WHERE m.story_id = s.id AND e.entity_type = 'competition' AND e.entity_id = ${this.param(filters.competition)}::uuid)`);
    }
    if (filters.type !== null) {
      this.where.push(`EXISTS (SELECT 1 FROM story_label fl
         WHERE fl.story_id = s.id AND fl.superseded_at IS NULL AND fl.story_type = ${this.param(filters.type)}::text)`);
    }
    if (filters.player !== null) {
      this.where.push(`EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
         WHERE m.story_id = s.id AND e.entity_type = 'person' AND e.entity_id = ${this.param(filters.player)}::uuid)`);
    }
    // T-1003 (D-124): calendar days in the viewer's zone, against the story's
    // first publication -- the same instant the cards are ordered by.
    const first = `COALESCE((SELECT min(published_at) FROM article_version WHERE article_id = a.id), a.fetched_at)`;
    if (filters.from !== null) {
      this.where.push(
        `${first} >= (${this.param(filters.from)}::date)::timestamp AT TIME ZONE ${this.param(filters.time_zone)}::text`,
      );
    }
    if (filters.to !== null) {
      this.where.push(
        `${first} < ((${this.param(filters.to)}::date + 1)::timestamp AT TIME ZONE ${this.param(filters.time_zone)}::text)`,
      );
    }
    if (filters.country !== null) {
      const country = this.param(filters.country);
      this.where.push(`EXISTS (SELECT 1 FROM article m JOIN article_entity e ON e.article_id = m.id
         LEFT JOIN team t ON e.entity_type = 'team' AND t.id = e.entity_id
         LEFT JOIN competition c ON e.entity_type = 'competition' AND c.id = e.entity_id
         WHERE m.story_id = s.id AND (t.country_id = ${country}::uuid OR c.country_id = ${country}::uuid))`);
    }
  }

  /** Adds a parameter and returns its placeholder. */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  storyCard(): string {
    const where = this.where.length === 0 ? '' : `WHERE ${this.where.join(' AND ')}`;
    return `WITH story_card AS (
      SELECT s.id AS story_id, a.id AS article_id, a.url, a.fetched_at,
             src.id AS source_id, src.name AS source_name, src.homepage_url, src.rights,
             v.headline, v.summary, v.byline, v.language, v.published_at, v.origin, v.review_state,
             COALESCE((SELECT min(published_at) FROM article_version WHERE article_id = a.id),
                      a.fetched_at) AS at,
             (SELECT count(*)::int - 1 FROM article m WHERE m.story_id = s.id) AS other_reports,
             lb.story_type, lb.origin AS type_origin, lb.created_at AS labelled_at,
             br.note AS breaking_note, br.marked_at AS breaking_marked_at,
             br.ends_at AS breaking_ends_at,
             img.file_key AS image_file_key, img.credit AS image_credit,
             img.licence AS image_licence, img.licence_url AS image_licence_url,
             img.width AS image_width, img.height AS image_height
        FROM story s
        JOIN article a ON a.id = s.promoted_article_id
        JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
        ${shownImageJoin('a')}
        LEFT JOIN story_label lb ON lb.story_id = s.id AND lb.superseded_at IS NULL
        LEFT JOIN LATERAL (SELECT note, marked_at, ends_at FROM story_breaking b
                     WHERE b.story_id = s.id AND b.cleared_at IS NULL AND b.ends_at > now()
                     ORDER BY b.marked_at DESC LIMIT 1) br ON TRUE
        JOIN LATERAL (
          SELECT headline, summary, byline, language, published_at, origin, review_state
            FROM article_version
           WHERE article_id = a.id
             AND (${this.language}::text IS NULL OR language = ${this.language}::text)
           ORDER BY created_at DESC, version_number DESC
           LIMIT 1
        ) v ON TRUE
        ${where}
    )`;
  }
}
