/**
 * The media volume (T-1320, D-176): files named by their sha256 under
 * `MEDIA_DIR`, so two entities with the same image share one file and a
 * rewrite of the same bytes is a no-op. A file is written to a temporary name
 * and renamed into place, so a reader never sees half of one, and two API
 * processes writing the same image during a rollout cannot corrupt it.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const MEDIA_DIR_DEFAULT = '/data/media';

/** The directory from the environment, or the default the compose volume is mounted at. */
export function mediaDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.MEDIA_DIR?.trim();
  return resolve(value === undefined || value === '' ? MEDIA_DIR_DEFAULT : value);
}

export class MediaFiles {
  constructor(readonly root: string) {}

  /** The absolute path for a storage key; refuses a key that would leave the root. */
  pathOf(storageKey: string): string {
    if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.(png|jpg|svg|webp)$/.test(storageKey)) {
      throw new Error(`not a media storage key: ${storageKey}`);
    }
    const path = resolve(join(this.root, storageKey));
    if (!path.startsWith(this.root + sep)) throw new Error('storage key leaves the media root');
    return path;
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(storageKey))).isFile();
    } catch {
      return false;
    }
  }

  /** Writes the bytes under their key unless a file is already there. */
  async put(storageKey: string, bytes: Buffer): Promise<void> {
    if (await this.exists(storageKey)) return;
    const path = this.pathOf(storageKey);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }

  /** A stream of the file, or `null` when it is not on the volume. */
  async open(storageKey: string): Promise<{ stream: ReadStream; size: number } | null> {
    let size: number;
    try {
      const info = await stat(this.pathOf(storageKey));
      if (!info.isFile()) return null;
      size = info.size;
    } catch {
      return null;
    }
    return { stream: createReadStream(this.pathOf(storageKey)), size };
  }
}
