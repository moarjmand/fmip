'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/button';
import type { ShareOutcome } from '@/lib/share';
import { shareImageOrCopy } from '@/lib/share-image';

/**
 * The one control on a card's page that needs JavaScript (T-1723, B06): the
 * phone's own share sheet with the card's picture attached, where the
 * browser can share files; else the link alone, or a copied link. The
 * picture is fetched when the page opens, so pressing the button opens the
 * sheet at once (a browser forgets the press while a download runs). Saving
 * the picture is a plain link beside it, which needs no script at all.
 *
 * It lives on its own route, never in the match page's first load (the
 * budgets in `perf-budgets.json`). Its words are resolved on the server.
 */
export function ShareCardButton({
  url,
  imageUrl,
  title,
  labels,
}: {
  /** The public page the link opens. */
  url: string;
  /** The card's picture, attached to the share. */
  imageUrl: string;
  title: string;
  labels: { share: string; copied: string; manual: string };
}) {
  const picture = useRef<File | null>(null);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  useEffect(() => {
    let live = true;
    fetch(imageUrl)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (live && blob !== null) {
          picture.current = new File([blob], 'stadiomind-called-it.png', { type: 'image/png' });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [imageUrl]);

  async function onShare(): Promise<void> {
    setOutcome(null);
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
    };
    const share = typeof nav.share === 'function' ? nav.share.bind(nav) : undefined;
    setOutcome(
      await shareImageOrCopy(
        {
          ...(share === undefined ? {} : { share, shareFiles: share }),
          ...(typeof nav.canShare === 'function' ? { canShare: nav.canShare.bind(nav) } : {}),
          ...(nav.clipboard === undefined ? {} : { clipboard: nav.clipboard }),
        },
        picture.current,
        url,
        title,
      ),
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onShare}
        className={buttonClasses({ variant: 'primary' })}
        data-testid="share-card"
      >
        {labels.share}
      </button>
      {outcome === 'copied' && (
        <span role="status" className="text-sm text-muted">
          {labels.copied}
        </span>
      )}
      {outcome === 'manual' && (
        <span role="status" className="text-sm text-muted break-all">
          {labels.manual.replace('{url}', url)}
        </span>
      )}
    </span>
  );
}
