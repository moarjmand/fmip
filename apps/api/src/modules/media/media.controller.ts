import {
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { MediaKind } from '@fmip/contracts';
import { MEDIA_KINDS, MEDIA_WIDTHS, mediaVersionOf, mediaWidthOf } from '@fmip/contracts';
import type { FastifyReply } from 'fastify';
import { versionOf } from './internal/image-check';
import { webpVariant } from './internal/image-variant';
import type { MediaFiles } from './internal/media-files';
import { MEDIA_FILES } from './media-fetch.service';
import { MediaService } from './media.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A year, and never revalidated: the address changes when the file does. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';
/** An address whose version is not the stored one: the current file, briefly. */
export const SHORT = 'public, max-age=300';
/**
 * An image is only ever drawn. Served from our own origin, an SVG opened on
 * its own would otherwise be a page of ours; the sandbox leaves it nothing to run.
 */
export const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * `GET /media/:kind/:id/:version` (T-1320, D-176): a stored crest, logo or
 * photo, streamed from the media volume. `:version` is the version, or
 * `<version>-<width>.webp` for a sized variant (T-1462). Public. The web app answers the same
 * path under `/api/media` on the site's own origin and hands it here, so a
 * reader's browser talks to nobody else.
 *
 * 404 when nothing is stored: the response that named the address said
 * `not_supplied` for it, and a surface never asks.
 */
@Controller('media')
export class MediaController {
  private readonly log = new Logger('Media');

  constructor(
    private readonly media: MediaService,
    @Inject(MEDIA_FILES) private readonly files: MediaFiles,
  ) {}

  @Get(':kind/:id/:version')
  async serve(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Param('version') version: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // T-1462: `<version>-<width>.webp` asks for a variant, at a width we make.
    const width = mediaWidthOf(version);
    if (
      !(MEDIA_KINDS as readonly string[]).includes(kind) ||
      !UUID.test(id) ||
      (width !== null && !(MEDIA_WIDTHS as readonly number[]).includes(width))
    ) {
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });
    }
    const row = await this.media.served(kind as MediaKind, id.toLowerCase());
    if (row === null)
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });

    const etag =
      width === null || row.contentType === 'image/svg+xml'
        ? `"${row.sha256}"`
        : `"${row.sha256}-${width}"`;
    // A variant's segment names the version before its width (T-1462).
    const cacheControl = mediaVersionOf(version) === versionOf(row.sha256) ? IMMUTABLE : SHORT;
    reply
      .header('etag', etag)
      .header('cache-control', cacheControl)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', IMAGE_CSP);
    if (ifNoneMatch !== undefined && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
      await reply.status(304).send();
      return;
    }
    // An SVG has no pixels to save: its variant is the file itself.
    let sized = width !== null && row.contentType !== 'image/svg+xml';
    let file: Awaited<ReturnType<MediaFiles['open']>> = null;
    if (sized && width !== null) {
      try {
        file = await this.files.variant(row, width, (bytes) => webpVariant(bytes, width));
      } catch {
        // A file the image library cannot read is served as stored, briefly,
        // rather than as an error: the page still shows the crest.
        sized = false;
        reply.header('cache-control', SHORT);
        this.log.warn('a stored image could not be resized', {
          event: 'media.variant_failed',
          id: row.id,
          width,
        });
      }
    }
    if (!sized) file = await this.files.open(row.storageKey);
    if (file === null) {
      await this.media.lost(row.id);
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });
    }
    await reply
      .status(200)
      .header('content-type', sized ? 'image/webp' : row.contentType)
      .header('content-length', String(file.size))
      .send(file.stream);
  }
}
