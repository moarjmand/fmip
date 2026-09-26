'use client';

import { useState } from 'react';
import { shareMessage, shareOrCopy } from '@/lib/share';

/** A share control (T-521): the share sheet, or a copied link. See `lib/share.ts`. */
export function ShareLink({
  url,
  title,
  label = 'Share',
}: {
  url: string;
  title: string;
  label?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function onShare(): Promise<void> {
    setMessage(null);
    setMessage(shareMessage(await shareOrCopy(navigator, url, title), url));
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={onShare} className="underline" data-testid="share">
        {label}
      </button>
      {message !== null && (
        <span role="status" className="text-xs opacity-80 break-all" data-testid="share-status">
          {message}
        </span>
      )}
    </span>
  );
}
