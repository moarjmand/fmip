import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import {
  KNOWN_PLACEHOLDER_SHA256,
  MAX_BYTES,
  PLACEHOLDER_REPEATS,
  assessImage,
  storageKey,
} from './internal/image-check';
import { MediaFiles, mediaDir } from './internal/media-files';
import { MediaStore, type DueMedia } from './internal/media-store';

/** One HTTP answer, as much of it as the checks need. */
export interface FetchedImage {
  status: number;
  contentType: string | null;
  /** The body, read up to `MAX_BYTES + 1` bytes and no further. */
  bytes: Buffer;
  /** Where the answer finally came from, after any redirect. */
  finalUrl: string;
}

export type MediaFetch = (url: string) => Promise<FetchedImage>;

export const MEDIA_FETCH = Symbol('MEDIA_FETCH');
export const MEDIA_FILES = Symbol('MEDIA_FILES');
export const MEDIA_PACE = Symbol('MEDIA_PACE');

/**
 * How politely the job asks (D-176). The provider's image host is rate
 * limited per second and per minute and does not count against the daily
 * quota; one request a second, at most `perTick` a tick, stays far below it.
 */
export interface MediaPace {
  perTick: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_MEDIA_PACE: MediaPace = {
  perTick: 120,
  intervalMs: 1000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The hosts an image may come from. A provider answer naming any other is not followed. */
export const SOURCE_HOST = /^media(-\d+)?\.api-sports\.io$/;

export function allowedSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && SOURCE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** The real fetch: no key, no cookie, fifteen seconds, and never more than MAX_BYTES + 1 read. */
export const httpMediaFetch: MediaFetch = async (url) => {
  const response = await fetch(url, {
    headers: {
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml',
      'user-agent': 'fmip-media/1',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const chunks: Buffer[] = [];
  let length = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    bytes: Buffer.concat(chunks),
    finalUrl: response.url || url,
  };
};

export interface MediaTickReport {
  asked: number;
  stored: number;
  unchanged: number;
  notSupplied: number;
  failed: number;
}

/**
 * The fetch job (T-1320, D-176): copies each image that is new, due its
 * monthly re-check, or past its failure back-off, one at a time, onto the
 * media volume, and records what it found.
 */
@Injectable()
export class MediaFetchService {
  private readonly log = new Logger('Media');
  private readonly store: MediaStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(MEDIA_FETCH) private readonly fetchImage: MediaFetch,
    @Inject(MEDIA_FILES) private readonly files: MediaFiles,
    @Inject(MEDIA_PACE) private readonly pace: MediaPace,
  ) {
    this.store = new MediaStore(pool);
  }

  async runDue(now: Date = new Date()): Promise<MediaTickReport> {
    const due = await this.store.due(now, this.pace.perTick);
    const report: MediaTickReport = {
      asked: 0,
      stored: 0,
      unchanged: 0,
      notSupplied: 0,
      failed: 0,
    };
    for (const [i, row] of due.entries()) {
      if (i > 0) await this.pace.sleep(this.pace.intervalMs);
      const outcome = await this.fetchOne(row, now);
      report.asked += 1;
      report[outcome] += 1;
    }
    if (due.length > 0) this.log.log('media fetched', { event: 'media.tick', ...report });
    return report;
  }

  private async fetchOne(row: DueMedia, now: Date): Promise<keyof Omit<MediaTickReport, 'asked'>> {
    if (!allowedSource(row.sourceUrl)) {
      await this.store.failed(row.id, 'source host not allowed', now);
      return 'failed';
    }
    let answer: FetchedImage;
    try {
      answer = await this.fetchImage(row.sourceUrl);
    } catch (error) {
      await this.store.failed(row.id, `transport: ${(error as Error).message}`, now);
      return 'failed';
    }
    if (!allowedSource(answer.finalUrl)) {
      await this.store.failed(row.id, 'redirected off the source host', now);
      return 'failed';
    }
    const verdict = assessImage(
      answer.status,
      answer.contentType,
      answer.bytes,
      KNOWN_PLACEHOLDER_SHA256,
    );
    if (verdict.kind === 'failed') {
      await this.store.failed(row.id, verdict.reason, now);
      return 'failed';
    }
    if (verdict.kind === 'not_supplied') {
      await this.store.notSupplied(row.id, verdict.reason, now);
      return 'notSupplied';
    }
    // The silhouette nobody has measured: the one photo several people share.
    if (row.kind === 'photo') {
      const sharers = await this.store.photoSharers(verdict.sha256, row.id);
      if (sharers + 1 >= PLACEHOLDER_REPEATS) {
        const retired = await this.store.retirePlaceholder(verdict.sha256, now);
        await this.store.notSupplied(row.id, 'provider placeholder', now);
        this.log.log('a shared photo is taken for the provider placeholder', {
          event: 'media.placeholder',
          sha256: verdict.sha256,
          retired,
        });
        return 'notSupplied';
      }
    }
    const key = storageKey(verdict.sha256, verdict.contentType);
    try {
      await this.files.put(key, verdict.bytes);
    } catch (error) {
      await this.store.failed(row.id, `volume: ${(error as Error).message}`, now);
      return 'failed';
    }
    const unchanged = row.state === 'available' && row.sha256 === verdict.sha256;
    await this.store.stored(
      row.id,
      {
        storageKey: key,
        contentType: verdict.contentType,
        byteSize: verdict.byteSize,
        sha256: verdict.sha256,
      },
      now,
    );
    return unchanged ? 'unchanged' : 'stored';
  }
}

/** The volume from `MEDIA_DIR` (default `/data/media`). */
export function mediaFilesFromEnv(env: NodeJS.ProcessEnv = process.env): MediaFiles {
  return new MediaFiles(mediaDir(env));
}
