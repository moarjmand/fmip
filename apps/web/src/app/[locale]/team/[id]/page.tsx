import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TeamFixture } from '@fmip/contracts';
import { fetchMe, fetchTeam } from '@/lib/api';
import { formatFixtureDate } from '@/lib/competition';
import { moduleState } from '@/lib/match';
import { pageMetadata, teamJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { contextLine, fromTeamSide, groupSquad } from '@/lib/team';
import { JsonLd } from '@/components/json-ld';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!UUID.test(id)) return { title: 'Team · FMIP', robots: { index: false, follow: false } };
  const result = await fetchTeam(id);
  if (!result.ok) return pageMetadata({ locale, path: `/team/${id}`, title: 'Team · FMIP' });
  const t = result.data.team;
  return pageMetadata({
    locale,
    path: `/team/${t.id}`,
    title: `${t.name} · FMIP`,
    description: `${t.name}: fixtures, results, squad and where they stand.`,
  });
}

/**
 * The team page (blueprint 5.2, T-036): overview with ground and followers,
 * the current competitions with the table context, next and previous match,
 * fixtures and results, the squad by position. Player names become links
 * with the player page (T-037).
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!UUID.test(id)) notFound();
  const [result, me] = await Promise.all([fetchTeam(id), fetchMe(await sessionCookieHeader())]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p role="alert" data-testid="team-unreachable">
          The service is unreachable right now, so this team cannot be shown.
        </p>
      </main>
    );
  }
  const page = result.data;
  const t = page.team;
  const timeZone = me?.timezone ?? 'UTC';
  const teamHref = (teamId: string) => `/${locale}/team/${teamId}`;
  const competitionHref = (competitionId: string, seasonId: string) =>
    `/${locale}/competition/${competitionId}?season=${seasonId}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <JsonLd data={teamJsonLd(locale, t)} />
      <header className="flex flex-col gap-1" data-testid="team-header">
        <p className="text-sm opacity-70">
          {t.country !== null ? `${t.country.name} · ` : ''}
          {t.kind === 'national' ? 'National team' : 'Club'}
          {t.gender === 'women' ? ' · Women' : ''}
          {t.founded_year !== null ? ` · Founded ${t.founded_year}` : ''}
        </p>
        <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
          {t.name}
        </h1>
        <p className="text-sm opacity-70">
          {t.venue !== null
            ? `${t.venue.name}${t.venue.city !== null ? `, ${t.venue.city}` : ''}${
                t.venue.capacity !== null ? ` · ${t.venue.capacity.toLocaleString('en-GB')}` : ''
              }`
            : 'Home ground not recorded'}
          {' · '}
          <span data-testid="followers">
            {page.followers} {page.followers === 1 ? 'follower' : 'followers'}
          </span>
        </p>
      </header>

      <section className="flex flex-col gap-3" data-testid="competitions">
        <h2 className="text-lg font-semibold">Competitions</h2>
        {page.competitions.length === 0 ? (
          <p className="text-sm opacity-70">No current competition on record.</p>
        ) : (
          page.competitions.map((entry) => (
            <div key={entry.season.id} className="flex flex-col gap-1" data-testid="competition">
              <h3 className="font-medium">
                <Link
                  href={competitionHref(entry.competition.id, entry.season.id)}
                  className="underline"
                >
                  {entry.competition.name}
                </Link>{' '}
                <span className="text-sm opacity-70">{entry.season.label}</span>
                <span className="ms-2 text-xs font-normal uppercase opacity-60">
                  {moduleState(entry.context)}
                </span>
              </h3>
              {entry.context.data === null ? (
                <p className="text-sm opacity-70">No table position to show.</p>
              ) : (
                <>
                  <p className="text-sm" data-testid="context-line">
                    {contextLine(entry.context.data)}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {entry.context.data.rows.map((row) => (
                          <tr
                            key={row.team.id}
                            className={`border-b border-current/10 ${
                              row.team.id === t.id ? 'font-semibold' : ''
                            }`}
                          >
                            <td className="py-1 pe-2 tabular-nums">{row.position}</td>
                            <td className="py-1 pe-2">
                              {row.team.id === t.id ? (
                                row.team.name
                              ) : (
                                <Link href={teamHref(row.team.id)} className="underline">
                                  {row.team.name}
                                </Link>
                              )}
                            </td>
                            <td className="py-1 pe-2 text-end tabular-nums">{row.played}</td>
                            <td className="py-1 pe-2 text-end tabular-nums">
                              {row.goal_difference > 0 ? '+' : ''}
                              {row.goal_difference}
                            </td>
                            <td className="py-1 text-end tabular-nums">{row.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2" data-testid="next-previous">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Next match</h2>
          {page.next_match === null ? (
            <p className="text-sm opacity-70">No match scheduled.</p>
          ) : (
            <MatchLine
              fixture={page.next_match}
              teamId={t.id}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Previous match</h2>
          {page.previous_match === null ? (
            <p className="text-sm opacity-70">No result on record.</p>
          ) : (
            <MatchLine
              fixture={page.previous_match}
              teamId={t.id}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2" data-testid="fixtures">
        <h2 className="text-lg font-semibold">Fixtures</h2>
        {page.fixtures.length === 0 ? (
          <p className="text-sm opacity-70">No fixtures scheduled.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10">
            {page.fixtures.map((fixture) => (
              <li key={fixture.id} className="py-2">
                <MatchLine fixture={fixture} teamId={t.id} locale={locale} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="results">
        <h2 className="text-lg font-semibold">Results</h2>
        {page.results.length === 0 ? (
          <p className="text-sm opacity-70">No results on record.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10">
            {page.results.map((fixture) => (
              <li key={fixture.id} className="py-2">
                <MatchLine fixture={fixture} teamId={t.id} locale={locale} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="squad">
        <h2 className="text-lg font-semibold">
          Squad
          <span className="ms-2 text-xs font-normal uppercase opacity-60">
            {moduleState(page.squad)}
          </span>
        </h2>
        {page.squad.data === null ? (
          <p className="text-sm opacity-70" data-testid="squad-empty">
            No squad on record for this team.
          </p>
        ) : (
          groupSquad(page.squad.data).map((group) => (
            <div key={group.position} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium opacity-80">{group.label}</h3>
              <ul className="flex flex-col text-sm">
                {group.players.map((player) => (
                  <li key={player.person.id} className="flex gap-3" data-testid="player">
                    <span className="w-8 text-end tabular-nums opacity-60">
                      {player.shirt_number ?? '–'}
                    </span>
                    <span>
                      <Link href={`/${locale}/player/${player.person.id}`} className="underline">
                        {player.person.name}
                      </Link>
                      {player.on_loan && <span className="ms-2 text-xs opacity-70">on loan</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <p className="text-xs opacity-60">
        {page.last_updated_at === null ? (
          'No fixture data stored yet.'
        ) : (
          <>
            Last data update <time dateTime={page.last_updated_at}>{page.last_updated_at}</time>
          </>
        )}
      </p>
    </main>
  );
}

function MatchLine({
  fixture,
  teamId,
  locale,
  timeZone,
}: {
  fixture: TeamFixture;
  teamId: string;
  locale: string;
  timeZone: string;
}) {
  const side = fromTeamSide(fixture, teamId);
  const opponentId = fixture.home.id === teamId ? fixture.away.id : fixture.home.id;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 text-sm" data-testid="match-line">
      {side.result !== null && (
        <span className="w-4 font-mono text-xs font-semibold" data-testid="result-letter">
          {side.result}
        </span>
      )}
      <span className="opacity-70">{side.home ? 'v' : 'at'}</span>
      <Link href={`/${locale}/team/${opponentId}`} className="underline">
        {side.opponent}
      </Link>
      <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
        {fixture.score === null ? 'Match centre' : `${fixture.score.home}–${fixture.score.away}`}
      </Link>
      <span className="text-xs opacity-70">
        <time dateTime={fixture.kickoff_at}>{formatFixtureDate(fixture.kickoff_at, timeZone)}</time>
        {' · '}
        <Link
          href={`/${locale}/competition/${fixture.competition.id}?season=${fixture.season.id}`}
          className="underline"
        >
          {fixture.competition.short_name ?? fixture.competition.name}
        </Link>
      </span>
    </div>
  );
}
