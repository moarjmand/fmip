import { Inject, Injectable } from '@nestjs/common';
import type { Transport } from '@fmip/ingestion';
import { type FeedConfig, HIGHLIGHT_FEED_CONFIG } from './internal/highlight-feed';
import {
  DailyBudgetTransport,
  HIGHLIGHT_FEED_TRANSPORT,
} from './internal/highlight-feed-transport';

/** What the watchdog reads of the shared ceiling (T-1432). */
export type HighlightlyQuotaReading =
  { configured: false } | { configured: true; requestsToday: number; budget: number };

/**
 * The one daily ceiling every Highlightly caller of this boundary draws on
 * (T-1432, D-224): the highlights feed and the box scores ask through the
 * same `DailyBudgetTransport`, so `HIGHLIGHTS_DAILY_BUDGET` bounds the two
 * together and they can never spend the plan between them. Null without
 * `HIGHLIGHTLY_KEY`. The count is this process's; both jobs run only in the
 * one process with `INGESTION_SCHEDULE=on`.
 */
@Injectable()
export class HighlightlyQuota {
  readonly transport: DailyBudgetTransport | null;

  constructor(
    @Inject(HIGHLIGHT_FEED_CONFIG) config: FeedConfig,
    @Inject(HIGHLIGHT_FEED_TRANSPORT) network: Transport,
  ) {
    this.transport =
      config.state === 'configured' ? new DailyBudgetTransport(network, config.dailyBudget) : null;
  }

  reading(): HighlightlyQuotaReading {
    if (this.transport === null) return { configured: false };
    return {
      configured: true,
      requestsToday: this.transport.used,
      budget: this.transport.perDay,
    };
  }
}
