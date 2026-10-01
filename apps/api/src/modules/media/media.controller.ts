import { Controller, Get, Headers, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { MediaKind } from '@fmip/contracts';
import { MEDIA_KINDS } from '@fmip/contracts';
import type { FastifyReply } from 'fastify';
import { versionOf } from './internal/image-check';
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
 * photo, streamed from the media volume. Public. The web app answers the same
 * path under `/api/media` on the site's own origin and hands it here, so a
 * reader's browser talks to nobody else.
 *
 * 404 when nothing is stored: the response that named the address said
 * `not_supplied` for it, and a surface never asks.
 */
@Controller('media')
export class MediaController {
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
    if (!(MEDIA_KINDS as readonly string[]).includes(kind) || !UUID.test(id)) {
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });
    }
    const row = await this.media.served(kind as MediaKind, id.toLowerCase());
    if (row === null)
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });

    const etag = `"${row.sha256}"`;
    const cacheControl = version === versionOf(row.sha256) ? IMMUTABLE : SHORT;
    reply
      .header('etag', etag)
      .header('cache-control', cacheControl)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', IMAGE_CSP);
    if (ifNoneMatch !== undefined && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
      await reply.status(304).send();
      return;
    }
    const file = await this.files.open(row.storageKey);
    if (file === null) {
      await this.media.lost(row.id);
      throw new NotFoundException({ error: 'not_found', message: 'No such image.' });
    }
    await reply
      .status(200)
      .header('content-type', row.contentType)
      .header('content-length', String(file.size))
      .send(file.stream);
  }
}
