import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Transport, readFeed } from '@fmip/ingestion';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { type NewsSourceRow, PostgresNewsStore, type VersionFields } from './internal/news-store';
import { NEWS_USER_AGENT, robotsAllows } from './internal/robots';

/** Postgres' unique_violation: a run of this source is already open. */
const UNIQUE_VIOLATION = '23505';

/** What one source's fetch did. Returned so a caller (a test, the scheduler) can assert on it. */
export interface FetchReport {
  sourceId: string;
  name: string;
  itemsSeen: number;
  itemsWritten: number;
  /** Set when the run was not clean: the reason, in the words the run record carries. */
  partial: string | null;
}

/**
 * Reads every active publisher feed and writes what it may (T-142, D-061).
 *
 * Every attempt is a `news_fetch` row, opened before the first request and
 * closed with the outcome, so a feed that stops answering is a fact in a
 * table rather than a silence. A refusal -- robots.txt, a 404, a body that is
 * not a feed -- is a `partial` run naming what happened, never a thrown
 * error: the data is missing for a reason we can state.
 *
 * What is written obeys the source's rights **before** the write: a
 * headline-only source's summary is dropped here, so the database's PL016 is
 * the guard that never fires in normal operation, not the mechanism. A
 * version is written only when the feed's words changed; running twice over
 * the same feed writes nothing the second time.
 */
@Injectable()
export class NewsIngestionService {
  private readonly log = new Logger('News');

  constructor(
    private readonly store: PostgresNewsStore,
    @Inject(NEWS_TRANSPORT) private readonly transport: Transport,
  ) {}

  /** Every active source, one after another; a source that fails does not stop the next. */
  async fetchAll(): Promise<FetchReport[]> {
    const reports: FetchReport[] = [];
    for (const source of await this.store.activeSources()) {
      reports.push(await this.fetchSource(source));
    }
    return reports;
  }

  async fetchSource(source: NewsSourceRow): Promise<FetchReport> {
    let runId: string;
    try {
      runId = await this.store.startFetch(source.id);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        this.log.warn(`news fetch skipped, already running: ${source.name}`, {
          event: 'news.already_running',
          source: source.id,
        });
        return this.report(source, 0, 0, 'a fetch of this source was already open');
      }
      throw error;
    }

    try {
      const outcome = await this.read(source);
      await this.store.finishFetch(runId, {
        status: outcome.partial === null ? 'succeeded' : 'partial',
        itemsSeen: outcome.itemsSeen,
        itemsWritten: outcome.itemsWritten,
        error: outcome.partial,
      });
      this.log.log(
        `news fetch ${outcome.partial === null ? 'succeeded' : 'partial'}: ${source.name}`,
        {
          event: outcome.partial === null ? 'news.succeeded' : 'news.partial',
          source: source.id,
          items_seen: outcome.itemsSeen,
          items_written: outcome.itemsWritten,
          error: outcome.partial,
        },
      );
      return outcome;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.finishFetch(runId, {
        status: 'failed',
        itemsSeen: 0,
        itemsWritten: 0,
        error: message,
      });
      this.log.error(`news fetch failed: ${source.name}`, {
        event: 'news.failed',
        source: source.id,
        error: message,
      });
      return this.report(source, 0, 0, message);
    }
  }

  private async read(source: NewsSourceRow): Promise<FetchReport> {
    const feed = new URL(source.feed_url);

    // D-061: fetching obeys robots.txt. A missing file allows everything.
    const robots = await this.transport.request(`${feed.origin}/robots.txt`, {
      headers: { accept: 'text/plain' },
    });
    if (robots.status === 200 && typeof robots.body === 'string') {
      if (!robotsAllows(robots.body, `${feed.pathname}${feed.search}`, NEWS_USER_AGENT)) {
        return this.report(source, 0, 0, `robots.txt at ${feed.origin} disallows ${feed.pathname}`);
      }
    }

    const result = await readFeed(this.transport, source.feed_url);
    if (!result.ok) {
      return this.report(source, 0, 0, `${result.error.kind}: ${result.error.message}`);
    }

    let written = 0;
    for (const item of result.data.items) {
      const language = item.language ?? source.language;
      const fields: VersionFields = {
        headline: item.headline,
        // The source's rights, applied before the write (D-061).
        summary: source.rights === 'headline' ? null : item.summary,
        byline: item.byline,
        published_at: item.publishedAt,
      };
      const article = await this.store.upsertArticle(source.id, item.externalId, item.url);
      const newest = await this.store.newestVersion(article.id, language);
      if (newest !== null && same(newest, fields)) continue;
      await this.store.addVersion(article.id, language, (newest?.version_number ?? 0) + 1, fields);
      written += 1;
    }

    const skipped =
      result.data.skipped > 0
        ? `${result.data.skipped} item(s) had no headline or no link and were not written`
        : null;
    return this.report(source, result.data.items.length, written, skipped);
  }

  private report(
    source: NewsSourceRow,
    itemsSeen: number,
    itemsWritten: number,
    partial: string | null,
  ): FetchReport {
    return { sourceId: source.id, name: source.name, itemsSeen, itemsWritten, partial };
  }
}

/** Whether the feed still says what the newest version says. */
function same(a: VersionFields, b: VersionFields): boolean {
  return (
    a.headline === b.headline &&
    a.summary === b.summary &&
    a.byline === b.byline &&
    isoOf(a.published_at) === isoOf(b.published_at)
  );
}

function isoOf(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
