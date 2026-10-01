import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PlayerSeasonMinutes } from '@fmip/contracts';
import { fetchEntityNews, fetchMe, fetchPlayer } from '@/lib/api';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import { coverageText, formatFixtureDate, pageLocale, say } from '@/lib/competition';
import { afterTimeNote } from '@/lib/team';
import {
  FOOT_KEY,
  POSITION_KEY,
  ageOn,
  appearances,
  dayText,
  minutesText,
  filterMatches,
  filterRecord,
  readSeasonFilter,
  roleLabel,
  seasonsOf,
  spellPeriod,
} from '@/lib/player';
import { type MessageKey, attribute } from '@/i18n/messages';
import { pageMetadata, playerJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { JsonLd } from '@/components/json-ld';
import { PlayerAvailabilitySection } from '@/components/player-availability';
import { EntityNews } from '@/components/related-news';
import { ltrIsolate } from '@/components/score';
import { Button, Notice, controlClasses, inlineTargetClasses } from '@/components/ui';
import { Stamp } from '@/components/stamp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const fallback = `${say(locale, 'playerPage.title')} · FMIP`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const result = await fetchPlayer(id, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/player/${id}`, title: fallback });
  const canonical = result.data.person.known_as ?? result.data.person.full_name;
  const name = result.data.person.localised_name ?? canonical;
  return pageMetadata({
    locale,
    path: `/player/${result.data.person.id}`,
    title: `${name} · FMIP`,
    description: say(locale, 'playerPage.metaDescription', { name: canonical }),
  });
}

