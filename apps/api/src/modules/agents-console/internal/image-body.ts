import type { Readable } from 'node:stream';
import {
  Injectable,
  type OnModuleInit,
  Optional,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

/**
 * The raw body of a picture upload (T-1731, D-357). The app registers no
 * multipart plugin, and a picture in base64 JSON would raise every route's
 * JSON limit by a third more than the picture. So the upload route alone
 * takes `application/octet-stream`: the parser hands the route the request's
 * stream unread, and the route reads it only after the session, the request
 * and both ceilings are checked, stopping at the cap (`readCapped`). Every
 * other route refuses the type with 415, as it did before.
 */

export const IMAGE_UPLOAD_TYPE = 'application/octet-stream';
const UPLOAD_ROUTE = /^\/console\/requests\/[^/?]+\/images(?:\?|$)/;

@Injectable()
export class ImageBodyParser implements OnModuleInit {
  constructor(@Optional() private readonly host?: HttpAdapterHost) {}

  onModuleInit(): void {
    // The command line has no HTTP server.
    const adapter = this.host?.httpAdapter as { getInstance?: () => unknown } | undefined;
    const instance = adapter?.getInstance?.() as FastifyInstance | undefined;
    if (instance === undefined || typeof instance.addContentTypeParser !== 'function') return;
    if (instance.hasContentTypeParser(IMAGE_UPLOAD_TYPE)) return;
    instance.addContentTypeParser(IMAGE_UPLOAD_TYPE, (request, payload, done) => {
      if (request.method !== 'POST' || !UPLOAD_ROUTE.test(request.url)) {
        done(
          new UnsupportedMediaTypeException({
            error: 'validation',
            message: 'Send JSON.',
          }),
          undefined,
        );
        return;
      }
      done(null, payload);
    });
  }
}

export const isReadable = (value: unknown): value is Readable =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';

/**
 * The stream's bytes, or `'too_big'` as soon as they pass `max`: the rest is
 * never held in memory.
 */
export async function readCapped(stream: Readable, max: number): Promise<Buffer | 'too_big'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > max) {
      stream.destroy();
      return 'too_big';
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
