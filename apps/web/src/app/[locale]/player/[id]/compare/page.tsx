import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PlayerPage } from '@fmip/contracts';
import { fetchPlayer, fetchSearch } from '@/lib/api';
import { moduleState } from '@/lib/match';
import { POSITION_LABEL } from '@/lib/player';
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
  const noindex = { title: 'Compare players · FMIP', robots: { index: false, follow: false } };
  if (!UUID.test(id) || other.state !== 'id' || other.id === id.toLowerCase()) return noindex;
  const [a, b] = await Promise.all([fetchPlayer(id, locale), fetchPlayer(other.id, locale)]);
  // Indexed only when both players exist: a picker, an error or a 404 is not a page.
  if (!a.ok || !b.ok) return noindex;
  return pageMetadata({
    locale,
    path: `/player/${a.data.person.id}/compare?with=${b.data.person.id}`,
    title: `${displayName(a.data.person)} v ${displayName(b.data.person)} · FMIP`,
    description: `${a.data.person.full_name} and ${b.data.person.full_name} compared, season by season and competition by competition.`,
  });
}

function positionOf(page: PlayerPage): string {
  const position = page.current_spell?.position ?? null;
  return position === null ? 'Position not recorded' : POSITION_LABEL[position];
}

/**
 * Two players compared (blueprint 5.3, T-631): both player pages fetched side
 * by side and their records lined up for one season and competition. A figure
 * one side lacks is a coverage state with its reason, never a zero or a blank.
 * Without `?with=` it is the picker: a search over players.
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
        <h1 className="text-2xl font-semibold">Compare players</h1>
        <Notice tone="danger" data-testid="compare-unreachable">
          The service is unreachable right now, so these players cannot be compared.
        </Notice>
      </main>
    );
  }
  const pageA = a.data;
  const nameA = displayName(pageA.person);
  const pickerAction = `/${locale}/player/${pageA.person.id}/compare`;

  const picker = (
    <form
      action={pickerAction}
      method="get"
      role="search"
      className="flex flex-wrap gap-2"
      data-testid="compare-picker"
    >
      <label htmlFor="compare-term" className="w-full text-sm">
        Compare {nameA} with…
      </label>
      <input
        id="compare-term"
        name="q"
        type="search"
        defaultValue={term}
        placeholder="Another player’s name"
        autoComplete="off"
        className={controlClasses('md', 'min-w-0 grow')}
      />
      <Button type="submit" size="md">
        Find
      </Button>
    </form>
  );

  if (b === null) {
    const hits =
      search?.ok === true ? search.data.results.filter((h) => h.id !== pageA.person.id) : [];
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          Compare players
        </h1>
        <p className="text-sm">
          <Link href={`/${locale}/player/${pageA.person.id}`} className="underline">
            {nameA}
          </Link>
          {' · '}
          {positionOf(pageA)}
        </p>
        {other.state === 'id' && (
          <p className="text-sm" data-testid="compare-same">
            That is the same player. Choose somebody else.
          </p>
        )}
        {picker}
        {ask === null ? (
          <p className="text-sm text-muted" data-testid="compare-hint">
            {term === ''
              ? 'Type the name of the player to compare with.'
              : `Type at least ${MIN_QUERY_LENGTH} characters.`}
          </p>
        ) : search === null || !search.ok ? (
          <Notice tone="danger" data-testid="compare-search-unreachable">
            The service is unreachable right now, so no player can be searched.
          </Notice>
        ) : hits.length === 0 ? (
          <p data-testid="compare-search-empty">No player matches “{term}”.</p>
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
        <bdi>{nameA}</bdi> v <bdi>{nameB}</bdi>
      </h1>

      <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="compare-players">
        {[pageA, pageB].map((page) => (
          <div key={page.person.id} className="flex min-w-0 flex-col gap-0.5">
            <dt className="font-semibold break-words">
              <Link href={`/${locale}/player/${page.person.id}`} className="underline">
                {displayName(page.person)}
              </Link>
            </dt>
            <dd className="text-muted">{positionOf(page)}</dd>
            <dd className="text-muted">
              {page.current_spell === null
                ? 'No current team on record'
                : page.current_spell.team.name}
            </dd>
          </div>
        ))}
      </dl>

      <p className="flex flex-wrap gap-x-4 text-sm">
        <Link
          href={compareHref(locale, pageB.person.id, pageA.person.id, scope)}
          className="underline"
        >
          Swap sides
        </Link>
        <Link href={pickerAction} className="underline" data-testid="compare-change">
          Compare {nameA} with somebody else
        </Link>
      </p>

      <nav
        aria-label="Season and competition"
        className="flex flex-wrap gap-1 text-sm"
        data-testid="compare-scopes"
      >
        <Link
          href={compareHref(locale, pageA.person.id, pageB.person.id)}
          aria-current={scope === null ? 'true' : undefined}
          className={linkClass(scope === null)}
        >
          Everything on record
        </Link>
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={compareHref(locale, pageA.person.id, pageB.person.id, s)}
            aria-current={scope?.key === s.key ? 'true' : undefined}
            className={linkClass(scope?.key === s.key)}
          >
            {scopeLabel(s)}
            {!s.shared && <span className="ms-1 text-xs text-muted">(one player only)</span>}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-2" data-testid="compare-figures">
        <h2 className="text-lg font-semibold">
          {scope === null ? 'Everything on record' : scopeLabel(scope)}
        </h2>
        <p className="text-xs text-muted">
          {nameA}: record {moduleState(pageA.record)} · {nameB}: record {moduleState(pageB.record)}
        </p>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-default">
              <th scope="col" className="w-2/5 py-1 pe-2 text-start">
                <span className="sr-only">Figure</span>
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
              const note = rowNote(row, nameA, nameB);
              return (
                <tr
                  key={row.key}
                  className="border-b border-default align-top"
                  data-testid="compare-row"
                  data-lacking={row.lacking ?? 'none'}
                >
                  <th scope="row" className="py-1 pe-2 text-start font-normal">
                    {row.label}
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
                      {cellText(c)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Figures come from our line-ups and incidents. Player ratings and advanced statistics are
          not held for these players and are not shown.
        </p>
      </section>

      <p className="text-xs text-muted">
        {[pageA, pageB].map((page, i) => (
          <span key={page.person.id} className="block">
            {i === 0 ? nameA : nameB}:{' '}
            {page.last_updated_at === null ? (
              'no match data stored yet'
            ) : (
              <>
                last data update <time dateTime={page.last_updated_at}>{page.last_updated_at}</time>
              </>
            )}
          </span>
        ))}
      </p>
    </main>
  );
}
