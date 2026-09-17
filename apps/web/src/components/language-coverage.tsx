import { SHIPPABLE_COMPLETENESS } from '@/i18n/messages';
import { languageRows } from '@/lib/language-coverage';

/**
 * The operator's language table (T-302, D-066): the surface behind "how much
 * of `tr` is done is an answer the product gives, not a grep".
 *
 * Renders `languageRows()` and computes nothing. The threshold is printed
 * beside "Not yet offered" because a bare "no" invites the question of how far
 * away "yes" is.
 */
export function LanguageCoverage({ locale }: { locale: string }) {
  const rows = languageRows();
  const threshold = Math.round(SHIPPABLE_COMPLETENESS * 100);

  return (
    <section className="flex flex-col gap-3" data-testid="admin-languages">
      <h2 className="text-lg font-semibold">Languages</h2>
      <p className="text-sm opacity-70">
        From the translators&rsquo; files in <code>src/i18n/catalogues/</code>. A language is
        offered to readers at {threshold}% and not before; below that it still routes, so a
        translator can see their work in place.
      </p>
      <ul className="divide-y divide-current/10">
        {rows.map((row) => (
          <li
            key={row.locale}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
            data-testid="language-row"
            data-locale={row.locale}
            data-offered={row.offered ? 'yes' : 'no'}
          >
            <a href={`/${row.locale}`} className="font-medium underline" lang={row.locale}>
              {row.autonym}
            </a>
            {row.locale !== locale && row.autonym !== row.name && (
              <span className="text-sm opacity-70">{row.name}</span>
            )}
            <span className="text-sm" data-testid="language-percent">
              {row.percent}%
            </span>
            <span className="text-sm opacity-70">
              {row.coverage.translated + row.coverage.reviewed} of {row.coverage.total} done
              {row.coverage.reviewed > 0 ? `, ${row.coverage.reviewed} reviewed` : ''}
              {row.coverage.untranslated > 0 ? `, ${row.coverage.untranslated} to go` : ''}
            </span>
            <span className="text-sm">{row.offered ? 'Offered' : 'Not yet offered'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
