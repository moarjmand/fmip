import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type Message, type MessageKey, interpolate, message } from '@/i18n/messages';
import { MessageText } from '@/components/message-text';

/**
 * A sentence with values in it, for the community surfaces (T-1308).
 *
 * `Translated` fills placeholders only for a plural; a sentence such as
 * "asked {when}" or "Discuss in {group}" needs them too, and building
 * it from fragments would fix the English word order into every language.
 * So the whole sentence is one catalogue entry and the values go in here,
 * with the same marking of a fallback as `Translated` gives.
 */
export function said(
  locale: string,
  key: MessageKey,
  params: Record<string, string> = {},
): Message {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const found = message(resolved, key);
  return { ...found, text: interpolate(found.text, params) };
}

/** `said`, rendered: the English marked `lang="en"` where nobody has translated it. */
export function Said({
  locale,
  message: key,
  params,
  className,
}: {
  locale: string;
  message: MessageKey;
  params?: Record<string, string>;
  className?: string;
}) {
  return <MessageText message={said(locale, key, params)} className={className} />;
}
