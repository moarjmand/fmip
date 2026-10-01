import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Transport, judgeProvenance, sniffImage } from '@fmip/ingestion';
import {
  type ImageRight,
  type ImageOverride,
  PostgresNewsImageStore,
} from './internal/news-image-store';
import { type ImageFetch, NEWS_IMAGE_FETCH, writeMedia } from './internal/news-media';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { NEWS_USER_AGENT, robotsAllows } from './internal/robots';

/** The injection token for `MEDIA_DIR`, resolved; `null` when unset. */
export const MEDIA_ROOT = Symbol('MEDIA_ROOT');

/** What one photo came to. `skipped` writes nothing: no directory, or already decided. */
export type ImageOutcome = 'stored' | 'refused' | 'failed' | 'skipped';

/** One feed item's photo, with what the job knows about where it was read. */
export interface ImageCandidate {
  sourceId: string;
  right: ImageRight;
  articleId: string;
  articleUrl: string;
  imageUrl: string;
  /** The feed's origin and its robots.txt (null when it had none), for the article page. */
  feedOrigin: string;
  robots: string | null;
}

export type OverrideOutcome =
  | { ok: true }
  | {
      ok: false;
      error: 'not_found' | 'no_right' | 'no_image' | 'no_media' | 'failed';
      message: string;
    };

/**
 * News photos under D-177: from a source whose licence covers them, only the
 * agency's own (the provenance check in `@fmip/ingestion`), downloaded to
 * our own volume and served from our own route -- a reader's browser never
 * asks the agency's host. Every decision is a row with its reason; an
 * editor may show or hide one article's photo, audited (rule 10).
 */
@Injectable()
export class NewsImagesService {
  private readonly log = new Logger('NewsImages');
  private warnedNoMedia = false;

  constructor(
    private readonly store: PostgresNewsImageStore,
    @Inject(NEWS_TRANSPORT) private readonly transport: Transport,
    @Inject(NEWS_IMAGE_FETCH) private readonly download: ImageFetch,
    @Inject(MEDIA_ROOT) private readonly root: string | null,
  ) {}

  async consider(candidate: ImageCandidate): Promise<ImageOutcome> {
    if (this.root === null) {
      if (!this.warnedNoMedia) {
        this.warnedNoMedia = true;
        this.log.warn('MEDIA_DIR is not set; news photos are not fetched', {
          event: 'news.images_off',
        });
      }
      return 'skipped';
    }
    const existing = await this.store.ofArticle(candidate.articleId);
    if (existing !== null && existing.source_url === candidate.imageUrl) return 'skipped';

    const page = await this.page(candidate);
    if (typeof page !== 'string' && page !== null) {
      await this.store.record(
        candidate.articleId,
        candidate.imageUrl,
        'refused',
        page.refused,
        null,
      );
      return 'refused';
    }
    const verdict = judgeProvenance({
      imageUrl: candidate.imageUrl,
      ownDomains: candidate.right.hosts,
      page,
    });
    if (!verdict.accepted) {
      await this.store.record(
        candidate.articleId,
        candidate.imageUrl,
        'refused',
        verdict.reason,
        null,
      );
      return 'refused';
    }
    const credit =
      verdict.photographer === null
        ? candidate.right.credit
        : `${verdict.photographer} / ${candidate.right.credit}`;
    return this.keep(
      candidate.articleId,
      candidate.imageUrl,
      candidate.right,
      credit,
      verdict.reason,
    );
  }

  /**
   * An editor's decision on one article's photo. `show` on a photo the
   * check refused fetches it now; neither is possible on a source whose
   * licence does not cover photos -- an editor cannot widen a licence.
   */
  async override(
    articleId: string,
    actorId: string,
    value: ImageOverride,
    reason: string,
  ): Promise<OverrideOutcome> {
    const article = await this.store.articleOf(articleId);
    if (article === null) return { ok: false, error: 'not_found', message: 'No such article.' };
    const right = await this.store.rightOf(article.source_id);
    if (right === null) {
      return {
        ok: false,
        error: 'no_right',
        message: "This publisher's licence does not cover its photos, so none is shown.",
      };
    }
    const existing = await this.store.ofArticle(articleId);
    if (existing === null) {
      return {
        ok: false,
        error: 'no_image',
        message: 'The feed carried no photo for this article.',
      };
    }
    if (value === 'show' && existing.state !== 'stored') {
      if (this.root === null) {
        return { ok: false, error: 'no_media', message: 'MEDIA_DIR is not set on this server.' };
      }
      const outcome = await this.keep(
        articleId,
        existing.source_url,
        right,
        right.credit,
        `${existing.reason}; shown by an editor`,
      );
      if (outcome !== 'stored') {
        const after = await this.store.ofArticle(articleId);
        return {
          ok: false,
          error: 'failed',
          message: after?.reason ?? 'The photo could not be fetched.',
        };
      }
    }
    await this.store.override(articleId, actorId, value, reason);
    return { ok: true };
  }

  /** Downloads, checks and writes one photo, and records the outcome. */
  private async keep(
    articleId: string,
    imageUrl: string,
    right: ImageRight,
    credit: string,
    evidence: string,
  ): Promise<ImageOutcome> {
    const root = this.root;
    if (root === null) return 'skipped';
    const downloaded = await this.download(imageUrl);
    if (!downloaded.ok) {
      await this.store.record(articleId, imageUrl, 'failed', downloaded.reason, null);
      return 'failed';
    }
    const sniffed = sniffImage(downloaded.bytes);
    if (!sniffed.ok) {
      await this.store.record(articleId, imageUrl, 'failed', sniffed.reason, null);
      return 'failed';
    }
    const fileKey = `news/${randomUUID()}.${sniffed.image.extension}`;
    await writeMedia(root, fileKey, downloaded.bytes);
    await this.store.record(articleId, imageUrl, 'stored', evidence, {
      fileKey,
      contentType: sniffed.image.contentType,
      width: sniffed.image.width,
      height: sniffed.image.height,
      byteSize: downloaded.bytes.byteLength,
      credit,
      licence: right.licence,
      licenceUrl: right.licenceUrl,
    });
    return 'stored';
  }

  /** The article page's HTML, `null` when it did not answer, or why it may not be read. */
  private async page(candidate: ImageCandidate): Promise<string | null | { refused: string }> {
    let url: URL;
    try {
      url = new URL(candidate.articleUrl);
    } catch {
      return { refused: 'the article link is not a URL' };
    }
    if (url.origin !== candidate.feedOrigin) {
      return { refused: `the article page is on ${url.host}, not the feed's host` };
    }
    if (
      candidate.robots !== null &&
      !robotsAllows(candidate.robots, `${url.pathname}${url.search}`, NEWS_USER_AGENT)
    ) {
      return { refused: 'robots.txt disallows the article page, so provenance is unknown' };
    }
    try {
      const response = await this.transport.request(url.toString(), {
        headers: { accept: 'text/html' },
      });
      return response.status === 200 && typeof response.body === 'string' ? response.body : null;
    } catch {
      return null;
    }
  }
}
