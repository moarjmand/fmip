/**
 * Where the teammate requests' pictures are kept (T-1731, D-357): the media
 * volume (`MEDIA_DIR`, T-1320), under `console-requests/<request>/`, as
 * `<image>.webp` and `<image>-thumb.webp`.
 *
 * The volume is not served as a folder. Caddy sends only `/media/news/*` to
 * the API, and every public media route reads a key it built itself (an
 * `entity_media` row's content-addressed key, or `news/<uuid>.<ext>`), so no
 * public address reaches this folder. These files are read only by the
 * console's own routes, behind a console session, and by the server's command
 * line. The folder is in the nightly media copy to the encrypted off-provider
 * remote (`scripts/backup/backup.sh`), so it counts toward that remote's size
 * budget.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** The same default the media module and the compose files use. */
export const MEDIA_DIR_DEFAULT = '/data/media';
export const IMAGE_FOLDER = 'console-requests';

/** `MEDIA_DIR` from the environment, or the default the compose volume is mounted at. */
export function consoleMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.MEDIA_DIR?.trim();
  return resolve(value === undefined || value === '' ? MEDIA_DIR_DEFAULT : value);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^${IMAGE_FOLDER}/${UUID}/${UUID}(?:-thumb)?\\.webp$`);

/** The storage keys of one picture: the stored file and its thumbnail. */
export function imageKeys(requestId: string, imageId: string): { full: string; thumb: string } {
  const full = `${IMAGE_FOLDER}/${requestId}/${imageId}.webp`;
  const thumb = `${IMAGE_FOLDER}/${requestId}/${imageId}-thumb.webp`;
  if (!KEY.test(full) || !KEY.test(thumb)) throw new Error('not a request picture');
  return { full, thumb };
}

export class RequestImageFiles {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** The absolute path of a key; refuses anything but a request picture's key under the root. */
  pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error(`not a request picture key: ${key}`);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error('key leaves the media root');
    return path;
  }

  /**
   * Writes the bytes under the key, to a temporary name first and renamed into
   * place, so a reader never sees half a file. The folders are the API
   * user's alone (0700), the files readable by it alone (0600).
   */
  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
  }

  /** A stream of the file and its size, or `null` when it is not on the volume. */
  async open(key: string): Promise<{ stream: ReadStream; size: number } | null> {
    const path = this.pathOf(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      return { stream: createReadStream(path), size: info.size };
    } catch {
      return null;
    }
  }

  /** The bytes of the file, or `null` when it is not on the volume. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      return null;
    }
  }

  /** Removes the files; one already gone is not an error. */
  async remove(...keys: string[]): Promise<void> {
    for (const key of keys) await rm(this.pathOf(key), { force: true });
  }
}

/** The provider token for the request pictures' files. */
export const REQUEST_IMAGE_FILES = Symbol('REQUEST_IMAGE_FILES');
