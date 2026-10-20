import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlayerMatch, PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { Coverage, Panel, When, zoneWords } from '@/components/competition-page';
import { EntityBand, LinkTabs, MissingTile, StatTile, TileGrid } from '@/components/entity-band';
import { EntityImage } from '@/components/entity-image';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { Button, controlClasses, inlineTargetClasses } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatNumber, localDigits } from '@/i18n/format';
import { formatFixed } from '@/lib/words';
import { type MessageKey, attribute } from '@/i18n/messages';
import { pageLocale, say } from '@/lib/competition';
import {
  FOOT_KEY,
  POSITION_KEY,
  type PlayerTab,
  PLAYER_TABS,
  ageOn,
  appearances,
  dayText,
  latestSeason,
  lineupTeam,
  minutesText,
  playerTabHref,
  roleLabel,
  spellPeriod,
  spellsCoverage,
} from '@/lib/player';
import { afterTimeNote } from '@/lib/team';

/**
 * The player page in the Hybrid design, data mode (T-1386, D-204): the band,
 * the tabs and the modules. Every module carries a `CoverageBadge` (rule 3);
 * a statistic we do not hold is named as missing, never shown as zero. The
 * page (`app/[locale]/player/[id]/page.tsx`) fetches and composes.
 */

const TAB_KEY: Record<PlayerTab, MessageKey> = {
  overview: 'competitionPage.tab.overview',
  matches: 'playerPage.tab.matches',
  career: 'playerPage.career',
  stats: 'competitionPage.tab.stats',
};

/** The name the reader is shown: localised, else the name they are known by, else the full one. */
export function playerName(person: PlayerPage['person']): string {
  return person.localised_name ?? person.known_as ?? person.full_name;
}

/**
 * The player's band (T-1386): the photo, "Goalkeeper · No. 1" from the open
 * spell, the name in the condensed display face, the canonical and full
 * names, the identity line (club, nationality, age or a "not supplied"
 * badge for a birth date we do not hold, height, foot), follow, compare
 * and the tabs. The band is the brand's: our data holds no club colour.
 */
export function PlayerBand({
  page,
  locale,
  tab,
  seasonId,
  follow,
}: {
  page: PlayerPage;
  locale: string;
  tab: PlayerTab;
  seasonId: string | null;
  follow: ReactNode;
}) {
  const p = page.person;
  const spell = page.current_spell;
  const name = playerName(p);
  const eyebrow = [
    ...(spell?.position != null ? [say(locale, POSITION_KEY[spell.position])] : []),
    ...(spell?.shirt_number != null
      ? [say(locale, 'playerPage.shirt', { number: formatNumber(locale, spell.shirt_number) })]
      : []),
  ];
  return (
    <EntityBand
      testId="player-header"
      colour={spell?.team.colour}
      media={
        <EntityImage
          media={p.photo}
          kind="photo"
          name={name}
          size={96}
          aboveFold
          className="ring-4 ring-surface-raised"
        />
      }
      eyebrow={eyebrow.length > 0 ? eyebrow.join(' · ') : say(locale, 'playerPage.title')}
      title={name}
      details={
        <>
          {p.localised_name !== null && (
            <p className="text-sm text-muted" data-testid="canonical-name">
              {p.known_as ?? p.full_name}
            </p>
          )}
          {p.known_as !== null && <p className="text-sm text-muted">{p.full_name}</p>}
          <Identity page={page} locale={locale} />
        </>
      }
      actions={
        <>
          {follow}
          <CompareForm locale={locale} personId={p.id} />
        </>
      }
      tabs={
        <LinkTabs
          label={say(locale, 'competitionPage.sections')}
          testId="player-tab"
          tabs={PLAYER_TABS.map((key) => ({
            key,
            href: playerTabHref(locale, p.id, key, seasonId),
            label: say(locale, TAB_KEY[key]),
            current: key === tab,
          }))}
        />
      }
    />
  );
}

