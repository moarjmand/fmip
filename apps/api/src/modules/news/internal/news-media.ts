import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { IMAGE_MAX_BYTES } from '@fmip/ingestion';
import { FEED_TIMEOUT_MS } from './news-transport';
import { NEWS_USER_AGENT } from './robots';

/**
 * Where news photos live on our server, and how one is fetched (T-1322, D-177).
 *
 * `MEDIA_DIR` is a directory on a volume the API owns; a photo is
 * `news/<uuid>.<ext>` under it, a name never reused, which is what lets the
 * route serve it as immutable. Unset, no photo is fetched at all -- an image
 * we could not keep is an image we must not point a reader at, and the
 * agency's own URL is never handed to a browser (D-089 precedent, rule 2).
 */
export function mediaDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.MEDIA_DIR?.trim();
  return dir === undefined || dir === '' ? null : resolve(dir);
}

/** The absolute path of `key` under `root`, or `null` if the key escapes it. */
export function mediaPath(root: string, key: string): string | null {
  const path = resolve(join(root, key));
  return path.startsWith(root + sep) ? path : null;
}

/** Writes the file whole or not at all: a reader never meets half a photo. */
export async function writeMedia(root: string, key: string, bytes: Uint8Array): Promise<void> {
  const path = mediaPath(root, key);
  if (path === null) throw new Error(`media key ${key} escapes the media directory`);
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, path);
}

export async function readMedia(root: string, key: string): Promise<Buffer | null> {
  const path = mediaPath(root, key);
  if (path === null) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/** One photo's bytes as the agency served them, or why there are none. */
export type ImageDownload =
  { ok: true; bytes: Uint8Array; contentType: string | null } | { ok: false; reason: string };

/** The injection token for how the job downloads a photo; a spec scripts it. */
export const NEWS_IMAGE_FETCH = Symbol('NEWS_IMAGE_FETCH');

export type ImageFetch = (url: string) => Promise<ImageDownload>;

/**
 * Downloads a photo with the same name in the user agent as the feed reader,
 * stops reading past `IMAGE_MAX_BYTES`, and follows no redirect: a photo that
 * moved off the agency's host is no longer the one the provenance check saw.
 */
export function fetchImage(fetchImpl: typeof fetch = fetch): ImageFetch {
  return async (url) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          'user-agent': `${NEWS_USER_AGENT}/1.0`,
          accept: 'image/jpeg, image/png, image/webp',
        },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error: unknown) {
      return {
        ok: false,
        reason: `download failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (response.status !== 200 || response.body === null) {
      return { ok: false, reason: `the image answered ${response.status}` };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, reason: `the file is over ${IMAGE_MAX_BYTES} bytes` };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { ok: true, bytes, contentType: response.headers.get('content-type') };
  };
}
