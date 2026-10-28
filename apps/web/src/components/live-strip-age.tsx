'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';

/**
 * The live strip's "may be behind" note (T-1381, rule 4). The server draws it
 * already shown when the answer was behind when it was given; otherwise this
 * island shows it at `behindAt`, the moment some chip may have changed
 * without the strip knowing (`stripBehindAt`). The strip sits in the locale
 * layout, which a client-side navigation keeps, so without this a minute
 * drawn at 16:20 would still read as the current one at 17:00. With no
 * script the note is the server's alone, which is what the page was.
 *
 * Since T-1635 (D-297) it holds the drawer's chips (`children`) as well, and
 * marks them `data-behind` when the note shows: a live chip then reads
 * "Behind" in place of its minute, by CSS, without asking the server. Each
 * new answer the rail gets brings a new `behindAt`, and the mark is judged
 * against that one: an answer that came in time takes the note away again.
 */
export function LiveStripAge({
  behindAt,
  initiallyBehind,
  note,
  children,
}: {
  /** Epoch ms; `null` when nothing on the strip can change today. */
  behindAt: number | null;
  initiallyBehind: boolean;
  note: Message;
  /** The drawer's row of chips. */
  children?: ReactNode;
}) {
  // The `behindAt` whose moment has passed; a newer answer's is not, yet.
  const [passed, setPassed] = useState<number | null>(null);

  useEffect(() => {
    if (behindAt === null) return;
    // Already past: at once. A timer longer than 2^31 - 1 ms would fire at
    // once too, so it is capped; a day's strip never needs one that long.
    const wait = Math.max(0, Math.min(behindAt - Date.now(), 2_147_000_000));
    const timer = setTimeout(() => setPassed(behindAt), wait);
    return () => clearTimeout(timer);
  }, [behindAt]);

  const behind = initiallyBehind || (behindAt !== null && passed === behindAt);

  // `contents`: the chips and the note stay items of the drawer's row. The
  // live region is there from the first paint, empty (taking back the row's
  // gap), so the words are announced when they arrive.
  return (
    <div className="group/fresh contents" data-behind={behind ? 'true' : 'false'}>
      {children}
      <p
        role="status"
        className="shrink-0 text-xs font-semibold whitespace-nowrap text-warning empty:-ms-3"
        data-testid="live-strip-behind"
        data-behind={behind ? 'true' : 'false'}
      >
        {behind && <MessageText message={note} />}
      </p>
    </div>
  );
}
