import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMe, fetchPlayer } from '@/lib/api';
import { formatFixtureDate } from '@/lib/competition';
import { moduleState } from '@/lib/match';
import {
  FOOT_LABEL,
  POSITION_LABEL,
  ageOn,
  appearances,
  filterMatches,
  filterRecord,
  readSeasonFilter,
  roleLabel,
  seasonsOf,
  spellPeriod,
} from '@/lib/player';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: 'Player · FMIP' };
  const result = await fetchPlayer(id);
  return {
    title: result.ok
      ? `${result.data.person.known_as ?? result.data.person.full_name} · FMIP`
      : 'Player · FMIP',
  };
}

/**
 * The player page (blueprint 5.3, T-037): identity, current team, career
 * spells, the record per season and competition that our line-ups and
 * incidents support, and the recent-match log, with a season selector over
 * both. Statistics we do not hold are named as such, never shown as zero.
 */
export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [result, me] = await Promise.all([fetchPlayer(id), fetchMe(await sessionCookieHeader())]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Player</h1>
        <p role="alert" data-testid="player-unreachable">
          The service is unreachable right now, so this player cannot be shown.
        </p>
      </main>
    );
  }
  const page = result.data;
  const p = page.person;
  const timeZone = me?.timezone ?? 'UTC';
  const seasonFilter = readSeasonFilter(query);
  const record = page.record.data ?? [];
  const seasons = seasonsOf(record);
  const shownRecord = filterRecord(record, seasonFilter);
  const shownMatches = filterMatches(page.recent_matches.data ?? [], seasonFilter);
  const age = ageOn(p.date_of_birth, new Date());
  const base = `/${locale}/player/${p.id}`;
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1" data-testid="player-header">
        <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
          {p.known_as ?? p.full_name}
        </h1>
        {p.known_as !== null && <p className="text-sm opacity-70">{p.full_name}</p>}
        <dl className="flex flex-wrap gap-x-4 text-sm opacity-80" data-testid="identity">
          {p.nationality !== null && (
            <div>
              <dt className="sr-only">Nationality</dt>
              <dd>{p.nationality.name}</dd>
            </div>
          )}
          <div>
            <dt className="sr-only">Age</dt>
            <dd>
              {p.date_of_birth === null
                ? 'Date of birth not recorded'
                : `${age} · born ${p.date_of_birth}`}
            </dd>
          </div>
          {p.height_cm !== null && (
            <div>
              <dt className="sr-only">Height</dt>
              <dd>{p.height_cm} cm</dd>
            </div>
          )}
          {p.preferred_foot !== null && (
            <div>
              <dt className="sr-only">Preferred foot</dt>
              <dd>{FOOT_LABEL[p.preferred_foot]}</dd>
            </div>
          )}
        </dl>
      </header>

      <section className="flex flex-col gap-2" data-testid="current-team">
        <h2 className="text-lg font-semibold">Current team</h2>
        {page.current_spell === null ? (
          <p className="text-sm opacity-70">No current team on record.</p>
        ) : (
          <p className="text-sm">
            <Link href={`/${locale}/team/${page.current_spell.team.id}`} className="underline">
              {page.current_spell.team.name}
            </Link>
            {page.current_spell.shirt_number !== null
              ? ` · No. ${page.current_spell.shirt_number}`
              : ''}
            {page.current_spell.position !== null
              ? ` · ${POSITION_LABEL[page.current_spell.position]}`
              : ''}
            {page.current_spell.on_loan ? ' · on loan' : ''}
            {` · since ${page.current_spell.start_date}`}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="career">
        <h2 className="text-lg font-semibold">Career</h2>
        {page.spells.length === 0 ? (
          <p className="text-sm opacity-70">No spells on record.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10 text-sm">
            {page.spells.map((spell) => (
              <li
                key={`${spell.team.id}-${spell.start_date}`}
                className="flex flex-wrap items-baseline gap-x-3 py-1"
              >
                <Link href={`/${locale}/team/${spell.team.id}`} className="underline">
                  {spell.team.name}
                </Link>
                <span className="opacity-70">{spellPeriod(spell)}</span>
                <span className="text-xs opacity-70">
                  {spell.shirt_number !== null ? `No. ${spell.shirt_number}` : ''}
                  {spell.position !== null ? ` · ${POSITION_LABEL[spell.position]}` : ''}
                  {spell.on_loan ? ' · loan' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {seasons.length > 1 && (
        <nav aria-label="Season" className="flex flex-wrap gap-1 text-sm" data-testid="seasons">
          <Link
            href={base}
            aria-current={seasonFilter === null ? 'true' : undefined}
            className={linkClass(seasonFilter === null)}
          >
            All seasons
          </Link>
          {seasons.map((season) => (
            <Link
              key={season.id}
              href={`${base}?season=${season.id}`}
              aria-current={seasonFilter === season.id ? 'true' : undefined}
              className={linkClass(seasonFilter === season.id)}
            >
              {season.label}
            </Link>
          ))}
        </nav>
      )}

      <section className="flex flex-col gap-2" data-testid="record">
        <h2 className="text-lg font-semibold">
          Record
          <span className="ms-2 text-xs font-normal uppercase opacity-60">
            {moduleState(page.record)}
          </span>
        </h2>
        {shownRecord.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="record-empty">
            {page.record.data === null
              ? 'No line-ups on record for this player, so there are no statistics to show.'
              : 'Nothing on record for this season.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-current/20">
                  <th scope="col" className="py-1 pe-2 text-start">
                    Season
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    Competition
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    Team
                  </th>
                  {['Apps', 'Starts', 'Goals', 'Assists', 'Yellow', 'Red'].map((h) => (
                    <th key={h} scope="col" className="py-1 pe-2 text-end">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRecord.map((row) => (
                  <tr
                    key={`${row.season.id}-${row.competition.id}-${row.team.id}`}
                    className="border-b border-current/10"
                    data-testid="record-row"
                  >
                    <td className="py-1 pe-2">{row.season.label}</td>
                    <td className="py-1 pe-2">
                      <Link
                        href={`/${locale}/competition/${row.competition.id}?season=${row.season.id}`}
                        className="underline"
                      >
                        {row.competition.short_name ?? row.competition.name}
                      </Link>
                    </td>
                    <td className="py-1 pe-2">
                      <Link href={`/${locale}/team/${row.team.id}`} className="underline">
                        {row.team.name}
                      </Link>
                    </td>
                    {[
                      appearances(row),
                      row.starts,
                      row.goals,
                      row.assists,
                      row.yellow_cards,
                      row.red_cards,
                    ].map((n, i) => (
                      <td key={i} className="py-1 pe-2 text-end tabular-nums">
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs opacity-60">
              Minutes, advanced statistics and availability are not held for this player and are not
              shown.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="recent-matches">
        <h2 className="text-lg font-semibold">
          Recent matches
          <span className="ms-2 text-xs font-normal uppercase opacity-60">
            {moduleState(page.recent_matches)}
          </span>
        </h2>
        {shownMatches.length === 0 ? (
          <p className="text-sm opacity-70">No matches on record.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10 text-sm">
            {shownMatches.map((m) => (
              <li
                key={m.fixture.id}
                className="flex flex-wrap items-baseline gap-x-3 py-2"
                data-testid="player-match"
              >
                <Link href={`/${locale}/match/${m.fixture.id}`} className="font-medium underline">
                  {m.fixture.home.short_name ?? m.fixture.home.name}
                  {m.fixture.score === null
                    ? ' v '
                    : ` ${m.fixture.score.home}–${m.fixture.score.away} `}
                  {m.fixture.away.short_name ?? m.fixture.away.name}
                </Link>
                <span className="opacity-80">{roleLabel(m)}</span>
                {m.goals > 0 && <span>{m.goals === 1 ? '1 goal' : `${m.goals} goals`}</span>}
                {m.assists > 0 && (
                  <span>{m.assists === 1 ? '1 assist' : `${m.assists} assists`}</span>
                )}
                {m.yellow_cards > 0 && <span>Yellow card</span>}
                {m.red_cards > 0 && <span>Red card</span>}
                <span className="text-xs opacity-70">
                  <time dateTime={m.fixture.kickoff_at}>
                    {formatFixtureDate(m.fixture.kickoff_at, timeZone)}
                  </time>
                  {' · '}
                  <Link
                    href={`/${locale}/competition/${m.fixture.competition.id}?season=${m.fixture.season.id}`}
                    className="underline"
                  >
                    {m.fixture.competition.short_name ?? m.fixture.competition.name}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs opacity-60">
        {page.last_updated_at === null ? (
          'No match data stored for this player yet.'
        ) : (
          <>
            Last data update <time dateTime={page.last_updated_at}>{page.last_updated_at}</time>
          </>
        )}
      </p>
    </main>
  );
}
