import { type ShareCapabilities, type ShareOutcome, shareOrCopy } from './share';

/** What sharing a picture needs of the browser: `share` with files, and `canShare` to ask first. */
export interface ImageShareCapabilities extends ShareCapabilities {
  canShare?: (data: { files: File[] }) => boolean;
  shareFiles?: (data: { title: string; url: string; files: File[] }) => Promise<void>;
}

/**
 * Sharing a card's picture with its link (T-1723, B06): the phone's own share
 * sheet with the image attached where the browser can share files, else the
 * link alone as `shareOrCopy` does. `shareFiles` is `navigator.share` handed
 * in by the caller (one function, typed twice), so this stays pure.
 */
export async function shareImageOrCopy(
  nav: ImageShareCapabilities,
  file: File | null,
  url: string,
  title: string,
): Promise<ShareOutcome> {
  if (
    file !== null &&
    typeof nav.shareFiles === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.shareFiles({ title, url, files: [file] });
      return 'shared';
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  return shareOrCopy(nav, url, title);
}
