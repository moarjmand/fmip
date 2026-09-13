import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { message, type MessageKey } from '@/i18n/messages';

/**
 * One message, rendered with the truth about where it came from (T-151).
 *
 * When a locale has no translation for a key, the English text is shown — and
 * marked, with `lang="en"`. That is not a decoration: it is what HTML already
 * provides for, and it is what makes the fallback honest. A screen reader
 * switches pronunciation instead of reading English words with Arabic phonetics;
 * a browser's translation offer knows what it is looking at; and a reader who
 * inspects the page can see that nobody has translated this yet.
 *
 * The alternative — rendering the English silently — produces a page that looks
 * finished and is not, which is the failure rule 3 describes, applied to
 * language. Machine-translating it instead would be worse: content nobody
 * checked, presented as the product's own words.
 */
export function Translated({
  locale,
  message: key,
  className,
}: {
  locale: string;
  message: MessageKey;
  className?: string;
}) {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const { text, status } = message(resolved, key);

  if (status === 'untranslated') {
    return (
      <span lang={DEFAULT_LOCALE} data-translation="untranslated" className={className}>
        {text}
      </span>
    );
  }
  return className === undefined ? <>{text}</> : <span className={className}>{text}</span>;
}