/** The identity line: the current club first, then what we hold of the person. */
function Identity({ page, locale }: { page: PlayerPage; locale: string }) {
  const p = page.person;
  const spell = page.current_spell;
  const lineup = lineupTeam(page);
  const age = ageOn(p.date_of_birth, new Date());
  return (
    <dl
      className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
      data-testid="identity"
    >
      <div data-testid="current-team">
        <dt className="sr-only">
          <Translated locale={locale} message="playerPage.currentTeam" />
        </dt>
        <dd>
          {spell === null ? (
            lineup !== null ? (
              // No open spell, but a line-up names him (T-1394, D-209): the
              // team of that line-up, said to be a line-up, not a contract.
              <span data-testid="current-team-lineup">
                <Link
                  href={`/${locale}/team/${lineup.team.id}`}
                  className={inlineTargetClasses('font-bold text-fg hover:underline')}
                >
                  {lineup.team.name}
                </Link>
                {` · ${say(locale, 'playerPage.lastLineup', { date: dayText(locale, lineup.day) })}`}
              </span>
            ) : (
              <Translated locale={locale} message="playerPage.noCurrentTeam" />
            )
          ) : (
            <>
              <Link
                href={`/${locale}/team/${spell.team.id}`}
                className={inlineTargetClasses('font-bold text-fg hover:underline')}
              >
                {spell.team.name}
              </Link>
              {spell.on_loan ? ` · ${say(locale, 'teamPage.onLoan')}` : ''}
              {` · ${say(locale, 'playerPage.since', { date: dayText(locale, spell.start_date) })}`}
            </>
          )}
        </dd>
      </div>
      {p.nationality !== null && (
        <div>
          <dt className="sr-only">
            <Translated locale={locale} message="playerPage.nationality" />
          </dt>
          <dd>{p.nationality.name}</dd>
        </div>
      )}
      <div className="flex items-center gap-2" data-testid="birth">
        {p.date_of_birth === null || age === null ? (
          <>
            <dt>
              <Translated locale={locale} message="playerPage.dateOfBirth" />
            </dt>
            <dd>
              <Coverage locale={locale} state="not_supplied" />
            </dd>
          </>
        ) : (
          <>
            <dt className="sr-only">
              <Translated locale={locale} message="playerPage.age" />
            </dt>
            <dd>
              {say(locale, 'playerPage.ageBorn', {
                age: formatNumber(locale, age),
                date: dayText(locale, p.date_of_birth),
              })}
            </dd>
          </>
        )}
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
  );
}

