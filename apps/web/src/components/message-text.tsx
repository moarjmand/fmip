import { DEFAULT_LOCALE, directionOf } from '@/i18n/locales';
import type { Message } from '@/i18n/messages';

/**
 * A message already resolved, rendered with the truth about where it came
 * from (T-151). The marking itself lives here, and only here: `Translated`
 * resolves a key on the server and hands the result to this, and a client
 * component that was handed a resolved message (T-1040) renders it through
 * this too -- so a fallback on the client is marked exactly as one on the
 * server, and neither can drift from the other.
 *
 * No directive and no catalogue import (the `Message` import is a type): this
 * file is safe in a client bundle, which is the point of it being separate
 * from `translated.tsx`. Why the span carries `lang` and `dir`: `Translated`.
 */
export function MessageText({ message, className }: { message: Message; className?: string }) {
  const { text, status } = message;
  if (status === 'untranslated') {
    return (
      <span
        lang={DEFAULT_LOCALE}
        dir={directionOf(DEFAULT_LOCALE)}
        data-translation="untranslated"
        className={className}
      >
        {text}
      </span>
    );
  }
  return className === undefined ? <>{text}</> : <span className={className}>{text}</span>;
}
