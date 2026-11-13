import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import type { PlayerPage } from '@fmip/contracts';
import { fetchMe, fetchPlayer, fetchSearch } from '@/lib/api';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';
import { attribute } from '@/i18n/messages';
import { coverageText, pageLocale, say } from '@/lib/competition';
import { POSITION_KEY, ageOn, clubBasisText, clubClaim, positionValue } from '@/lib/player';
import { EntityImage } from '@/components/entity-image';
import { formatNumber } from '@/i18n/format';
import {
  cellText,
  compareHref,
  compareRows,
  displayName,
  pickerQuery,
  readCompareWith,
  readScope,
  resolveScope,
  rowBars,
  rowNote,
  scopeLabel,
  scopesBySeason,
  scopesOf,
} from '@/lib/player-compare';
import { MIN_QUERY_LENGTH, readSearchTerm } from '@/lib/search';
import { pageMetadata } from '@/lib/seo';
import { Button, Notice, controlClasses, inlineTargetClasses } from '@/components/ui';
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
    title: `${say(locale, 'compare.title')} · Stadiomind`,
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
    })} · Stadiomind`,
    description: say(locale, 'compare.metaDescription', {
      a: a.data.person.full_name,
      b: b.data.person.full_name,
    }),
  });
}

function positionOf(locale: string, page: PlayerPage): string {
  const position = positionValue(page);
  return say(locale, position === null ? 'teamPage.group.unknown' : POSITION_KEY[position]);
}

/**
 * One player's identity beside the other's (T-1630): position, the club with
 * its crest and what says so (T-1629), the national team when a line-up names
 * one, and the age. Each one we do not hold is said to be missing, never
 * left blank or guessed (rule 3).
 */
function Identity({ page, locale }: { page: PlayerPage; locale: string }) {
  const club = clubClaim(page);
  const national = page.national_team ?? null;
  const age = ageOn(page.person.date_of_birth, new Date());
  const teamLink = inlineTargetClasses('gap-1.5 align-middle font-medium hover:underline');
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="compare-player">
      <dt className="font-semibold break-words">
        <Link href={`/${locale}/player/${page.person.id}`} className="underline">
          {displayName(page.person)}
        </Link>
      </dt>
      <dd className="text-muted" data-testid="compare-position">
        {positionOf(locale, page)}
      </dd>
      <dd className="min-w-0 break-words" data-testid="compare-club">
        {club === null ? (
          <span className="text-muted">
            <Translated locale={locale} message="compare.noTeam" />
          </span>
        ) : (
          <>
            <Link href={`/${locale}/team/${club.team.id}`} className={teamLink}>
              <EntityImage media={club.team.crest} kind="crest" name={club.team.name} size={20} />
              <bdi>{club.team.name}</bdi>
            </Link>
            <span className="block text-xs text-muted" data-basis={club.basis}>
              {club.on_loan ? `${say(locale, 'teamPage.onLoan')} · ` : ''}
              {clubBasisText(locale, club)}
            </span>
          </>
        )}
      </dd>
      {national !== null && (
        <dd className="min-w-0 break-words" data-testid="compare-national">
          <span className="block text-xs text-muted">
            <Translated locale={locale} message="playerPage.nationalTeam" />
          </span>
          <Link href={`/${locale}/team/${national.team.id}`} className={teamLink}>
            <EntityImage
              media={national.team.crest}
              kind="crest"
              name={national.team.name}
              size={20}
            />
            <bdi>{national.team.name}</bdi>
          </Link>
        </dd>
      )}
      <dd className="text-muted" data-testid="compare-age">
        {age === null
          ? say(locale, 'compare.ageNotSupplied')
          : say(locale, 'compare.age', { age: formatNumber(locale, age) })}
      </dd>
    </div>
  );
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

  const [a, b, search, me] = await Promise.all([
    fetchPlayer(id, locale),
    otherId === null ? Promise.resolve(null) : fetchPlayer(otherId, locale),
    ask === null ? Promise.resolve(null) : fetchSearch(ask),
    sessionCookieHeader().then(fetchMe),
  ]);
  // The stamps in the reader's zone, as every other page has them (T-1797, D-207, D-337).
  const { timeZone } = await pageTimeZone(locale, me);
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
    // Each candidate's position and club as his own page reads them (T-1804,
    // D-402): the same claim the comparison's header makes, so a namesake is
    // told apart by what the page will show once chosen. One read per
    // candidate (at most `pickerQuery`'s ten); one that fails keeps the
    // search's own line.
    const candidates = await Promise.all(
      hits.map((hit) => fetchPlayer(hit.id, locale).then((page) => (page.ok ? page.data : null))),
    );
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
            {hits.map((hit, i) => {
              const page = candidates[i] ?? null;
              const club = page === null ? null : clubClaim(page);
              return (
                <li
                  key={hit.id}
                  className="flex flex-wrap items-baseline gap-x-3 py-2"
                  data-testid="compare-candidate"
                >
                  <Link
                    href={compareHref(locale, pageA.person.id, hit.id)}
                    className="inline-flex min-h-touch items-center font-medium underline md:min-h-0"
                  >
                    {hit.name}
                  </Link>
                  {page !== null ? (
                    <span className="text-sm text-muted" data-testid="compare-candidate-line">
                      {positionOf(locale, page)}
                      {' · '}
                      {club === null ? (
                        <Translated locale={locale} message="compare.noTeam" />
                      ) : (
                        <bdi>{club.team.name}</bdi>
                      )}
                    </span>
                  ) : (
                    hit.secondary !== null && (
                      <span className="text-sm text-muted">
                        <bdi>{hit.secondary}</bdi>
                      </span>
                    )
                  )}
                </li>
              );
            })}
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
  const seasons = scopesBySeason(scopes);
  const scopeRow = (active: boolean): string =>
    `flex min-h-touch items-center gap-2 rounded-control px-3 ${
      active ? 'bg-surface-raised font-bold' : 'hover:bg-surface-raised'
    }`;
  const heads = [pageA, pageB].map((page) => {
    const club = clubClaim(page);
    return { page, club };
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:gap-6 sm:p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <bdi>{nameA}</bdi> {say(locale, 'competitionPage.v')} <bdi>{nameB}</bdi>
      </h1>

      {/*
       * The season and competition (T-1804, D-402): one 48px row naming the
       * choice, and every scope under its season in a native details -- the
       * same links as before, no script. Closed, the table starts under it.
       */}
      <details className="group rounded-card border border-default bg-surface text-sm">
        <summary
          className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 [&::-webkit-details-marker]:hidden"
          data-testid="compare-scope-toggle"
        >
          <span className="text-xs text-muted">
            <Translated locale={locale} message="compare.season" />
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">
            {scope === null ? (
              <Translated locale={locale} message="compare.everything" />
            ) : (
              <bdi>{scopeLabel(scope)}</bdi>
            )}
          </span>
          <svg
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className="shrink-0 text-muted transition-transform group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <nav
          aria-label={say(locale, 'compare.scopes')}
          className="flex flex-col gap-1 border-t border-default p-2"
          data-testid="compare-scopes"
        >
          <Link
            href={compareHref(locale, pageA.person.id, pageB.person.id)}
            aria-current={scope === null ? 'true' : undefined}
            className={scopeRow(scope === null)}
          >
            <Translated locale={locale} message="compare.everything" />
          </Link>
          {seasons.map((group) => (
            <section key={group.season.id} data-testid="compare-season">
              <h3 className="px-3 pt-2 text-xs font-bold text-muted">
                <bdi>{group.season.label}</bdi>
              </h3>
              <ul>
                {group.scopes.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={compareHref(locale, pageA.person.id, pageB.person.id, s)}
                      aria-current={scope?.key === s.key ? 'true' : undefined}
                      className={scopeRow(scope?.key === s.key)}
                    >
                      <span className="min-w-0 flex-1">
                        <bdi>{s.competition.short_name ?? s.competition.name}</bdi>
                      </span>
                      {!s.shared && (
                        <span className="shrink-0 text-xs font-normal text-muted">
                          <Translated locale={locale} message="compare.onePlayer" />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </details>

      <section className="flex flex-col gap-2" data-testid="compare-figures">
        <h2 className="sr-only">
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
              {heads.map(({ page, club }, i) => (
                <th
                  key={page.person.id}
                  scope="col"
                  className={`py-1 text-end align-bottom break-words ${i === 0 ? 'pe-2' : ''}`}
                  data-testid="compare-head"
                >
                  <bdi>{i === 0 ? nameA : nameB}</bdi>
                  <span className="block text-xs font-normal text-muted">
                    {club === null ? (
                      <Translated locale={locale} message="compare.noTeam" />
                    ) : (
                      <bdi>{club.team.short_name ?? club.team.name}</bdi>
                    )}
                    {' · '}
                    {positionOf(locale, page)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const note = rowNote(locale, row, nameA, nameB);
              const bars = rowBars(row);
              return (
                <tr
                  key={row.key}
                  className="border-b border-default align-top"
                  data-testid="compare-row"
                  data-lacking={row.lacking ?? 'none'}
                  data-ahead={bars?.ahead ?? 'none'}
                >
                  <th scope="row" className="py-1 pe-2 text-start font-normal">
                    <Translated locale={locale} message={row.label} />
                    {note !== null && (
                      <span className="block text-xs text-muted" data-testid="compare-note">
                        {note}
                      </span>
                    )}
                  </th>
                  {[row.a, row.b].map((c, i) => {
                    const side = i === 0 ? 'a' : 'b';
                    const ahead = bars !== null && bars.ahead === side;
                    const share = bars === null ? null : side === 'a' ? bars.a : bars.b;
                    return (
                      <td
                        key={i}
                        className={`py-1 text-end ${i === 0 ? 'pe-2' : ''} ${
                          c.value === null ? 'text-xs italic text-muted' : 'tabular-nums'
                        } ${ahead ? 'font-bold' : ''}`}
                        data-coverage={c.coverage}
                      >
                        {cellText(locale, c)}
                        {ahead && (
                          <span className="sr-only">
                            {' '}
                            <Translated locale={locale} message="compare.higher" />
                          </span>
                        )}
                        {/* A short bar, as long as the figure is against the row's larger one. */}
                        {share !== null && share > 0 && (
                          <span
                            aria-hidden="true"
                            className="ms-auto mt-1 block h-1 w-16 max-w-full"
                          >
                            <span
                              className={`ms-auto block h-full rounded-full ${
                                ahead ? 'bg-fg' : 'bg-caption'
                              }`}
                              style={{ inlineSize: `${Math.round(share * 100)}%` }}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          <Translated locale={locale} message="compare.footnote" />
        </p>
      </section>

      <p className="flex flex-wrap gap-x-4 text-sm">
        <Link
          href={compareHref(locale, pageB.person.id, pageA.person.id, scope)}
          className="inline-flex min-h-touch items-center underline md:min-h-0"
        >
          <Translated locale={locale} message="compare.swap" />
        </Link>
        <Link
          href={pickerAction}
          className="inline-flex min-h-touch items-center underline md:min-h-0"
          data-testid="compare-change"
        >
          {say(locale, 'compare.another', { name: nameA })}
        </Link>
      </p>

      <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="compare-players">
        {[pageA, pageB].map((page) => (
          <Identity key={page.person.id} page={page} locale={locale} />
        ))}
      </dl>

      <p className="text-xs text-muted">
        {[pageA, pageB].map((page, i) => (
          <span key={page.person.id} className="block">
            {i === 0 ? nameA : nameB}:{' '}
            {page.last_updated_at === null ? (
              <Translated locale={locale} message="compare.noData" />
            ) : (
              <>
                <Translated locale={locale} message="compare.lastUpdate" />{' '}
                <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
              </>
            )}
          </span>
        ))}
      </p>
    </main>
  );
}