/** "Compare with…": the compare page's search, as a plain GET form (T-631). */
function CompareForm({ locale, personId }: { locale: string; personId: string }) {
  const placeholder = attribute(pageLocale(locale), 'playerPage.comparePlaceholder');
  return (
    <form
      action={`/${locale}/player/${personId}/compare`}
      method="get"
      role="search"
      className="flex max-w-80 flex-wrap items-center gap-2 text-sm"
      data-testid="compare-with"
    >
      <label htmlFor="compare-with-term" className="w-full text-xs font-bold text-muted">
        <Translated locale={locale} message="playerPage.compareWith" />
      </label>
      <input
        id="compare-with-term"
        name="q"
        type="search"
        placeholder={placeholder.text}
        lang={placeholder.lang}
        autoComplete="off"
        className={controlClasses('md', 'min-w-0 flex-1')}
      />
      <Button type="submit" variant="secondary" size="md">
        <Translated locale={locale} message="playerPage.find" />
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The season in tiles
// ---------------------------------------------------------------------------

/** "Pro League · 2026/27", the season in the reader's digits. */
function competitionSeason(locale: string, row: PlayerSeasonRecord): string {
  return `${row.competition.short_name ?? row.competition.name} · ${localDigits(
    locale,
    row.season.label,
  )}`;
}

/**
 * The newest season in tiles (T-1386): appearances, starts, goals, assists,
 * cards and minutes for one competition, as our line-ups and incidents count
 * them. Minutes the feed never sent are a dashed tile with its badge, never a
 * zero; "at least" with the matches it covers where only some came. Other
 * competitions that season are named with a link to all of them.
 */
export function SeasonTilesPanel({ page, locale }: { page: PlayerPage; locale: string }) {
  const latest = latestSeason(page.record.data ?? []);
  const n = (value: number) => formatNumber(locale, value);
  return (
    <Panel
      testId="player-season"
      title={
        latest === null ? (
          <Translated locale={locale} message="playerPage.record" />
        ) : (
          competitionSeason(locale, latest.row)
        )
      }
      aside={<Coverage locale={locale} state={page.record.coverage} />}
    >
      {latest === null ? (
        <p className="text-sm text-muted" data-testid="player-season-empty">
          <Translated locale={locale} message="playerPage.noRecord" />
        </p>
      ) : (
        <>
          <TileGrid>
            <StatTile
              testId="tile-apps"
              value={n(appearances(latest.row))}
              label={say(locale, 'playerPage.tile.apps')}
            />
            <StatTile
              testId="tile-starts"
              value={n(latest.row.starts)}
              label={say(locale, 'playerPage.col.starts')}
            />
            <StatTile
              testId="tile-goals"
              value={n(latest.row.goals)}
              label={say(locale, 'playerPage.col.goals')}
            />
            <StatTile
              testId="tile-assists"
              value={n(latest.row.assists)}
              label={say(locale, 'playerPage.col.assists')}
            />
            <StatTile
              testId="tile-cards"
              value={
                <bdi>
                  {n(latest.row.yellow_cards)}
                  <span className="mx-1 text-caption">/</span>
                  {n(latest.row.red_cards)}
                </bdi>
              }
              label={say(locale, 'playerPage.tile.cards')}
            />
            <MinutesTile row={latest.row} locale={locale} />
          </TileGrid>
          {latest.others.length > 0 && (
            <p className="text-sm text-muted" data-testid="player-season-others">
              {say(locale, 'playerPage.alsoThisSeason', {
                list: latest.others
                  .map((r) => r.competition.short_name ?? r.competition.name)
                  .join(say(locale, 'competitionPage.list.separator')),
              })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function MinutesTile({ row, locale }: { row: PlayerSeasonRecord; locale: string }) {
  const label = say(locale, 'playerPage.tile.minutes');
  if (row.minutes.coverage === 'not_supplied') {
    return (
      <MissingTile
        testId="tile-minutes"
        badge={<Coverage locale={locale} state="not_supplied" />}
        label={label}
      />
    );
  }
  const { text, note } = minutesText(locale, row.minutes);
  return <StatTile testId="tile-minutes" value={text} label={label} note={note} />;
}

// ---------------------------------------------------------------------------
// The record by season
// ---------------------------------------------------------------------------

const SHORT_COLUMNS: readonly MessageKey[] = [
  'playerPage.col.apps',
  'playerPage.col.starts',
  'playerPage.col.goals',
  'playerPage.col.assists',
  'playerPage.col.yellow',
];

const FULL_COLUMNS: readonly MessageKey[] = [
  'playerPage.col.apps',
  'playerPage.col.starts',
  'playerPage.col.minutes',
  'playerPage.col.goals',
  'playerPage.col.assists',
  'playerPage.col.yellow',
  'playerPage.col.red',
];

/**
 * The record per season, competition and team (T-037). `full` is the Stats
 * tab's: minutes (T-823) and red cards too, under the season filter; the
 * Overview and the Career tab show every season with the main columns.
 */
export function RecordPanel({
  page,
  rows,
  locale,
  full,
  testId,
  footer,
}: {
  page: PlayerPage;
  rows: PlayerSeasonRecord[];
  locale: string;
  full: boolean;
  testId: string;
  footer?: ReactNode;
}) {
  const columns = full ? FULL_COLUMNS : SHORT_COLUMNS;
  return (
    <Panel
      testId={testId}
      title={
        <Translated locale={locale} message={full ? 'playerPage.record' : 'playerPage.career'} />
      }
      aside={<Coverage locale={locale} state={page.record.coverage} />}
    >
      {rows.length === 0 ? (
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
          <table className="w-full min-w-[36rem] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-strong text-xs text-muted">
                <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                  <Translated locale={locale} message="competitionPage.season" />
                </th>
                <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                  <Translated locale={locale} message="competitionPage.title" />
                </th>
                <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                  <Translated locale={locale} message="competitionPage.col.team" />
                </th>
                {columns.map((h) => (
                  <th key={h} scope="col" className="py-1.5 ps-2 text-end font-bold">
                    <Translated locale={locale} message={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.season.id}-${row.competition.id}-${row.team.id}`}
                  className="border-b border-default last:border-b-0"
                  data-testid="record-row"
                >
                  <td className="py-2 pe-2 font-semibold">
                    <bdi>{localDigits(locale, row.season.label)}</bdi>
                  </td>
                  <td className="py-2 pe-2 text-muted">
                    <Link
                      href={`/${locale}/competition/${row.competition.id}?season=${row.season.id}`}
                      className={inlineTargetClasses('hover:underline')}
                    >
                      {row.competition.short_name ?? row.competition.name}
                    </Link>
                  </td>
                  <td className="py-2 pe-2">
                    <Link
                      href={`/${locale}/team/${row.team.id}`}
                      className={inlineTargetClasses('hover:underline')}
                    >
                      {row.team.name}
                    </Link>
                  </td>
                  <Figure locale={locale} value={appearances(row)} />
                  <Figure locale={locale} value={row.starts} />
                  {full && <MinutesCell locale={locale} row={row} />}
                  <Figure locale={locale} value={row.goals} />
                  <Figure locale={locale} value={row.assists} />
                  <Figure locale={locale} value={row.yellow_cards} />
                  {full && <Figure locale={locale} value={row.red_cards} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {full && rows.length > 0 && (
        <p className="text-xs text-muted">
          <Translated locale={locale} message="playerPage.minutesNote" />
        </p>
      )}
      {footer}
    </Panel>
  );
}

function Figure({ locale, value }: { locale: string; value: number }) {
  return <td className="py-2 ps-2 text-end">{formatNumber(locale, value)}</td>;
}

/** A season's minutes (T-823): whole, "at least" with the matches it covers, or not supplied. */
function MinutesCell({ locale, row }: { locale: string; row: PlayerSeasonRecord }) {
  const { text, note } = minutesText(locale, row.minutes);
  return (
    <td
      className={cx(
        'py-2 ps-2 text-end',
        row.minutes.coverage === 'not_supplied' && 'text-xs text-muted italic',
      )}
      data-coverage={row.minutes.coverage}
      data-testid="record-minutes"
    >
      {text}
      {note !== null && <span className="block text-xs text-muted">{note}</span>}
    </td>
  );
}

/** The seasons the record covers as pills, keeping the open tab (Matches or Stats). */
export function SeasonFilter({
  page,
  locale,
  tab,
  seasons,
  seasonId,
}: {
  page: PlayerPage;
  locale: string;
  tab: 'matches' | 'stats';
  seasons: { id: string; label: string }[];
  seasonId: string | null;
}) {
  if (seasons.length < 2) return null;
  const pill = (current: boolean) =>
    cx(
      'inline-flex min-h-8 items-center rounded-pill px-3 tabular-nums',
      current ? 'bg-fg font-bold text-canvas' : 'border border-default text-muted hover:text-fg',
    );
  return (
    <nav
      aria-label={say(locale, 'competitionPage.season')}
      className="flex flex-wrap items-center gap-1 text-sm"
      data-testid="seasons"
    >
      <span className="me-1 text-xs font-bold text-muted">
        <Translated locale={locale} message="competitionPage.season" />
      </span>
      <Link
        href={playerTabHref(locale, page.person.id, tab)}
        aria-current={seasonId === null ? 'true' : undefined}
        className={pill(seasonId === null)}
      >
        <Translated locale={locale} message="playerPage.allSeasons" />
      </Link>
      {seasons.map((season) => (
        <Link
          key={season.id}
          href={playerTabHref(locale, page.person.id, tab, season.id)}
          aria-current={seasonId === season.id ? 'true' : undefined}
          className={pill(seasonId === season.id)}
        >
          {localDigits(locale, season.label)}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

/** "Started · 1 goal · yellow card": his line in the match, from our line-ups and incidents. */
function MatchLine({ match, locale }: { match: PlayerMatch; locale: string }) {
  return (
    <span className="flex flex-wrap justify-end gap-x-1.5 text-end text-xs text-muted">
      <span>{roleLabel(locale, match)}</span>
      {match.goals > 0 && (
        <span>
          · <Translated locale={locale} message="playerPage.goals" count={match.goals} />
        </span>
      )}
      {match.assists > 0 && (
        <span>
          · <Translated locale={locale} message="playerPage.assists" count={match.assists} />
        </span>
      )}
      {match.yellow_cards > 0 && (
        <span>
          · <Translated locale={locale} message="playerPage.yellowCard" />
        </span>
      )}
      {match.red_cards > 0 && (
        <span className="text-danger">
          · <Translated locale={locale} message="playerPage.redCard" />
        </span>
      )}
      <ExpectedGoalsLine match={match} locale={locale} />
    </span>
  );
}

/**
 * "xG (Highlightly) 0.38 · xA 0.12": the match's expected goals from their own
 * source, labelled with it (T-1432, D-224), and only what it supplied -- `–`
 * for an xG it did not, nothing at all when it has no figure for the match.
 */
function ExpectedGoalsLine({ match, locale }: { match: PlayerMatch; locale: string }) {
  const expected = match.expected_goals;
  if (expected === null) return null;
  const figure = (value: number | undefined) =>
    value === undefined ? '–' : formatFixed(locale, value, 2);
  const { xg, xa, xgot } = expected.figures;
  return (
    <span data-testid="player-match-xg" className="tabular-nums">
      · <Translated locale={locale} message="playerPage.expectedGoals" /> {figure(xg)}
      {xa !== undefined && (
        <>
          {' · '}
          <Translated locale={locale} message="matchCentre.expectedGoals.xa" /> {figure(xa)}
        </>
      )}
      {xgot !== undefined && (
        <>
          {' · '}
          <Translated locale={locale} message="matchCentre.expectedGoals.xgot" /> {figure(xgot)}
        </>
      )}
    </span>
  );
}

/**
 * The matches the player was named for, newest first (T-037): when, the two
 * sides with the score between them in the page's direction (the home side
 * and its goals on the right on `/fa`, D-193), the competition and any "aet"
 * or shoot-out from his team's side (T-822), and his line.
 */
export function PlayerMatchesPanel({
  page,
  matches,
  locale,
  timeZone,
  footer,
}: {
  page: PlayerPage;
  matches: PlayerMatch[];
  locale: string;
  timeZone: string;
  footer?: ReactNode;
}) {
  return (
    <Panel
      testId="recent-matches"
      title={<Translated locale={locale} message="playerPage.recentMatches" />}
      aside={<Coverage locale={locale} state={page.recent_matches.coverage} />}
    >
      {matches.length === 0 ? (
        <p className="text-sm text-muted" data-testid="recent-matches-empty">
          <Translated locale={locale} message="playerPage.noMatches" />
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {matches.map((m) => {
              const note = afterTimeNote(locale, m.fixture, m.team.id);
              return (
                <li
                  key={m.fixture.id}
                  className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2.5 border-b border-default py-2.5 last:border-b-0 sm:grid-cols-[5rem_minmax(0,1fr)_auto]"
                  data-testid="player-match"
                >
                  <When fixture={m.fixture} locale={locale} timeZone={timeZone} />
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={`/${locale}/match/${m.fixture.id}`}
                      className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-semibold hover:underline focus-visible:underline"
                    >
                      {/* Names isolated, the score in the page's direction (T-1375). */}
                      <bdi className="min-w-0 truncate">
                        {m.fixture.home.short_name ?? m.fixture.home.name}
                      </bdi>
                      {m.fixture.score === null ? (
                        <span className="shrink-0 font-medium text-caption">
                          {say(locale, 'competitionPage.v')}
                        </span>
                      ) : (
                        <Score
                          home={m.fixture.score.home}
                          away={m.fixture.score.away}
                          locale={locale}
                          separator=" – "
                          className="shrink-0 font-sans text-base font-black font-stretch-condensed tabular-nums"
                          testId="player-match-score"
                        />
                      )}
                      <bdi className="min-w-0 truncate">
                        {m.fixture.away.short_name ?? m.fixture.away.name}
                      </bdi>
                    </Link>
                    <span className="text-xs text-muted">
                      <Link
                        href={`/${locale}/competition/${m.fixture.competition.id}?season=${m.fixture.season.id}`}
                        className={inlineTargetClasses('hover:underline')}
                      >
                        {m.fixture.competition.short_name ?? m.fixture.competition.name}
                      </Link>
                      {note !== null && (
                        <span data-testid="after-time-note">
                          {' · '}
                          {note}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="col-start-2 sm:col-start-auto">
                    <MatchLine match={m} locale={locale} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">{zoneWords(locale, timeZone)}</p>
        </>
      )}
      {footer}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Career spells
// ---------------------------------------------------------------------------

/** The clubs he has played for, newest first, with the dates, shirt, position and loans (T-037). */
export function SpellsPanel({ page, locale }: { page: PlayerPage; locale: string }) {
  return (
    <Panel
      testId="career"
      title={<Translated locale={locale} message="playerPage.clubs" />}
      aside={<Coverage locale={locale} state={spellsCoverage(page.spells)} />}
    >
      {page.spells.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="playerPage.noSpells" />
        </p>
      ) : (
        <ul className="flex flex-col">
          {page.spells.map((spell) => (
            <li
              key={`${spell.team.id}-${spell.start_date}`}
              className="flex flex-wrap items-baseline gap-x-3 border-b border-default py-2 text-sm last:border-b-0"
              data-testid="spell"
            >
              <Link
                href={`/${locale}/team/${spell.team.id}`}
                className={inlineTargetClasses('font-semibold hover:underline')}
              >
                {spell.team.name}
              </Link>
              <span className="text-muted">{spellPeriod(locale, spell)}</span>
              <span className="text-xs text-muted">
                {[
                  ...(spell.shirt_number !== null
                    ? [
                        say(locale, 'playerPage.shirt', {
                          number: formatNumber(locale, spell.shirt_number),
                        }),
                      ]
                    : []),
                  ...(spell.position !== null ? [say(locale, POSITION_KEY[spell.position])] : []),
                  ...(spell.on_loan ? [say(locale, 'playerPage.loan')] : []),
                ].join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
