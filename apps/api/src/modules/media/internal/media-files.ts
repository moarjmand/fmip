/**
 * The media volume (T-1320, D-176): files named by their sha256 under
 * `MEDIA_DIR`, so two entities with the same image share one file and a
 * rewrite of the same bytes is a no-op. A file is written to a temporary name
 * and renamed into place, so a reader never sees half of one, and two API
 * processes writing the same image during a rollout cannot corrupt it.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
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

  /**
   * The path of a stored file's WebP variant at `width` (T-1462): named by the
   * original's sha256 and the width under `variants/`, so it is made once for
   * every entity that shares the image and never goes stale.
   */
  variantPathOf(sha256: string, width: number): string {
    if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(width) || width <= 0) {
      throw new Error('not a media variant');
    }
    return resolve(join(this.root, 'variants', sha256.slice(0, 2), `${sha256}-${width}.webp`));
  }

  /** The bytes of a stored file, or `null` when it is not on the volume. */
  async read(storageKey: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(storageKey));
    } catch {
      return null;
    }
  }

  /**
   * A stored file's variant at `width`, made by `make` from the original the
   * first time it is asked for and kept on the volume after (written to a
   * temporary name and renamed, as `put` does). `null` when the original is
   * not on the volume.
   */
  async variant(
    original: { storageKey: string; sha256: string },
    width: number,
    make: (bytes: Buffer) => Promise<Buffer>,
  ): Promise<{ stream: ReadStream; size: number } | null> {
    const path = this.variantPathOf(original.sha256, width);
    const kept = await sizeOf(path);
    if (kept !== null) return { stream: createReadStream(path), size: kept };
    const bytes = await this.read(original.storageKey);
    if (bytes === null) return null;
    const made = await make(bytes);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(temporary, made);
    await rename(temporary, path);
    return { stream: createReadStream(path), size: made.length };
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

async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
