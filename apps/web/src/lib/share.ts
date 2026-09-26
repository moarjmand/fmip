/**
 * Sharing a page (T-521): the platform's share sheet where there is one, a
 * copied link where not, and the link itself to copy by hand when neither
 * works. The link is the page's canonical address and nothing else -- no
 * referral mark, no member id -- so it says nothing about who shared it.
 */

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'manual';

export interface ShareCapabilities {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export async function shareOrCopy(
  nav: ShareCapabilities,
  url: string,
  title: string,
): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error: unknown) {
      // The reader closed the sheet: nothing to say. Any other failure falls
      // through to the copied link, which works nearly everywhere.
      if ((error as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav.clipboard?.writeText(url);
    return nav.clipboard === undefined ? 'manual' : 'copied';
  } catch {
    return 'manual';
  }
}

/** What the control says afterwards; nothing after the sheet did its job. */
export function shareMessage(outcome: ShareOutcome, url: string): string | null {
  if (outcome === 'copied') return 'Link copied.';
  if (outcome === 'manual') return `Copy this link: ${url}`;
  return null;
}
