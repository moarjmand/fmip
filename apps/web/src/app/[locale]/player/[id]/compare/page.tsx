import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PlayerPage } from '@fmip/contracts';
import { fetchPlayer, fetchSearch } from '@/lib/api';
import { Translated } from '@/components/translated';
import { attribute } from '@/i18n/messages';
import { coverageText, pageLocale, say } from '@/lib/competition';
import { POSITION_KEY } from '@/lib/player';
import {
  cellText,
  compareHref,
  compareRows,
  displayName,
  pickerQuery,
  readCompareWith,
  readScope,
  resolveScope,
  rowNote,
  scopeLabel,
  scopesOf,
} from '@/lib/player-compare';
import { MIN_QUERY_LENGTH, readSearchTerm } from '@/lib/search';
import { pageMetadata } from '@/lib/seo';
import { Button, Notice, controlClasses } from '@/components/ui';
import { Stamp } from '@/components/stamp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  const other = readCompareWith(query);
  const noindex = {
    title: `${say(locale, 'compare.title')} · FMIP`,
    robots: { index: false, follow: false },
  };
  if (!UUID.test(id) || other.state !== 'id' || other.id === id.toLowerCase()) return noindex;
  const [a, b] = await Promise.all([fetchPlayer(id, locale), fetchPlayer(other.id, locale)]);
  // Indexed only when both players exist: a picker, an error or a 404 is not a page.
  if (!a.ok || !b.ok) return noindex;
  return pageMetadata({
    locale,
    path: `/player/${a.data.person.id}/compare?with=${b.data.person.id}`,
    title: `${say(locale, 'competitionPage.versus', {
      home: displayName(a.data.person),
      away: displayName(b.data.person),
    })} · FMIP`,
    description: say(locale, 'compare.metaDescription', {
      a: a.data.person.full_name,
      b: b.data.person.full_name,
    }),
  });
}

function positionOf(locale: string, page: PlayerPage): string {
  const position = page.current_spell?.position ?? null;
  return say(locale, position === null ? 'teamPage.group.unknown' : POSITION_KEY[position]);
}

/**
 * Two players compared (blueprint 5.3, T-631): both player pages fetched side
 * by side and their records lined up for one season and competition. A figure
 * one side lacks is a coverage state with its reason, never a zero or a blank.
 * Without `?with=` it is the picker: a search over players. Its words come
 * from the catalogue (T-1304).
 */
