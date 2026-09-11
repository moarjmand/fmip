import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Covered, SeasonFixture } from '@fmip/contracts';
import { fetchCompetition, fetchMe } from '@/lib/api';
import {
  KIND_LABEL,
  competitionQuery,
  fixtureLine,
  formLine,
  formatFixtureDate,
  readSeasonParam,
  seasonHref,
} from '@/lib/competition';
import { moduleState } from '@/lib/match';
import { competitionJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { JsonLd } from '@/components/json-ld';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id))
    return { title: 'Competition · FMIP', robots: { index: false, follow: false } };
  const season = readSeasonParam(query);
  const result = await fetchCompetition(id, competitionQuery(season));
  if (!result.ok)
    return pageMetadata({ locale, path: `/competition/${id}`, title: 'Competition · FMIP' });
  const c = result.data.competition;
  // The current season is the canonical page; an older season is its own URL.
  const path = result.data.season.is_current
    ? `/competition/${c.id}`
    : `/competition/${c.id}?season=${result.data.season.id}`;
  return pageMetadata({
    locale,
    path,
    title: `${c.name} ${result.data.season.label} · FMIP`,
    description: `${c.name} ${result.data.season.label}: table, results, fixtures and top scorers.`,
  });
}

/**
 * The competition page (blueprint 5.1, T-035): overview, season selector,
 * league table, results and fixtures, top scorers — each module with its
 * coverage from the API, an unreachable API said out loud. Team names become
 * links with the team page (T-036).
 */
