import Link from '@/components/ui/link';
import type { CSSProperties, ReactNode } from 'react';
import type { PlayerMatch, PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { Coverage, Panel, When, zoneWords } from '@/components/competition-page';
import { SectionTabs } from '@/components/ui/section-tabs';
import { EntityImage } from '@/components/entity-image';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { Button, controlClasses, inlineTargetClasses } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber, localDigits } from '@/i18n/format';
import { formatFixed } from '@/lib/words';
import { type MessageKey, attribute, plural } from '@/i18n/messages';
import { pageLocale, say } from '@/lib/competition';
import {
  FOOT_KEY,
  POSITION_KEY,
  type PlayerTab,
  PLAYER_TABS,
  ageOn,
  appearances,
  clubBasisText,
  clubClaim,
  dayText,
  goalsPer90,
  latestSeason,
  lineupTeam,
  minutesText,
  playerTabHref,
  positionValue,
  roleLabel,
  seasonGroups,
  seasonTotals,
  spellPeriod,
  spellsCoverage,
} from '@/lib/player';
import { afterTimeNote } from '@/lib/team';

/**
 * The player page in the Stadiomind Design System (T-1500, D-271): the header
 * with the photo in the club's ring and the facts, the tabs, the season in
 * tiles, the career by season, the last six matches and the next match.
 * Every module carries its coverage (rule 3); a fact or a statistic we do not
 * hold is named as missing, never shown as zero or guessed. The page
 * (`app/[locale]/player/[id]/page.tsx`) fetches and composes.
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

/** A card on the page: the surface, a hairline and the large radius, no shadow. */
const CARD = 'rounded-card border border-default bg-surface';

/** A card's heading, set in the wide face. */
const CARD_TITLE = 'text-base font-extrabold font-stretch-semi-expanded md:text-lg';

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/**
 * The player's header (T-1500): the photo in a ring of the current club's
 * colour (the only place the club's colour appears on this page, D-263; a
 * club with no colour on record gets the theme's strong line), "Forward ·
 * No. 9" from the open spell, the name in the wide display face, the club
 * line, the facts with their coverage, follow and compare, then the tabs.
 * On a phone it is centred and the facts sit in three boxes under the name.
 */
