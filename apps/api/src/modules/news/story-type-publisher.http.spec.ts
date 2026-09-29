import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresStoryLabelStore } from './internal/story-label-store';
import { CATEGORY_MAPPING, type CategoryMapping } from './internal/story-type-mapping';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsModule } from './news.module';

/**
 * A story's type from the publisher's own category (T-1002, D-123), through
 * the real ingestion job with a scripted feed and a mapping scripted for this
 * run's feed host. The committed mapping is not used here; what is tested is
 * the rule: exact strings only, no type for an unmapped or an ambiguous item,
 * the type following the promoted original's categories as carried, and an
 * editor's label never overwritten by a fetch.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const HOST = `types-${RUN}.scripted.test`;
const FEED = `https://${HOST}/feed.xml`;

const MAPPING: readonly CategoryMapping[] = [
  { host: HOST, category: 'Transfers', type: 'transfer', recorded: 'spec-only' },
  { host: HOST, category: 'Opinion', type: 'opinion', recorded: 'spec-only' },
  { host: HOST, category: 'Comment', type: 'opinion', recorded: 'spec-only' },
  { host: HOST, category: 'Injuries', type: 'injury', recorded: 'spec-only' },
];

interface Item {
  guid: string;
  headline: string;
  categories: string[];
}

const feedOf = (items: Item[]): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Types</title><language>en</language>${items
    .map(
      (i) =>
        `<item><title>${i.headline}</title><link>https://${HOST}/${i.guid}</link><guid>${i.guid}</guid>${i.categories
          .map((c) => `<category>${c}</category>`)
          .join('')}</item>`,
    )
    .join('')}</channel></rss>`;

class ScriptedTransport implements Transport {
  body = '';
  async request(url: string): Promise<TransportResponse> {
    const hit = url === FEED ? { status: 200, body: this.body } : { status: 404, body: 'no' };
    return { ...hit, receivedAt: new Date().toISOString() };
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('publisher story types', () => {
  let pool: Pool;
  let service: NewsIngestionService;
  let labels: PostgresStoryLabelStore;
  const transport = new ScriptedTransport();
  let sourceId = '';
  let editor = '';
  let close: () => Promise<void>;

  const fetch = async (items: Item[]): Promise<void> => {
    transport.body = feedOf(items);
    const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [sourceId])).rows[0];
    const report = await service.fetchSource(src);
    expect(report.partial).toBeNull();
  };

  const storyOf = async (guid: string): Promise<string> =>
    (
      await pool.query<{ story_id: string }>(
        `SELECT story_id FROM article WHERE source_id = $1 AND external_id = $2`,
        [sourceId, guid],
      )
    ).rows[0]!.story_id;

  const current = async (guid: string) =>
    (
      await pool.query<{
        story_type: string;
        origin: string;
        source_category: string | null;
      }>(
        `SELECT story_type, origin, source_category FROM story_label
          WHERE story_id = $1 AND superseded_at IS NULL`,
        [await storyOf(guid)],
      )
    ).rows[0] ?? null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .overrideProvider(CATEGORY_MAPPING)
      .useValue(MAPPING)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    close = () => app.close();
    service = moduleRef.get(NewsIngestionService);
    labels = moduleRef.get(PostgresStoryLabelStore);
    pool = new Pool({ connectionString: DATABASE_URL });
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, $2, $3, 'rss', 'headline', 'en') RETURNING id`,
      [`Types ${RUN}`, `https://${HOST}`, FEED],
    );
    sourceId = src.rows[0]!.id;
    const user = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, 'Editor', $2, $3, 'en', 'Europe/London', now(), now())
       RETURNING id`,
      [`tp${RUN}`, `tp${RUN}@example.test`, ENGLAND],
    );
    editor = user.rows[0]!.id;
  });

  afterAll(async () => {
    const stories = await pool.query<{ story_id: string }>(
      `SELECT story_id FROM article WHERE source_id = $1`,
      [sourceId],
    );
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'story' AND target_id = ANY($1::text[])`,
        [stories.rows.map((r) => r.story_id)],
      );
    });
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [sourceId]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [
      stories.rows.map((r) => r.story_id),
    ]);
    await pool.query(`DELETE FROM user_account WHERE id = $1`, [editor]);
    await pool.end();
    await close();
  });

  it('keeps the categories as carried, and types a story only by an exact mapped string', async () => {
    await fetch([
      {
        guid: `a-${RUN}`,
        headline: `Club agrees fee ${RUN}`,
        categories: ['Transfers', 'Football'],
      },
      { guid: `b-${RUN}`, headline: `Rumour mill ${RUN}`, categories: ['transfers', 'Transfers '] },
      { guid: `c-${RUN}`, headline: `Two views ${RUN}`, categories: ['Opinion', 'Injuries'] },
      { guid: `d-${RUN}`, headline: `Both columns ${RUN}`, categories: ['Opinion', 'Comment'] },
      { guid: `e-${RUN}`, headline: `Nothing carried ${RUN}`, categories: [] },
    ]);

    const carried = await pool.query<{ category: string }>(
      `SELECT c.category FROM article_category c JOIN article a ON a.id = c.article_id
        WHERE a.source_id = $1 AND a.external_id = $2 ORDER BY c.position`,
      [sourceId, `b-${RUN}`],
    );
    // The feed reader collapses the trailing space; nothing else is changed.
    expect(carried.rows.map((r) => r.category)).toEqual(['transfers', 'Transfers']);

    expect(await current(`a-${RUN}`)).toEqual({
      story_type: 'transfer',
      origin: 'publisher',
      source_category: 'Transfers',
    });
    // 'transfers' is not 'Transfers': no case folding. 'Transfers ' was trimmed by
    // the reader to 'Transfers', which is the exact string, so b is a transfer.
    expect(await current(`b-${RUN}`)).toMatchObject({ story_type: 'transfer' });
    // Two mapped categories naming two types: no type, not a pick.
    expect(await current(`c-${RUN}`)).toBeNull();
    // Two mapped categories naming one type: that type, from the first.
    expect(await current(`d-${RUN}`)).toEqual({
      story_type: 'opinion',
      origin: 'publisher',
      source_category: 'Opinion',
    });
    expect(await current(`e-${RUN}`)).toBeNull();
  });

  it('follows the categories as carried: a new category supersedes, a removed one withdraws', async () => {
    const a = { guid: `a-${RUN}`, headline: `Club agrees fee ${RUN}` };
    await fetch([{ ...a, categories: ['Injuries'] }]);
    expect(await current(a.guid)).toMatchObject({ story_type: 'injury', origin: 'publisher' });
    await fetch([{ ...a, categories: ['Injuries'] }]);
    await fetch([{ ...a, categories: [] }]);
    expect(await current(a.guid)).toBeNull();

    const history = await pool.query<{ story_type: string; superseded: boolean }>(
      `SELECT story_type, superseded_at IS NOT NULL AS superseded FROM story_label
        WHERE story_id = $1 ORDER BY created_at, id`,
      [await storyOf(a.guid)],
    );
    // Nothing edited, nothing written twice for the same fetch.
    expect(history.rows).toEqual([
      { story_type: 'transfer', superseded: true },
      { story_type: 'injury', superseded: true },
    ]);
  });

  it('never overwrites an editor label with a later fetch', async () => {
    const d = { guid: `d-${RUN}`, headline: `Both columns ${RUN}` };
    const story = await storyOf(d.guid);
    expect(await labels.labelByEditor(story, editor, 'data_analysis', 'It is a data piece.')).toBe(
      'labelled',
    );
    await fetch([{ ...d, categories: ['Transfers'] }]);
    expect(await current(d.guid)).toEqual({
      story_type: 'data_analysis',
      origin: 'editor',
      source_category: null,
    });
    expect(await labels.refreshPublisher(story)).toBe('editor');
  });
});
