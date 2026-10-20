/**
 * Spaces a job's bulk asks to the provider (T-1422). The post-match run asks
 * for up to `INGESTION_BACKLOG_BATCH` fixture details one after another; sent
 * as fast as they are written, two hundred went out in about a minute and the
 * provider refused a dozen of them with its per-minute "rateLimit", although
 * the plan's published ceiling is higher. Runs at 120 asks a minute or fewer
 * were never refused, so a bulk ask starts at least `BULK_ASK_GAP_MS` after
 * the one before it. The gap is a floor, not a pause added to every ask: a run
 * whose writes already take longer than the gap is not slowed at all.
 */

/** The least time between the starts of two bulk asks: at most 120 a minute. */
export const BULK_ASK_GAP_MS = 500;

export class AskPacer {
  private lastAt: number | null = null;

  constructor(
    private readonly gapMs: number = BULK_ASK_GAP_MS,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Resolves when the next ask may start, and counts it as started. */
  async pace(): Promise<void> {
    if (this.lastAt !== null) {
      const due = this.lastAt + this.gapMs - this.now();
      if (due > 0) await this.wait(due);
    }
    this.lastAt = this.now();
  }
}