export function PlayerHeader({
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
  // The position by T-1603's rule (spell, squad list, else his line-ups):
  // production holds no open spell, so the spell alone named none.
  const position = positionValue(page);
  const eyebrow = [
    ...(position !== null ? [say(locale, POSITION_KEY[position])] : []),
    ...(spell?.shirt_number != null
      ? [say(locale, 'playerPage.shirt', { number: formatNumber(locale, spell.shirt_number) })]
      : []),
  ];
  const colour = clubClaim(page)?.team.colour ?? null;
  const ring: CSSProperties | undefined = colour === null ? undefined : { borderColor: colour };
  return (
    <div className="border-b border-default bg-surface" data-testid="player-header">
      <div className="page-frame">
        <div className="flex flex-col items-center gap-x-7 gap-y-4 pt-5 pb-4 text-center md:flex-row md:flex-wrap md:pt-8 md:pb-6 md:text-start">
          <span
            className={cx(
              'inline-flex shrink-0 rounded-full border-[3px]',
              colour === null && 'border-strong',
            )}
            style={ring}
            data-testid="photo-ring"
            data-ring={colour === null ? 'none' : 'club'}
          >
            <EntityImage media={p.photo} kind="photo" name={name} size={96} aboveFold />
          </span>
          {/* The basis is for the desktop row only: in the phone's column it is a height (T-1567). */}
          <div className="flex min-w-0 flex-col items-center gap-2 md:flex-[1_1_18rem] md:items-start">
            {eyebrow.length > 0 && (
              <p
                className="text-xs font-bold text-muted uppercase ltr:tracking-wider"
                data-testid="band-eyebrow"
              >
                {eyebrow.join(' · ')}
              </p>
            )}
            <h1
              className="font-sans text-display-1 leading-none font-extrabold font-stretch-semi-expanded break-words md:text-display-3"
              data-testid="title"
            >
              {name}
            </h1>
            {p.localised_name !== null && (
              <p className="text-sm text-muted" data-testid="canonical-name">
                {p.known_as ?? p.full_name}
              </p>
            )}
            {p.known_as !== null && <p className="text-sm text-muted">{p.full_name}</p>}
            <ClubLine page={page} locale={locale} />
          </div>
          <Facts page={page} locale={locale} />
        </div>
        <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3 pb-4 md:justify-start">
          {follow}
          <CompareForm locale={locale} personId={p.id} />
        </div>
      </div>
      <div className="page-frame">
        <SectionTabs
          label={say(locale, 'competitionPage.sections')}
          testId="player-tab"
          tabs={PLAYER_TABS.map((key) => ({
            key,
            href: playerTabHref(locale, p.id, key, seasonId),
            label: say(locale, TAB_KEY[key]),
            current: key === tab,
          }))}
        />
      </div>
    </div>
  );
}

/**
 * The club line (T-1629, D-295): the club and what says so -- an open spell,
 * the latest club line-up, a squad list or a recorded move, never a national
 * team -- then the national team of his latest line-up for one, else the
 * nationality. From an API older than T-1629, the latest line-up's team, said
 * to be a line-up (T-1394).
 */
function ClubLine({ page, locale }: { page: PlayerPage; locale: string }) {
  const p = page.person;
  const club = clubClaim(page);
  const lineup = page.club === undefined && club === null ? lineupTeam(page) : null;
  const national = page.national_team ?? null;
  const teamLink = inlineTargetClasses('gap-1.5 align-middle font-bold text-fg hover:underline');
  return (
    <dl
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted md:justify-start"
      data-testid="identity"
    >
      <div data-testid="current-team">
        <dt className="sr-only">
          <Translated locale={locale} message="playerPage.currentTeam" />
        </dt>
        <dd>
          {club !== null ? (
            <span data-testid="current-club" data-basis={club.basis}>
              <Link href={`/${locale}/team/${club.team.id}`} className={teamLink}>
                {/* The club's crest beside its name (T-1617). */}
                <EntityImage media={club.team.crest} kind="crest" name={club.team.name} size={20} />
                {club.team.name}
              </Link>
              {club.on_loan ? ` · ${say(locale, 'teamPage.onLoan')}` : ''}
              {` · ${clubBasisText(locale, club)}`}
            </span>
          ) : lineup !== null ? (
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
          )}
        </dd>
      </div>
      {national !== null ? (
        <div data-testid="national-team">
          <dt className="sr-only">
            <Translated locale={locale} message="playerPage.nationalTeam" />
          </dt>
          <dd>
            <Link href={`/${locale}/team/${national.team.id}`} className={teamLink}>
              <EntityImage
                media={national.team.crest}
                kind="crest"
                name={national.team.name}
                size={20}
              />
              {national.team.name}
            </Link>
          </dd>
        </div>
      ) : (
        p.nationality !== null && (
          <div>
            <dt className="sr-only">
              <Translated locale={locale} message="playerPage.nationality" />
            </dt>
            <dd>{p.nationality.name}</dd>
          </div>
        )
      )}
    </dl>
  );
}

/**
 * Age, height and foot (T-1500): each one the figure we hold or its
 * "not supplied" badge, never a guess. The age is counted from the stored
 * birth date, which is written under it.
 */
function Facts({ page, locale }: { page: PlayerPage; locale: string }) {
  const p = page.person;
  const age = ageOn(p.date_of_birth, new Date());
  return (
    <dl
      className="grid w-full grid-cols-3 gap-2 md:ms-auto md:w-auto md:gap-x-8"
      data-testid="facts"
    >
      <Fact
        testId="fact-age"
        label="playerPage.age"
        locale={locale}
        value={age === null ? null : formatNumber(locale, age)}
        note={
          p.date_of_birth === null || age === null
            ? undefined
            : say(locale, 'playerPage.born', { date: dayText(locale, p.date_of_birth) })
        }
      />
      <Fact
        testId="fact-height"
        label="playerPage.height"
        locale={locale}
        value={
          p.height_cm === null
            ? null
            : say(locale, 'playerPage.heightCm', { height: formatNumber(locale, p.height_cm) })
        }
      />
      <Fact
        testId="fact-foot"
        label="playerPage.foot"
        locale={locale}
        value={p.preferred_foot === null ? null : say(locale, FOOT_KEY[p.preferred_foot])}
      />
    </dl>
  );
}

function Fact({
  testId,
  label,
  locale,
  value,
  note,
}: {
  testId: string;
  label: MessageKey;
  locale: string;
  /** The figure in the reader's words, or null when we do not hold it. */
  value: string | null;
  note?: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col-reverse items-center justify-end gap-1 rounded-tile bg-surface-raised px-1 py-2.5 md:flex-col md:items-start md:bg-transparent md:p-0"
      data-testid={testId}
      data-coverage={value === null ? 'not_supplied' : 'available'}
    >
      <dt className="text-xs text-caption">
        <Translated locale={locale} message={label} />
      </dt>
      <dd className="flex flex-col items-center md:items-start">
        {value === null ? (
          <Coverage locale={locale} state="not_supplied" />
        ) : (
          <>
            <span className="text-xl leading-tight font-extrabold font-stretch-condensed tabular-nums md:text-2xl">
              {value}
            </span>
            {note !== undefined && <span className="text-xs text-muted">{note}</span>}
          </>
        )}
      </dd>
    </div>
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
      className="flex w-full max-w-80 flex-wrap items-center gap-2 text-sm"
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

/**
 * The newest season in tiles (T-1500): one per competition (and team, where
 * the season has more than one, a national side say), the goals large over
 * the appearances, the minutes and goals per 90; with more than one row, a
 * first tile for the whole season. Minutes the feed never sent are said to
 * be missing, "at least" where only some came, and the rate per 90 is shown
 * only over minutes that are whole (`goalsPer90`).
 */
export function SeasonTilesPanel({ page, locale }: { page: PlayerPage; locale: string }) {
  const latest = latestSeason(page.record.data ?? []);
  const rows = latest === null ? [] : [latest.row, ...latest.others];
  const teams = new Set(rows.map((row) => row.team.id));
  return (
    <section
      aria-labelledby="player-season-heading"
      className="flex min-w-0 flex-col gap-3"
      data-testid="player-season"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="player-season-heading" className={CARD_TITLE}>
          {latest === null ? (
            <Translated locale={locale} message="playerPage.record" />
          ) : (
            say(locale, 'playerPage.seasonHeading', {
              season: localDigits(locale, latest.row.season.label),
            })
          )}
        </h2>
        <Coverage locale={locale} state={page.record.coverage} />
      </div>
      {latest === null ? (
        <p className={cx(CARD, 'p-4 text-sm text-muted')} data-testid="player-season-empty">
          <Translated locale={locale} message="playerPage.noRecord" />
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] md:gap-4">
          {rows.length > 1 && (
            <SeasonTile
              testId="tile-season"
              locale={locale}
              label={say(locale, 'playerPage.tile.allCompetitions')}
              goals={seasonTotals(rows).goals}
              parts={[
                plural(
                  pageLocale(locale),
                  'competition.leaders.appearances',
                  seasonTotals(rows).appearances,
                ).text,
              ]}
            />
          )}
          {rows.map((row) => (
            <SeasonTile
              key={`${row.competition.id}-${row.team.id}`}
              testId="tile-competition"
              locale={locale}
              label={
                teams.size > 1 ? `${competitionName(row)} · ${row.team.name}` : competitionName(row)
              }
              goals={row.goals}
              parts={[
                plural(pageLocale(locale), 'competition.leaders.appearances', appearances(row))
                  .text,
                minutesPart(locale, row),
                ...per90Part(locale, row),
              ]}
              coverage={row.minutes.coverage}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function competitionName(row: {
  competition: { name: string; short_name: string | null };
}): string {
  return row.competition.short_name ?? row.competition.name;
}

/** "551 min", "at least 450 min", or "minutes not supplied" (T-823). */
function minutesPart(locale: string, row: PlayerSeasonRecord): string {
  const { minutes } = row;
  if (minutes.coverage === 'available' && minutes.total !== null) {
    return say(locale, 'playerPage.tile.minutes', { minutes: formatNumber(locale, minutes.total) });
  }
  if (minutes.coverage === 'limited') {
    return say(locale, 'playerPage.tile.minutesAtLeast', {
      minutes: formatNumber(locale, minutes.supplied_minutes),
    });
  }
  return say(locale, 'playerPage.tile.minutesMissing');
}

function per90Part(locale: string, row: PlayerSeasonRecord): string[] {
  const rate = goalsPer90(row.goals, row.minutes);
  return rate === null
    ? []
    : [say(locale, 'playerPage.tile.per90', { value: formatFixed(locale, rate, 2) })];
}

function SeasonTile({
  testId,
  locale,
  label,
  goals,
  parts,
  coverage,
}: {
  testId: string;
  locale: string;
  label: string;
  goals: number;
  /** Under the figure, after the word "Goals": appearances, minutes, the rate. */
  parts: string[];
  /** The minutes' coverage, for a tile whose minutes are not whole. */
  coverage?: PlayerSeasonRecord['minutes']['coverage'];
}) {
  return (
    <div
      className={cx(CARD, 'flex min-w-0 flex-col gap-1 rounded-tile p-3.5 md:p-4.5')}
      data-testid={testId}
      data-minutes={coverage}
    >
      <span className="truncate text-xs text-caption">{label}</span>
      <b
        className="font-sans text-display-2 leading-none font-extrabold font-stretch-condensed tabular-nums md:text-display-3"
        data-testid="tile-goals"
      >
        {formatNumber(locale, goals)}
      </b>
      <span className="text-xs text-muted md:text-sm">
        {[say(locale, 'playerPage.col.goals'), ...parts].join(' · ')}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The career by season
// ---------------------------------------------------------------------------

/**
 * The record by season, club and competition (T-037, T-1500): one row group
 * per season with the season as its header cell, then starts, substitute
 * appearances, goals, assists and minutes (T-823); `full` is the Stats tab's,
 * with the cards too. The table keeps its width and scrolls inside its own
 * box on a phone (a focusable region named by the caption), so the page never
 * scrolls sideways.
 */
export function RecordPanel({
  page,
  rows,
  locale,
  full,
  testId,
}: {
  page: PlayerPage;
  rows: PlayerSeasonRecord[];
  locale: string;
  full: boolean;
  testId: string;
}) {
  const captionId = `${testId}-caption`;
  const name = playerName(page.person);
  const numeric = 'py-2.5 ps-3 text-end';
  return (
    <section
      aria-labelledby={`${testId}-heading`}
      className={cx(CARD, 'flex min-w-0 flex-col overflow-hidden')}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3.5 md:px-5">
        <h2 id={`${testId}-heading`} className={CARD_TITLE}>
          <Translated
            locale={locale}
            message={full ? 'playerPage.record' : 'playerPage.careerBySeason'}
          />
        </h2>
        <Coverage locale={locale} state={page.record.coverage} />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted md:px-5" data-testid="record-empty">
          <Translated
            locale={locale}
            message={
              page.record.data === null ? 'playerPage.noRecord' : 'playerPage.noSeasonRecord'
            }
          />
        </p>
      ) : (
        <div
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
          role="region"
          aria-labelledby={captionId}
          tabIndex={0}
          data-testid="record-scroll"
        >
          <table className="w-full min-w-[40rem] text-sm tabular-nums">
            <caption id={captionId} className="sr-only">
              {say(locale, 'playerPage.careerCaption', { name })}
            </caption>
            <thead>
              <tr className="text-xs text-caption">
                <th scope="col" className="py-2.5 ps-4 pe-3 text-start font-semibold md:ps-5">
                  <Translated locale={locale} message="competitionPage.season" />
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  <Translated locale={locale} message="playerPage.col.club" />
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  <Translated locale={locale} message="competitionPage.title" />
                </th>
                <Head locale={locale} message="playerPage.col.starts" />
                <Head locale={locale} message="playerPage.col.sub" />
                <Head locale={locale} message="playerPage.col.goals" />
                <Head locale={locale} message="playerPage.col.assists" />
                {full && <Head locale={locale} message="playerPage.col.yellow" />}
                {full && <Head locale={locale} message="playerPage.col.red" />}
                <Head locale={locale} message="playerPage.col.minutes" last />
              </tr>
            </thead>
            {seasonGroups(rows).map((group) => (
              <tbody key={group.season.id} className="border-t border-default">
                {group.rows.map((row, i) => (
                  <tr
                    key={`${row.competition.id}-${row.team.id}`}
                    className={cx(i > 0 && 'border-t border-default')}
                    data-testid="record-row"
                  >
                    {i === 0 && (
                      <th
                        scope="rowgroup"
                        rowSpan={group.rows.length}
                        className="py-2.5 ps-4 pe-3 text-start align-top font-bold md:ps-5"
                      >
                        <bdi>{localDigits(locale, group.season.label)}</bdi>
                      </th>
                    )}
                    <td className="py-2.5 pe-3">
                      <Link
                        href={`/${locale}/team/${row.team.id}`}
                        className={inlineTargetClasses('gap-2 hover:underline')}
                      >
                        {/* The club's crest (T-1617). */}
                        <EntityImage
                          media={row.team.crest}
                          kind="crest"
                          name={row.team.name}
                          size={20}
                        />
                        {row.team.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pe-3 text-muted">
                      <Link
                        href={`/${locale}/competition/${row.competition.id}?season=${row.season.id}`}
                        className={inlineTargetClasses('hover:underline')}
                      >
                        {competitionName(row)}
                      </Link>
                    </td>
                    <td className={numeric}>{formatNumber(locale, row.starts)}</td>
                    <td className={numeric}>{formatNumber(locale, row.sub_appearances)}</td>
                    <td className={cx(numeric, 'font-extrabold')}>
                      {formatNumber(locale, row.goals)}
                    </td>
                    <td className={numeric}>{formatNumber(locale, row.assists)}</td>
                    {full && <td className={numeric}>{formatNumber(locale, row.yellow_cards)}</td>}
                    {full && <td className={numeric}>{formatNumber(locale, row.red_cards)}</td>}
                    <MinutesCell locale={locale} row={row} />
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="border-t border-default px-4 py-3 text-xs text-caption md:px-5">
          <Translated locale={locale} message="playerPage.careerNote" />{' '}
          <Translated locale={locale} message="playerPage.minutesNote" />
        </p>
      )}
    </section>
  );
}

function Head({
  locale,
  message,
  last = false,
}: {
  locale: string;
  message: MessageKey;
  last?: boolean;
}) {
  return (
    <th scope="col" className={cx('py-2.5 ps-3 text-end font-semibold', last && 'pe-4 md:pe-5')}>
      <Translated locale={locale} message={message} />
    </th>
  );
}

/** A season's minutes (T-823): whole, "at least" with the matches it covers, or not supplied. */
function MinutesCell({ locale, row }: { locale: string; row: PlayerSeasonRecord }) {
  const { text, note } = minutesText(locale, row.minutes);
  return (
    <td
      className={cx(
        'py-2.5 ps-3 pe-4 text-end md:pe-5',
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

/**
 * The seasons the record covers as pills, keeping the open tab (Matches or
 * Stats): one per label, `current` the label chosen (T-1565), each a 44px
 * target on a phone (T-1568).
 */
export function SeasonFilter({
  page,
  locale,
  tab,
  seasons,
  current,
}: {
  page: PlayerPage;
  locale: string;
  tab: 'matches' | 'stats';
  seasons: { id: string; label: string }[];
  /** The chosen season's label; null for every season. */
  current: string | null;
}) {
  if (seasons.length < 2) return null;
  const pill = (chosen: boolean) =>
    cx(
      'inline-flex min-h-touch items-center rounded-pill px-3 tabular-nums md:min-h-8',
      chosen ? 'bg-fg font-bold text-canvas' : 'border border-default text-muted hover:text-fg',
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
        aria-current={current === null ? 'true' : undefined}
        className={pill(current === null)}
      >
        <Translated locale={locale} message="playerPage.allSeasons" />
      </Link>
      {seasons.map((season) => (
        <Link
          key={season.id}
          href={playerTabHref(locale, page.person.id, tab, season.id)}
          aria-current={current === season.label ? 'true' : undefined}
          className={pill(current === season.label)}
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

/** The two sides with the score between them in the page's direction (T-1375, D-193). */
function MatchLink({ match, locale }: { match: PlayerMatch; locale: string }) {
  const { fixture } = match;
  return (
    <Link
      href={`/${locale}/match/${fixture.id}`}
      className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-semibold hover:underline focus-visible:underline"
    >
      {/* Each side's crest before its name (T-1617). */}
      <span className="hidden sm:contents">
        <EntityImage media={fixture.home.crest} kind="crest" name={fixture.home.name} size={20} />
      </span>
      <bdi className="min-w-0 truncate">{fixture.home.short_name ?? fixture.home.name}</bdi>
      {fixture.score === null ? (
        <span className="shrink-0 font-medium text-caption">
          {say(locale, 'competitionPage.v')}
        </span>
      ) : (
        <Score
          home={fixture.score.home}
          away={fixture.score.away}
          locale={locale}
          separator="–"
          className="shrink-0 font-sans font-extrabold font-stretch-condensed tabular-nums"
          testId="player-match-score"
        />
      )}
      <span className="hidden sm:contents">
        <EntityImage media={fixture.away.crest} kind="crest" name={fixture.away.name} size={20} />
      </span>
      <bdi className="min-w-0 truncate">{fixture.away.short_name ?? fixture.away.name}</bdi>
    </Link>
  );
}

/**
 * The Overview's last six matches (T-1500), newest first, one dense row each:
 * the day, the two sides and the score, the competition and his role, and
 * his goals and assists in the brand's text colour (a dash when he had
 * none). The whole log, with cards and expected goals, is the Matches tab's.
 */
export function LastMatchesPanel({
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
    <section
      aria-labelledby="recent-matches-heading"
      className={cx(CARD, 'flex min-w-0 flex-col overflow-hidden')}
      data-testid="recent-matches"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3.5">
        <h2 id="recent-matches-heading" className="text-sm font-extrabold">
          <Translated locale={locale} message="playerPage.recentMatches" />
        </h2>
        <Coverage locale={locale} state={page.recent_matches.coverage} />
      </div>
      {matches.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted" data-testid="recent-matches-empty">
          <Translated locale={locale} message="playerPage.noMatches" />
        </p>
      ) : (
        <ul className="flex flex-col">
          {matches.map((m) => {
            const contribution = [
              ...(m.goals > 0
                ? [plural(pageLocale(locale), 'playerPage.goals', m.goals).text]
                : []),
              ...(m.assists > 0
                ? [plural(pageLocale(locale), 'playerPage.assists', m.assists).text]
                : []),
            ];
            return (
              <li
                key={m.fixture.id}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-default px-4 py-2 last:border-b-0"
                data-testid="player-match"
              >
                <time dateTime={m.fixture.kickoff_at} className="text-xs text-caption tabular-nums">
                  {formatDate(locale, m.fixture.kickoff_at, timeZone, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </time>
                <span className="flex min-w-0 flex-col">
                  <MatchLink match={m} locale={locale} />
                  <span className="truncate text-xs text-caption">
                    {competitionName(m.fixture)}
                    {' · '}
                    {roleLabel(locale, m)}
                  </span>
                </span>
                {/* One line each, so the side column keeps the sides' names whole (T-1569). */}
                <span
                  className={cx(
                    'flex flex-col items-end text-xs whitespace-nowrap',
                    contribution.length > 0 ? 'font-extrabold text-accent' : 'text-caption',
                  )}
                  data-testid="player-match-contribution"
                >
                  {contribution.length > 0
                    ? contribution.map((part) => <span key={part}>{part}</span>)
                    : '–'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {footer !== undefined && <div className="border-t border-default px-4">{footer}</div>}
    </section>
  );
}

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
 * The Matches tab's whole log, newest first (T-037): when, the two sides with
 * the score between them in the page's direction (the home side and its
 * goals on the right on `/fa`, D-193), the competition and any "aet" or
 * shoot-out from his team's side (T-822), and his line.
 */
export function PlayerMatchesPanel({
  page,
  matches,
  locale,
  timeZone,
}: {
  page: PlayerPage;
  matches: PlayerMatch[];
  locale: string;
  timeZone: string;
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
                    <MatchLink match={m} locale={locale} />
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
              className="flex flex-wrap items-center gap-x-3 border-b border-default py-2 text-sm last:border-b-0"
              data-testid="spell"
            >
              <Link
                href={`/${locale}/team/${spell.team.id}`}
                className={inlineTargetClasses('gap-2 font-semibold hover:underline')}
              >
                {/* The club's crest (T-1617). */}
                <EntityImage
                  media={spell.team.crest}
                  kind="crest"
                  name={spell.team.name}
                  size={20}
                />
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
