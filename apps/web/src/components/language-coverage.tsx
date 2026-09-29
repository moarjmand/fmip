import type { LocaleHoldRecord } from '@fmip/contracts';
import { LocaleHoldForm } from '@/components/locale-hold-form';
import { SHIPPABLE_COMPLETENESS } from '@/i18n/messages';
import { languageRows } from '@/lib/language-coverage';

/**
 * The operator's language table (T-302, D-066): the surface behind "how much
 * of `tr` is done is an answer the product gives, not a grep".
 *
 * Renders `languageRows()` and computes nothing. The threshold is printed
 * beside "Not yet offered" because a bare "no" invites the question of how far
 * away "yes" is.
 *
 * T-1163 (D-155): a ready language may be held back with a reason, and a
 * held one released; the row says who held it, since when and why. `holds`
 * is `null` when the console's list could not be read, and then no hold form
 * is offered, since the page cannot say which languages are held.
 */
export function LanguageCoverage({
  locale,
  holds,
}: {
  locale: string;
  holds: readonly LocaleHoldRecord[] | null;
}) {
  const rows = languageRows(holds);
  const threshold = Math.round(SHIPPABLE_COMPLETENESS * 100);

  return (
    <section className="flex flex-col gap-3" data-testid="admin-languages">
      <h2 className="text-lg font-semibold">Languages</h2>
      <p className="text-sm text-muted">
        From the translators&rsquo; files in <code>src/i18n/catalogues/</code>. A language is
        offered to readers at {threshold}% and not before; below that it still routes, so a
        translator can see their work in place. An administrator may hold back a ready language with
        a reason: the picker and the first run then leave it out, and its pages answer as a language
        not yet offered does. The translators&rsquo; files are not touched.
      </p>
      {holds === null && (
        <p className="text-sm text-danger" data-testid="language-holds-unreachable">
          Which languages are held back cannot be read right now, so readers are offered English
          only until it can.
        </p>
      )}
      <ul className="divide-y divide-default">
        {rows.map((row) => (
          <li
            key={row.locale}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
            data-testid="language-row"
            data-locale={row.locale}
            data-offered={row.offered ? 'yes' : 'no'}
            data-held={row.hold !== null ? 'yes' : 'no'}
          >
            <a href={`/${row.locale}`} className="font-medium underline" lang={row.locale}>
              {row.autonym}
            </a>
            {row.locale !== locale && row.autonym !== row.name && (
              <span className="text-sm text-muted">{row.name}</span>
            )}
            <span className="text-sm" data-testid="language-percent">
              {row.percent}%
            </span>
            <span className="text-sm text-muted">
              {row.coverage.translated + row.coverage.reviewed} of {row.coverage.total} done
              {row.coverage.reviewed > 0 ? `, ${row.coverage.reviewed} reviewed` : ''}
              {row.coverage.untranslated > 0 ? `, ${row.coverage.untranslated} to go` : ''}
            </span>
            <span className="text-sm">
              {row.offered
                ? 'Offered'
                : row.hold !== null
                  ? 'Ready, held back'
                  : row.ready && holds === null
                    ? 'Ready, not offered while the holds cannot be read'
                    : 'Not yet offered'}
            </span>
            {row.hold !== null && (
              <span className="w-full text-sm text-muted" data-testid="language-hold">
                Held back by {row.hold.held_by} since{' '}
                <time dateTime={row.hold.held_at}>{row.hold.held_at.slice(0, 10)}</time>:{' '}
                {row.hold.reason}
              </span>
            )}
            {holds !== null && row.hold !== null && (
              <LocaleHoldForm
                pageLocale={locale}
                target={row.locale}
                verb="release"
                name={row.name}
              />
            )}
            {holds !== null && row.hold === null && row.ready && row.locale !== 'en' && (
              <LocaleHoldForm pageLocale={locale} target={row.locale} verb="hold" name={row.name} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