export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const seasonParam = readSeasonParam(query);
  const [result, me] = await Promise.all([
    fetchCompetition(id, competitionQuery(seasonParam)),
    fetchMe(await sessionCookieHeader()),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Competition</h1>
        <p role="alert" data-testid="competition-unreachable">
          The service is unreachable right now, so this competition cannot be shown.
        </p>
      </main>
    );
  }
  const page = result.data;
  const timeZone = me?.timezone ?? 'UTC';
  const c = page.competition;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <JsonLd data={competitionJsonLd(locale, page)} />
      <header className="flex flex-col gap-1" data-testid="competition-header">
        <p className="text-sm opacity-70">
          {c.country !== null ? `${c.country.name} · ` : ''}
          {KIND_LABEL[c.kind] ?? c.kind}
          {c.tier !== null ? ` · Tier ${c.tier}` : ''}
          {c.gender === 'women' ? ' · Women' : ''}
        </p>
        <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
          {c.name}
        </h1>
        <nav
          aria-label="Season"
          className="mt-2 flex flex-wrap gap-1 text-sm"
          data-testid="seasons"
        >
          {page.seasons.map((season) => (
            <Link
              key={season.id}
              href={seasonHref(locale, c.id, season)}
              aria-current={season.id === page.season.id ? 'true' : undefined}
              className={`rounded px-2 py-1 ${
                season.id === page.season.id ? 'bg-current/10 font-semibold' : 'underline'
              }`}
            >
              {season.label}
              {season.is_current ? ' (current)' : ''}
            </Link>
          ))}
        </nav>
      </header>

      <Module title="Table" module={page.table} testId="table">
        {(rows) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-current/20">
                  <th scope="col" className="py-1 pe-2 text-start">
                    #
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    Team
                  </th>
                  {['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((h) => (
                    <th key={h} scope="col" className="py-1 pe-2 text-end">
                      {h}
                    </th>
                  ))}
                  <th scope="col" className="py-1 text-start">
                    Form
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.team.id}
                    className="border-b border-current/10"
                    data-testid="table-row"
                  >
                    <td className="py-1 pe-2 tabular-nums">{row.position}</td>
                    <td className="py-1 pe-2">
                      <Link href={`/${locale}/team/${row.team.id}`} className="underline">
                        {row.team.name}
                      </Link>
                    </td>
                    {[
                      row.played,
                      row.won,
                      row.drawn,
                      row.lost,
                      row.goals_for,
                      row.goals_against,
                      row.goal_difference,
                    ].map((n, i) => (
                      <td key={i} className="py-1 pe-2 text-end tabular-nums">
                        {n}
                      </td>
                    ))}
                    <td className="py-1 pe-2 text-end font-semibold tabular-nums">{row.points}</td>
                    <td className="py-1 font-mono text-xs">{formLine(row.form)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Module>

      <section className="flex flex-col gap-2" data-testid="results">
        <h2 className="text-lg font-semibold">Results</h2>
        {page.results.length === 0 ? (
          <p className="text-sm opacity-70">No results stored for this season.</p>
        ) : (
          <FixtureList fixtures={page.results} locale={locale} timeZone={timeZone} />
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="fixtures">
        <h2 className="text-lg font-semibold">Fixtures</h2>
        {page.fixtures.length === 0 ? (
          <p className="text-sm opacity-70">No fixtures scheduled for this season.</p>
        ) : (
          <FixtureList fixtures={page.fixtures} locale={locale} timeZone={timeZone} />
        )}
      </section>

      <Module title="Top scorers" module={page.leaders} testId="leaders">
        {(leaders) => (
          <ol className="flex flex-col gap-1 text-sm">
            {leaders.map((leader, index) => (
              <li key={leader.person.id} className="flex gap-3">
                <span className="w-6 tabular-nums opacity-60">{index + 1}</span>
                <span className="grow">
                  <Link href={`/${locale}/player/${leader.person.id}`} className="underline">
                    {leader.person.name}
                  </Link>
                  {leader.team !== null && (
                    <span className="ms-2 text-xs opacity-70">{leader.team.name}</span>
                  )}
                </span>
                <span className="tabular-nums font-semibold">{leader.goals}</span>
              </li>
            ))}
          </ol>
        )}
      </Module>

      <section className="flex flex-col gap-2" data-testid="coverage">
        <h2 className="text-lg font-semibold">Coverage for this season</h2>
        {Object.keys(page.coverage).length === 0 ? (
          <p className="text-sm opacity-70">No coverage declared for this season.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {Object.entries(page.coverage).map(([module, state]) => (
              <li key={module} className="rounded border border-current/20 px-2 py-1">
                {module.replace('_', ' ')}:{' '}
                {moduleState({ coverage: state, last_updated_at: null, data: null })}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs opacity-60">
          {page.last_updated_at === null ? (
            'No fixture data stored yet.'
          ) : (
            <>
              Last data update <time dateTime={page.last_updated_at}>{page.last_updated_at}</time>
            </>
          )}
        </p>
      </section>
    </main>
  );
}

function Module<T>({
  title,
  module,
  testId,
  children,
}: {
  title: string;
  module: Covered<T[]>;
  testId: string;
  children: (data: T[]) => React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-lg font-semibold">
        {title}
        <span className="ms-2 text-xs font-normal uppercase opacity-60">{moduleState(module)}</span>
      </h2>
      {module.data === null || module.data.length === 0 ? (
        <p className="text-sm opacity-70" data-testid={`${testId}-empty`}>
          {module.coverage === 'delayed'
            ? 'Data for this module is behind; nothing is shown rather than something stale.'
            : 'Not supplied for this season.'}
        </p>
      ) : (
        children(module.data)
      )}
      {module.last_updated_at !== null && (
        <p className="text-xs opacity-60">
          Updated <time dateTime={module.last_updated_at}>{module.last_updated_at}</time>
        </p>
      )}
    </section>
  );
}

function FixtureList({
  fixtures,
  locale,
  timeZone,
}: {
  fixtures: SeasonFixture[];
  locale: string;
  timeZone: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-current/10 text-sm">
      {fixtures.map((fixture) => (
        <li
          key={fixture.id}
          className="flex flex-wrap items-baseline gap-x-3 py-2"
          data-testid="fixture"
        >
          <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
            {fixtureLine(fixture)}
          </Link>
          <span className="text-xs opacity-70">
            <time dateTime={fixture.kickoff_at}>
              {formatFixtureDate(fixture.kickoff_at, timeZone)}
            </time>
            {fixture.stage !== null ? ` · ${fixture.stage.name}` : ''}
            {fixture.round !== null ? ` · ${fixture.round}` : ''}
            {fixture.status !== 'finished' && fixture.status !== 'scheduled'
              ? ` · ${fixture.status}`
              : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
