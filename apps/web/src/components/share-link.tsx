'use client';

import { useState } from 'react';
import type { Message } from '@/i18n/messages';
import { type ShareOutcome, shareMessage, shareOrCopy } from '@/lib/share';
import { FilledMessage } from '@/components/filled-message';

/**
 * A share control (T-521): the share sheet, or a copied link. See `lib/share.ts`.
 *
 * What it says afterwards is the reader's when the page resolves it
 * (`messages`, T-1303): `share.manual` carries the link as `{url}`. Without
 * them it says what `shareMessage` says, in English.
 */
export function ShareLink({
  url,
  title,
  label = 'Share',
  messages,
}: {
  url: string;
  title: string;
  /** The button's words; a server page may pass a `<Translated>` message (T-941). */
  label?: React.ReactNode;
  /** "Link copied." and "Copy this link: {url}", resolved on the server. */
  messages?: { copied: Message; manual: Message };
}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  async function onShare(): Promise<void> {
    setOutcome(null);
    setOutcome(await shareOrCopy(navigator, url, title));
  }

  let said: React.ReactNode = null;
  if (outcome !== null) {
    if (messages === undefined) said = shareMessage(outcome, url);
    else if (outcome === 'copied') said = <FilledMessage message={messages.copied} />;
    else if (outcome === 'manual')
      said = <FilledMessage message={messages.manual} params={{ url }} />;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={onShare} className="underline" data-testid="share">
        {label}
      </button>
      {said !== null && (
        <span role="status" className="text-xs text-muted break-all" data-testid="share-status">
          {said}
        </span>
      )}
    </span>
  );
}
