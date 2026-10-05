import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Transport, articleUrlKey, readGNews, siteHost } from '@fmip/ingestion';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresNewsStore } from './internal/news-store';
import {
  type AggregatorRow,
  BUDGET_SPENT,
  GNEWS_SOURCE_ID,
  PostgresGNewsStore,
} from './internal/gnews-store';
import { type FetchReport, NewsIngestionService } from './news-ingestion.service';

/** Postgres' unique_violation: a run of this source is already open. */
const UNIQUE_VIOLATION = '23505';

/** Under the free plan's 100 a day, with room for a request by hand while testing. */
export const GNEWS_DEFAULT_DAILY_BUDGET = 90;
/** Every half hour is 48 requests a day. */
export const GNEWS_DEFAULT_INTERVAL_MINUTES = 30;

export interface GNewsEnv {
  GNEWS_API_KEY?: string;
  GNEWS_DAILY_BUDGET?: string;
  GNEWS_INTERVAL_MINUTES?: string;
}

/** On with its key and limits, or off with the reason in words. */
export type GNewsConfig =
  | { on: true; apiKey: string; dailyBudget: number; intervalMinutes: number }
  | { on: false; reason: string };

/** A positive whole number, the fallback when unset, or `null` when set to anything else. */
function positiveWhole(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * GNews from the environment (T-1367, D-185). Off while `GNEWS_API_KEY` is
 * empty, which is every deployment until the maintainer places a key; off,
 * too, when a limit is set to something that is not a positive whole number,
 * because a ceiling that is not a number is not a ceiling (D-049's rule for
 * API_FOOTBALL_DAILY_BUDGET).
 */
export function gnewsConfig(env: GNewsEnv = process.env): GNewsConfig {
  const apiKey = (env.GNEWS_API_KEY ?? '').trim();
  if (apiKey === '') return { on: false, reason: 'GNEWS_API_KEY is empty' };
  const dailyBudget = positiveWhole(env.GNEWS_DAILY_BUDGET, GNEWS_DEFAULT_DAILY_BUDGET);
  if (dailyBudget === null) {
    return {
      on: false,
      reason: `GNEWS_DAILY_BUDGET=${env.GNEWS_DAILY_BUDGET} is not a positive number of requests`,
    };
  }
  const intervalMinutes = positiveWhole(env.GNEWS_INTERVAL_MINUTES, GNEWS_DEFAULT_INTERVAL_MINUTES);
  if (intervalMinutes === null) {
    return {
      on: false,
      reason: `GNEWS_INTERVAL_MINUTES=${env.GNEWS_INTERVAL_MINUTES} is not a positive number of minutes`,
    };
  }
  return { on: true, apiKey, dailyBudget, intervalMinutes };
}

/** `text` with every occurrence of the key removed, so no record or log line can carry it. */
export function redact(text: string, apiKey: string): string {
  return apiKey === '' ? text : text.split(apiKey).join('[key]');
}

/**
 * English stories from GNews' free plan (T-1367, D-185).
 *
 * One request per run, to GNews' search for association football in English.
 * Each run is a `news_fetch` row of the GNews source -- opened before the
 * request, closed with the outcome -- so the console's news sources page
 * shows when GNews was last asked and what it said, and the day's ceiling is
 * counted from those rows: it holds across restarts, and a run over it is a
 * `partial` run naming the budget, sent nowhere (the BudgetedTransport rule,
 * D-049, kept in the table rather than in memory).
 *
 * Each article is filed under its **original publisher's** row (created the
 * first time GNews names them, under the GNews row's rights and language),
 * and then written exactly as a feed's item is (`NewsIngestionService.writeItem`):
 * title, the publisher's description, the link, the time. An article whose
 * page another source already carries is not written again, and a publisher
 * dropped here or under any other source is not brought back (D-061).
 */
@Injectable()
export class GNewsIngestionService {
  private readonly log = new Logger('News');

  constructor(
    private readonly gnews: PostgresGNewsStore,
    private readonly store: PostgresNewsStore,
    private readonly writer: NewsIngestionService,
    @Inject(NEWS_TRANSPORT) private readonly transport: Transport,
  ) {}

  /**
   * One run, or `null` when GNews is off (no key, a bad limit, the GNews row
   * dropped or absent): nothing is requested and nothing is written.
   */
  async run(
    config: GNewsConfig = gnewsConfig(),
    sourceId: string = GNEWS_SOURCE_ID,
  ): Promise<FetchReport | null> {
    if (!config.on) return null;
    const aggregator = await this.gnews.aggregator(sourceId);
    if (aggregator === null || aggregator.dropped) {
      this.log.log('gnews off: its source is dropped or absent', {
        event: 'news.gnews_off',
        source: sourceId,
      });
      return null;
    }

    let runId: string;
    try {
      runId = await this.store.startFetch(aggregator.id);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return this.report(aggregator, 0, 0, 'a fetch of this source was already open');
      }
      throw error;
    }

    try {
      const outcome = await this.read(aggregator, config, runId);
      await this.store.finishFetch(runId, {
        status: outcome.partial === null ? 'succeeded' : 'partial',
        itemsSeen: outcome.itemsSeen,
        itemsWritten: outcome.itemsWritten,
        error: outcome.partial,
      });
      this.log.log(`gnews fetch ${outcome.partial === null ? 'succeeded' : 'partial'}`, {
        event: outcome.partial === null ? 'news.succeeded' : 'news.partial',
        source: aggregator.id,
        items_seen: outcome.itemsSeen,
        items_written: outcome.itemsWritten,
        error: outcome.partial,
      });
      return outcome;
    } catch (error: unknown) {
      const message = redact(error instanceof Error ? error.message : String(error), config.apiKey);
      await this.store.finishFetch(runId, {
        status: 'failed',
        itemsSeen: 0,
        itemsWritten: 0,
        error: message,
      });
      this.log.error('gnews fetch failed', {
        event: 'news.failed',
        source: aggregator.id,
        error: message,
      });
      return this.report(aggregator, 0, 0, message);
    }
  }

  private async read(
    aggregator: AggregatorRow,
    config: Extract<GNewsConfig, { on: true }>,
    runId: string,
  ): Promise<FetchReport> {
    const spent = await this.gnews.requestsToday(aggregator.id, runId);
    if (spent >= config.dailyBudget) {
      return this.report(aggregator, 0, 0, `${BUDGET_SPENT} of ${config.dailyBudget} spent`);
    }

    const result = await readGNews(this.transport, {
      apiKey: config.apiKey,
      language: aggregator.language,
    });
    if (!result.ok) {
      return this.report(
        aggregator,
        0,
        0,
        redact(`${result.error.kind}: ${result.error.message}`, config.apiKey),
      );
    }

    const items = result.data.items;
    // The pages other sources already carry, by the page's identity.
    const keys = items.map((item) => articleUrlKey(item.url));
    const carried = new Set(
      (
        await this.gnews.urlsLike(
          keys.filter((k): k is string => k !== null).map((k) => k.split('?')[0]!),
          aggregator.id,
        )
      ).map((url) => articleUrlKey(url)),
    );

    let written = 0;
    let duplicates = 0;
    let refused = 0;
    for (const [index, item] of items.entries()) {
      const key = keys[index];
      if (key === null || key === undefined || carried.has(key)) {
        duplicates += 1;
        continue;
      }
      const host = siteHost(item.publisher.homepage);
      if (host !== null && (await this.gnews.hostDropped(host, aggregator.id))) {
        refused += 1;
        continue;
      }
      const publisher = await this.gnews.publisher(
        aggregator,
        item.publisher.name,
        item.publisher.homepage,
      );
      if (publisher.dropped) {
        refused += 1;
        continue;
      }
      // No photo: GNews' photos are on each publisher's host, outside any
      // licence a row here records (D-177, D-185).
      if (await this.writer.writeItem(publisher, item, null)) written += 1;
    }

    if (duplicates > 0 || refused > 0) {
      this.log.log('gnews items left out', {
        event: 'news.gnews_left_out',
        source: aggregator.id,
        already_carried: duplicates,
        publisher_dropped: refused,
      });
    }
    const skipped =
      result.data.skipped > 0
        ? `${result.data.skipped} article(s) had no headline, no link or no publisher and were not written`
        : null;
    return this.report(aggregator, items.length, written, skipped);
  }

  private report(
    aggregator: AggregatorRow,
    itemsSeen: number,
    itemsWritten: number,
    partial: string | null,
  ): FetchReport {
    return { sourceId: aggregator.id, name: aggregator.name, itemsSeen, itemsWritten, partial };
  }
}
