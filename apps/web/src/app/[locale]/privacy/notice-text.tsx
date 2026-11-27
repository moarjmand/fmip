import { Fragment, type ReactNode } from 'react';
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';

/** A placeholder, a bold run, or a code run: the three marks the notice's text uses. */
const TOKEN = /(\{[a-zA-Z]+\}|\*\*[^*]+?\*\*|`[^`]+`)/g;

/**
 * A sentence of the notice as nodes (T-1969): `**bold**` as the draft bolds
 * it, `` `code` `` for a cookie or storage name (left to right in every
 * language), and `{name}` filled from `values` -- the controller, the
 * mailbox, "not yet confirmed". A name with no value stays visible as it is,
 * like `interpolate`, so a missing value is seen rather than hidden.
 */
export function richText(text: string, values: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return text
    .split(TOKEN)
    .filter((part) => part !== '')
    .map((part, at) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        const name = part.slice(1, -1);
        return name in values ? <Fragment key={at}>{values[name]}</Fragment> : part;
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={at} className="font-semibold">
            {richText(part.slice(2, -2), values)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={at} dir="ltr" className="font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
}

/**
 * One catalogue sentence of the notice, with its marks and values, marked
 * as English where the locale has no translation (T-151), exactly as
 * `Translated` marks a plain one.
 */
export function NoticeText({
  locale,
  text,
  values,
}: {
  locale: string;
  text: MessageKey;
  values: Readonly<Record<string, ReactNode>>;
}) {
  const resolved = message(isLocale(locale) ? locale : DEFAULT_LOCALE, text);
  const nodes = richText(resolved.text, values);
  return resolved.status === 'untranslated' ? (
    <span lang={DEFAULT_LOCALE} dir={directionOf(DEFAULT_LOCALE)} data-translation="untranslated">
      {nodes}
    </span>
  ) : (
    <>{nodes}</>
  );
}