export default async function ComparePlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const other = readCompareWith(query);
  if (other.state === 'malformed') notFound();
  const otherId = other.state === 'id' && other.id !== id.toLowerCase() ? other.id : null;
  const term = readSearchTerm(query);
  const ask = otherId === null ? pickerQuery(term) : null;

  const [a, b, search] = await Promise.all([
    fetchPlayer(id, locale),
    otherId === null ? Promise.resolve(null) : fetchPlayer(otherId, locale),
    ask === null ? Promise.resolve(null) : fetchSearch(ask),
  ]);
  if ((!a.ok && a.status === 404) || (b !== null && !b.ok && b.status === 404)) notFound();
  if (!a.ok || (b !== null && !b.ok)) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="compare.title" />
        </h1>
        <Notice tone="danger" data-testid="compare-unreachable">
          <Translated locale={locale} message="compare.unreachable" />
        </Notice>
      </main>
    );
  }
  const pageA = a.data;
  const nameA = displayName(pageA.person);
  const pickerAction = `/${locale}/player/${pageA.person.id}/compare`;
  const placeholder = attribute(pageLocale(locale), 'playerPage.comparePlaceholder');

  const picker = (
    <form
      action={pickerAction}
      method="get"
      role="search"
      className="flex flex-wrap gap-2"
      data-testid="compare-picker"
    >
      <label htmlFor="compare-term" className="w-full text-sm">
        {say(locale, 'compare.compareName', { name: nameA })}
      </label>
      <input
        id="compare-term"
        name="q"
        type="search"
        defaultValue={term}
        placeholder={placeholder.text}
        lang={placeholder.lang}
        autoComplete="off"
        className={controlClasses('md', 'min-w-0 grow')}
      />
      <Button type="submit" size="md">
        <Translated locale={locale} message="playerPage.find" />
      </Button>
    </form>
  );

  if (b === null) {
    const hits =
      search?.ok === true ? search.data.results.filter((h) => h.id !== pageA.person.id) : [];
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          <Translated locale={locale} message="compare.title" />
        </h1>
        <p className="text-sm">
          <Link href={`/${locale}/player/${pageA.person.id}`} className="underline">
            {nameA}
          </Link>
          {' · '}
          {positionOf(locale, pageA)}
        </p>
        {other.state === 'id' && (
          <p className="text-sm" data-testid="compare-same">
            <Translated locale={locale} message="compare.same" />
          </p>
        )}
        {picker}
        {ask === null ? (
          <p className="text-sm text-muted" data-testid="compare-hint">
            {term === '' ? (
              <Translated locale={locale} message="compare.hint" />
            ) : (
              <Translated locale={locale} message="searchPage.minLength" count={MIN_QUERY_LENGTH} />
            )}
          </p>
        ) : search === null || !search.ok ? (
          <Notice tone="danger" data-testid="compare-search-unreachable">
            <Translated locale={locale} message="compare.searchUnreachable" />
          </Notice>
        ) : hits.length === 0 ? (
          <p data-testid="compare-search-empty">{say(locale, 'compare.noMatch', { term })}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-default" data-testid="compare-candidates">
            {hits.map((hit) => (
              <li key={hit.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <Link
                  href={compareHref(locale, pageA.person.id, hit.id)}
                  className="font-medium underline"
                >
                  {hit.name}
                </Link>
                {hit.secondary !== null && (
                  <span className="text-sm text-muted">{hit.secondary}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </main>
    );
  }

  const pageB = b.data;
  const nameB = displayName(pageB.person);
  const scopes = scopesOf(pageA.record, pageB.record);
  const scope = resolveScope(readScope(query), scopes);
  const rows = compareRows(pageA.record, pageB.record, scope);
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-surface-raised font-semibold' : 'underline'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <bdi>{nameA}</bdi> {say(locale, 'competitionPage.v')} <bdi>{nameB}</bdi>
      </h1>

      <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="compare-players">
        {[pageA, pageB].map((page) => (
          <div key={page.person.id} className="flex min-w-0 flex-col gap-0.5">
            <dt className="font-semibold break-words">
              <Link href={`/${locale}/player/${page.person.id}`} className="underline">
                {displayName(page.person)}
              </Link>
            </dt>
            <dd className="text-muted">{positionOf(locale, page)}</dd>
            <dd className="text-muted">
              {page.current_spell === null ? (
                <Translated locale={locale} message="compare.noTeam" />
              ) : (
                page.current_spell.team.name
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="flex flex-wrap gap-x-4 text-sm">
        <Link
          href={compareHref(locale, pageB.person.id, pageA.person.id, scope)}
          className="underline"
        >
          <Translated locale={locale} message="compare.swap" />
        </Link>
        <Link href={pickerAction} className="underline" data-testid="compare-change">
          {say(locale, 'compare.another', { name: nameA })}
        </Link>
      </p>

      <nav
        aria-label={say(locale, 'compare.scopes')}
        className="flex flex-wrap gap-1 text-sm"
        data-testid="compare-scopes"
      >
        <Link
          href={compareHref(locale, pageA.person.id, pageB.person.id)}
          aria-current={scope === null ? 'true' : undefined}
          className={linkClass(scope === null)}
        >
          <Translated locale={locale} message="compare.everything" />
        </Link>
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={compareHref(locale, pageA.person.id, pageB.person.id, s)}
            aria-current={scope?.key === s.key ? 'true' : undefined}
            className={linkClass(scope?.key === s.key)}
          >
            {scopeLabel(s)}
            {!s.shared && (
              <span className="ms-1 text-xs text-muted">
                <Translated locale={locale} message="compare.onePlayer" />
              </span>
            )}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-2" data-testid="compare-figures">
        <h2 className="text-lg font-semibold">
          {scope === null ? (
            <Translated locale={locale} message="compare.everything" />
          ) : (
            scopeLabel(scope)
          )}
        </h2>
        <p className="text-xs text-muted">
          {say(locale, 'compare.recordState', {
            name: nameA,
            state: coverageText(locale, pageA.record.coverage),
          })}
          {' · '}
          {say(locale, 'compare.recordState', {
            name: nameB,
            state: coverageText(locale, pageB.record.coverage),
          })}
        </p>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-default">
              <th scope="col" className="w-2/5 py-1 pe-2 text-start">
                <span className="sr-only">
                  <Translated locale={locale} message="teamPage.figure" />
                </span>
              </th>
              <th scope="col" className="py-1 pe-2 text-end break-words">
                {nameA}
              </th>
              <th scope="col" className="py-1 text-end break-words">
                {nameB}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const note = rowNote(locale, row, nameA, nameB);
              return (
                <tr
                  key={row.key}
                  className="border-b border-default align-top"
                  data-testid="compare-row"
                  data-lacking={row.lacking ?? 'none'}
                >
                  <th scope="row" className="py-1 pe-2 text-start font-normal">
                    <Translated locale={locale} message={row.label} />
                    {note !== null && (
                      <span className="block text-xs text-muted" data-testid="compare-note">
                        {note}
                      </span>
                    )}
                  </th>
                  {[row.a, row.b].map((c, i) => (
                    <td
                      key={i}
                      className={`py-1 text-end ${i === 0 ? 'pe-2' : ''} ${
                        c.value === null ? 'text-xs italic text-muted' : 'tabular-nums'
                      }`}
                      data-coverage={c.coverage}
                    >
                      {cellText(locale, c)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          <Translated locale={locale} message="compare.footnote" />
        </p>
      </section>

      <p className="text-xs text-muted">
        {[pageA, pageB].map((page, i) => (
          <span key={page.person.id} className="block">
            {i === 0 ? nameA : nameB}:{' '}
            {page.last_updated_at === null ? (
              <Translated locale={locale} message="compare.noData" />
            ) : (
              <>
                <Translated locale={locale} message="compare.lastUpdate" />{' '}
                <Stamp iso={page.last_updated_at} locale={locale} />
              </>
            )}
          </span>
        ))}
      </p>
    </main>
  );
}
