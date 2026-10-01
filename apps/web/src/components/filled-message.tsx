import { Fragment, type ReactNode } from 'react';
import { DEFAULT_LOCALE, directionOf } from '@/i18n/locales';
import type { Message } from '@/i18n/messages';

/**
 * A resolved message whose `{placeholders}` are elements -- a `<time>`, a
 * link, an isolated score -- rather than strings (T-1303). The sentence is the
 * catalogue's, so Persian word order is Persian's; the elements go where the
 * translation puts them. A fallback is marked exactly as `MessageText` marks
 * one. No directive and no catalogue import: safe on the server and in a
 * client bundle alike.
 */
export function FilledMessage({
  message,
  params = {},
  className,
}: {
  message: Message;
  params?: Record<string, ReactNode>;
  className?: string;
}) {
  const parts = message.text.split(/\{([a-zA-Z]+)\}/);
  const nodes = parts.map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <Fragment key={index}>{part in params ? params[part] : `{${part}}`}</Fragment>
    ),
  );
  if (message.status === 'untranslated') {
    return (
      <span
        lang={DEFAULT_LOCALE}
        dir={directionOf(DEFAULT_LOCALE)}
        data-translation="untranslated"
        className={className}
      >
        {nodes}
      </span>
    );
  }
  return className === undefined ? <>{nodes}</> : <span className={className}>{nodes}</span>;
}
