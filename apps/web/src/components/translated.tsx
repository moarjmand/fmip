import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, type PluralKey, message, plural } from '@/i18n/messages';

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
 *
 * With `count`, the key is a plural (T-301) and the form is chosen by the
 * locale's own rules; `params` fills any other `{name}` placeholder. The
 * marking is the same either way — a plural nobody has translated is English
 * and says so, exactly like a sentence.
 */
export function Translated(
  props: { locale: string; className?: string } & (
    | { message: MessageKey; count?: undefined; params?: undefined }
    | { message: PluralKey; count: number; params?: Record<string, string> }
  ),
) {
  const { locale, message: key, className } = props;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const { text, status } =
    props.count === undefined
      ? message(resolved, key)
      : plural(resolved, props.message, props.count, props.params);

  if (status === 'untranslated') {
    return (
      <span lang={DEFAULT_LOCALE} data-translation="untranslated" className={className}>
        {text}
      </span>
    );
  }
  return className === undefined ? <>{text}</> : <span className={className}>{text}</span>;
}