/**
 * The player page (blueprint 5.3, T-037): identity, current team, career
 * spells, the record per season and competition that our line-ups and
 * incidents support, and the recent-match log, with a season selector over
 * both. T-1007: current availability for the team's next match and related
 * news. Statistics we do not hold are named as such, never shown as zero.
 * Its words come from the catalogue (T-1304).
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
  const [result, me, news] = await Promise.all([
    fetchPlayer(id, locale),
    fetchMe(await sessionCookieHeader()),
    fetchEntityNews('person', id, locale),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="playerPage.title" />
        </h1>
        <Notice tone="danger" data-testid="player-unreachable">
          <Translated locale={locale} message="playerPage.unreachable" />
        </Notice>
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
    `rounded px-2 py-1 ${active ? 'bg-surface-raised font-semibold' : 'underline'}`;
  const placeholder = attribute(pageLocale(locale), 'playerPage.comparePlaceholder');

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <JsonLd data={playerJsonLd(locale, page)} />
      <header className="flex flex-col gap-1" data-testid="player-header">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          {p.localised_name ?? p.known_as ?? p.full_name}
        </h1>
        {p.localised_name !== null && (
          <p className="text-sm text-muted" data-testid="canonical-name">
            {p.known_as ?? p.full_name}
          </p>
        )}
        {p.known_as !== null && <p className="text-sm text-muted">{p.full_name}</p>}
        <dl className="flex flex-wrap gap-x-4 text-sm text-muted" data-testid="identity">
          {p.nationality !== null && (
            <div>
              <dt className="sr-only">
                <Translated locale={locale} message="playerPage.nationality" />
              </dt>
              <dd>{p.nationality.name}</dd>
            </div>
          )}
          <div>
            <dt className="sr-only">
              <Translated locale={locale} message="playerPage.age" />
            </dt>
            <dd>
              {p.date_of_birth === null || age === null ? (
                <Translated locale={locale} message="playerPage.noBirthDate" />
              ) : (
                say(locale, 'playerPage.ageBorn', {
                  age: formatNumber(locale, age),
                  date: dayText(locale, p.date_of_birth),
                })
              )}
            </dd>
          </div>
          {p.height_cm !== null && (
            <div>
              <dt className="sr-only">
                <Translated locale={locale} message="playerPage.height" />
              </dt>
              <dd>
                {say(locale, 'playerPage.heightCm', { height: formatNumber(locale, p.height_cm) })}
              </dd>
            </div>
          )}
          {p.preferred_foot !== null && (
            <div>
              <dt className="sr-only">
                <Translated locale={locale} message="playerPage.foot" />
              </dt>
              <dd>
                <Translated locale={locale} message={FOOT_KEY[p.preferred_foot]} />
              </dd>
            </div>
          )}
        </dl>
      </header>

      <section className="flex flex-col gap-2" data-testid="current-team">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="playerPage.currentTeam" />
        </h2>
        {page.current_spell === null ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="playerPage.noCurrentTeam" />
          </p>
        ) : (
          <p className="text-sm">
            <Link href={`/${locale}/team/${page.current_spell.team.id}`} className="underline">
              {page.current_spell.team.name}
            </Link>
            {page.current_spell.shirt_number !== null
              ? ` · ${say(locale, 'playerPage.shirt', {
                  number: formatNumber(locale, page.current_spell.shirt_number),
                })}`
              : ''}
            {page.current_spell.position !== null
              ? ` · ${say(locale, POSITION_KEY[page.current_spell.position])}`
              : ''}
            {page.current_spell.on_loan ? ` · ${say(locale, 'teamPage.onLoan')}` : ''}
            {` · ${say(locale, 'playerPage.since', {
              date: dayText(locale, page.current_spell.start_date),
            })}`}
          </p>
        )}
      </section>

      <PlayerAvailabilitySection
        locale={locale}
        timeZone={timeZone}
        availability={page.availability}
        now={new Date()}
      />

      <form
        action={`${base}/compare`}
        method="get"
        role="search"
        className="flex flex-wrap gap-2 text-sm"
        data-testid="compare-with"
      >
        <label htmlFor="compare-with-term" className="w-full font-semibold">
          <Translated locale={locale} message="playerPage.compareWith" />
        </label>
        <input
          id="compare-with-term"
          name="q"
          type="search"
          placeholder={placeholder.text}
          lang={placeholder.lang}
          autoComplete="off"
          className={controlClasses('md', 'min-w-0 grow')}
        />
        <Button type="submit" size="md">
          <Translated locale={locale} message="playerPage.find" />
        </Button>
      </form>

      <section className="flex flex-col gap-2" data-testid="career">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="playerPage.career" />
        </h2>
        {page.spells.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="playerPage.noSpells" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-default text-sm">
            {page.spells.map((spell) => (
              <li
                key={`${spell.team.id}-${spell.start_date}`}
                className="flex flex-wrap items-baseline gap-x-3 py-1"
              >
                <Link href={`/${locale}/team/${spell.team.id}`} className="underline">
                  {spell.team.name}
                </Link>
                <span className="text-muted">{spellPeriod(locale, spell)}</span>
                <span className="text-xs text-muted">
                  {spell.shirt_number !== null
                    ? say(locale, 'playerPage.shirt', {
                        number: formatNumber(locale, spell.shirt_number),
                      })
                    : ''}
                  {spell.position !== null ? ` · ${say(locale, POSITION_KEY[spell.position])}` : ''}
                  {spell.on_loan ? ` · ${say(locale, 'playerPage.loan')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {seasons.length > 1 && (
        <nav
          aria-label={say(locale, 'competitionPage.season')}
          className="flex flex-wrap gap-1 text-sm"
          data-testid="seasons"
        >
          <Link
            href={base}
            aria-current={seasonFilter === null ? 'true' : undefined}
            className={linkClass(seasonFilter === null)}
          >
            <Translated locale={locale} message="playerPage.allSeasons" />
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
          <Translated locale={locale} message="playerPage.record" />
          <span className="ms-2 text-xs font-normal uppercase text-muted">
            {coverageText(locale, page.record.coverage)}
          </span>
        </h2>
        {shownRecord.length === 0 ? (
          <p className="text-sm text-muted" data-testid="record-empty">
            <Translated
              locale={locale}
              message={
                page.record.data === null ? 'playerPage.noRecord' : 'playerPage.noSeasonRecord'
              }
            />
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className="py-1 pe-2 text-start">
                    <Translated locale={locale} message="competitionPage.season" />
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    <Translated locale={locale} message="competitionPage.title" />
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    <Translated locale={locale} message="competitionPage.col.team" />
                  </th>
                  {RECORD_COLUMNS.map((h) => (
                    <th key={h} scope="col" className="py-1 pe-2 text-end">
                      <Translated locale={locale} message={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRecord.map((row) => (
                  <tr
                    key={`${row.season.id}-${row.competition.id}-${row.team.id}`}
                    className="border-b border-default"
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
                    {[appearances(row), row.starts].map((n, i) => (
                      <td key={i} className="py-1 pe-2 text-end tabular-nums">
                        {formatNumber(locale, n)}
                      </td>
                    ))}
                    <MinutesCell locale={locale} minutes={row.minutes} />
                    {[row.goals, row.assists, row.yellow_cards, row.red_cards].map((n, i) => (
                      <td key={i} className="py-1 pe-2 text-end tabular-nums">
                        {formatNumber(locale, n)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-muted">
              <Translated locale={locale} message="playerPage.minutesNote" />
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="recent-matches">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="playerPage.recentMatches" />
          <span className="ms-2 text-xs font-normal uppercase text-muted">
            {coverageText(locale, page.recent_matches.coverage)}
          </span>
        </h2>
        {shownMatches.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="playerPage.noMatches" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-default text-sm">
            {shownMatches.map((m) => (
              <li
                key={m.fixture.id}
                className="flex flex-wrap items-baseline gap-x-3 py-2"
                data-testid="player-match"
              >
                <Link
                  href={`/${locale}/match/${m.fixture.id}`}
                  className={inlineTargetClasses('font-medium underline')}
                >
                  {m.fixture.home.short_name ?? m.fixture.home.name}
                  {m.fixture.score === null
                    ? ` ${say(locale, 'competitionPage.v')} `
                    : ` ${ltrIsolate(`${formatNumber(locale, m.fixture.score.home)}–${formatNumber(locale, m.fixture.score.away)}`)} `}
                  {m.fixture.away.short_name ?? m.fixture.away.name}
                </Link>
                {/* After extra time, and a shoot-out from the player's side (T-822). */}
                {afterTimeNote(locale, m.fixture, m.team.id) !== null && (
                  <span className="text-xs text-muted" data-testid="after-time-note">
                    {afterTimeNote(locale, m.fixture, m.team.id)}
                  </span>
                )}
                <span className="text-muted">{roleLabel(locale, m)}</span>
                {m.goals > 0 && (
                  <span>
                    <Translated locale={locale} message="playerPage.goals" count={m.goals} />
                  </span>
                )}
                {m.assists > 0 && (
                  <span>
                    <Translated locale={locale} message="playerPage.assists" count={m.assists} />
                  </span>
                )}
                {m.yellow_cards > 0 && (
                  <span>
                    <Translated locale={locale} message="playerPage.yellowCard" />
                  </span>
                )}
                {m.red_cards > 0 && (
                  <span>
                    <Translated locale={locale} message="playerPage.redCard" />
                  </span>
                )}
                <span className="text-xs text-muted">
                  <time dateTime={m.fixture.kickoff_at}>
                    {formatFixtureDate(locale, m.fixture.kickoff_at, timeZone)}
                  </time>
                  {' · '}
                  <Link
                    href={`/${locale}/competition/${m.fixture.competition.id}?season=${m.fixture.season.id}`}
                    className={inlineTargetClasses('underline')}
                  >
                    {m.fixture.competition.short_name ?? m.fixture.competition.name}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EntityNews locale={locale} timeZone={timeZone} news={news.ok ? news.data : null} />

      <p className="text-xs text-muted">
        {page.last_updated_at === null ? (
          <Translated locale={locale} message="playerPage.noData" />
        ) : (
          <>
            <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
            <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
          </>
        )}
      </p>
    </main>
  );
}

/** The record table's figure columns, after season, competition and team. */
const RECORD_COLUMNS: readonly MessageKey[] = [
  'playerPage.col.apps',
  'playerPage.col.starts',
  'playerPage.col.minutes',
  'playerPage.col.goals',
  'playerPage.col.assists',
  'playerPage.col.yellow',
  'playerPage.col.red',
];

/** A season's minutes (T-823): whole, "at least" with the matches it covers, or not supplied. */
function MinutesCell({ locale, minutes }: { locale: string; minutes: PlayerSeasonMinutes }) {
  const { text, note } = minutesText(locale, minutes);
  return (
    <td
      className={`py-1 pe-2 text-end ${minutes.coverage === 'not_supplied' ? 'text-xs italic text-muted' : 'tabular-nums'}`}
      data-coverage={minutes.coverage}
      data-testid="record-minutes"
    >
      {text}
      {note !== null && <span className="block text-xs text-muted">{note}</span>}
    </td>
  );
}
