import Link from '@/components/ui/link';
import { MatchRow } from '@/components/match-row';
import { SectionTabs } from '@/components/ui/section-tabs';
import type { ReactNode } from 'react';
import type {
  AssistLeader,
  CardLeader,
  CleanSheetLeader,
  CompetitionPage,
  CoverageState,
  Covered,
  FixtureStatus,
  FollowedEntity,
  Leader,
  LeagueZones,
  SeasonFixture,
} from '@fmip/contracts';
import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import type { ForecastBarWords } from '@/components/forecast-bar';
import { FreshnessStamp, type FreshnessWords } from '@/components/freshness-stamp';
import { MinutesFigure } from '@/components/minutes-figure';
import { FollowIntentMark } from '@/components/push-offer-mark';
import { PushOfferFor } from '@/components/push-offer-for';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { Button, ButtonLink, CoverageBadge, Icon } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { followAction, unfollowAction } from '@/lib/auth-actions';
import {
  COVERAGE_KEY,
  KIND_KEY,
  STATUS_KEY,
  ZONE_KEY,
  ZONE_MARK,
  say,
  seasonHref,
  zoneBand,
  zonesAbsentLine,
} from '@/lib/competition';
import {
  type CompetitionTab,
  type LeagueNumbers,
  type Matchweek,
  type RoundGroup,
  clubCount,
  hasTable,
  mainResults,
  perMatch,
  seasonDigits,
  sharePercent,
  tabHref,
} from '@/lib/competition-overview';
import type { CardForecast } from '@/lib/score-card-products';
import { zoneWords } from '@/lib/reader-time-zone';

/**
 * The competition page in the Hybrid design, data mode (T-1385, D-203): the
 * band, the tab bar and the modules each tab is made of. Every module states
 * its coverage with a `CoverageBadge` (rule 3), a live one its freshness
 * (rule 4); no module is drawn that would look populated without data. The
 * page (`app/[locale]/competition/[id]/page.tsx`) fetches and composes.
 */

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** A module's heading: small capitals in Latin script, a slanted green tick before it. */
function PanelHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="flex items-center text-sm font-extrabold text-fg uppercase ltr:tracking-wider"
    >
      <span aria-hidden="true" className="me-2.5 inline-block h-3.5 w-1 -skew-x-12 bg-accent" />
      {children}
    </h2>
  );
}

/** A module on the stage (T-1385): a surface card, its name, and what it says about itself. */
export function Panel({
  testId,
  id = testId,
  title,
  aside,
  children,
  className,
}: {
  testId: string;
  /** The section's own id, where one page has several panels of a kind (T-1386). */
  id?: string;
  title: ReactNode;
  /** Beside the name: the coverage badge, the freshness, the model id. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-testid={testId}
      className={cx(
        'flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-card border border-default bg-surface p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <PanelHeading id={headingId}>{title}</PanelHeading>
        {aside !== undefined && (
          <span className="inline-flex flex-wrap items-center gap-2.5">{aside}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A coverage state as the Hybrid badge, in the page's words. */
export function Coverage({ locale, state }: { locale: string; state: CoverageState }) {
  return <CoverageBadge state={state} label={say(locale, COVERAGE_KEY[state])} />;
}

/** "Updated 26 Sep 2026, 16:15", in the viewer's zone. */
function Updated({ locale, timeZone, iso }: { locale: string; timeZone: string; iso: string }) {
  return (
    <span className="text-xs text-muted">
      <Translated locale={locale} message="competitionPage.updated" />{' '}
      <Stamp iso={iso} locale={locale} timeZone={timeZone} />
    </span>
  );
}

/**
 * A module the API covers (`Covered<T[]>`): its badge, its last update, and
 * its rows -- or the sentence that says why there are none (rule 3).
 */
export function CoveredPanel<T>({
  title,
  module,
  testId,
  intro,
  empty,
  footer,
  children,
  locale,
  timeZone,
}: {
  title: ReactNode;
  module: Covered<T[]>;
  locale: string;
  timeZone: string;
  testId: string;
  /** Above the list: a filter, and what it did (T-824). */
  intro?: ReactNode;
  /** What an empty list means when it is a list, e.g. nobody reached a floor (T-824). */
  empty?: ReactNode;
  /** Under the list: a note, a link to the whole of it. */
  footer?: ReactNode;
  children: (data: T[]) => ReactNode;
}) {
  return (
    <Panel
      testId={testId}
      title={title}
      aside={
        <>
          {module.last_updated_at !== null && (
            <Updated locale={locale} timeZone={timeZone} iso={module.last_updated_at} />
          )}
          <Coverage locale={locale} state={module.coverage} />
        </>
      }
    >
      {intro}
      {module.data === null || module.data.length === 0 ? (
        <p className="text-sm text-muted" data-testid={`${testId}-empty`}>
          {empty !== undefined ? (
            empty
          ) : module.coverage === 'delayed' ? (
            <Translated locale={locale} message="competitionPage.delayed" />
          ) : (
            <Translated locale={locale} message="competitionPage.notSupplied" />
          )}
        </p>
      ) : (
        children(module.data)
      )}
      {footer}
    </Panel>
  );
}

/** A link to a fuller tab, in the green, at a thumb's height. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-touch items-center gap-1.5 self-start text-sm font-bold text-accent hover:underline focus-visible:underline"
    >
      {children}
      <Icon name="forward" size={15} />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// The band and the tabs
// ---------------------------------------------------------------------------

const TAB_KEY: Record<CompetitionTab, MessageKey> = {
  overview: 'competitionPage.tab.overview',
  table: 'competitionPage.tab.table',
  fixtures: 'competitionPage.tab.fixtures',
  results: 'competitionPage.tab.results',
  players: 'competitionPage.tab.players',
  stats: 'competitionPage.tab.stats',
};

/**
 * The competition's band (T-1385, D-203): brand colours only -- the green
 * rule along its top, the green follow button and the green bar under the
 * current tab, on the theme's own surface, so it follows Day and Night. No
 * club colour here (that is a club or player page's band, T-1386). The
 * country, kind and season; the name; what the season has played and what
 * is next; follow; the seasons; the tabs.
 */
export function CompetitionBand({
  page,
  locale,
  timeZone,
  tab,
  tabs,
  minMinutes,
  matchweek,
  follow,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  tab: CompetitionTab;
  tabs: CompetitionTab[];
  minMinutes: number | null;
  matchweek: Matchweek | null;
  follow: ReactNode;
}) {
  const c = page.competition;
  const kind = KIND_KEY[c.kind];
  const name = c.localised_name ?? c.name;
  const eyebrow = [
    ...(c.country !== null ? [c.country.name] : []),
    kind === undefined ? c.kind : say(locale, kind),
    ...(c.tier !== null
      ? [say(locale, 'competitionPage.tier', { tier: formatNumber(locale, c.tier) })]
      : []),
    ...(c.gender === 'women' ? [say(locale, 'competitionPage.women')] : []),
    say(locale, 'competitionPage.seasonLabel', {
      season: seasonDigits(locale, page.season.label),
    }),
  ];
  return (
    <div className="border-b border-default bg-surface" data-testid="competition-header">
      <div aria-hidden="true" className="h-1 bg-accent" />
      <div className="page-frame">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-6 pb-4 md:pt-7">
          <span className="grid size-18 shrink-0 place-items-center rounded-tile border border-default bg-canvas md:size-26">
            <EntityImage media={c.logo} kind="logo" name={name} size={48} aboveFold />
          </span>
          <div className="min-w-0 flex-[1_1_20rem]">
            <p
              className="text-xs font-bold text-muted uppercase ltr:tracking-wider"
              data-testid="competition-eyebrow"
            >
              {eyebrow.join(' · ')}
            </p>
            <h1
              className="mt-1.5 font-sans text-display-2 font-black font-stretch-condensed break-words uppercase md:text-display-3 lg:text-display-4 [:root:is(:lang(fa),:lang(ar))_&]:text-display-1 md:[:root:is(:lang(fa),:lang(ar))_&]:text-display-2"
              data-testid="title"
            >
              {name}
            </h1>
            {c.localised_name !== null && (
              <p className="text-sm text-muted" data-testid="canonical-name">
                {c.name}
              </p>
            )}
            <SeasonFacts page={page} locale={locale} timeZone={timeZone} matchweek={matchweek} />
          </div>
          <div className="flex flex-col items-start gap-2">{follow}</div>
        </div>
        {page.seasons.length > 1 && (
          <nav
            aria-label={say(locale, 'competitionPage.season')}
            className="flex flex-wrap items-center gap-1 pb-3 text-sm"
            data-testid="seasons"
          >
            <span className="me-1 text-xs font-bold text-muted">
              <Translated locale={locale} message="competitionPage.season" />
            </span>
            {page.seasons.map((season) => {
              const current = season.id === page.season.id;
              return (
                <Link
                  key={season.id}
                  href={seasonHref(locale, c.id, season, tab)}
                  aria-current={current ? 'true' : undefined}
                  className={cx(
                    'inline-flex min-h-8 items-center rounded-pill px-3 tabular-nums',
                    current
                      ? 'bg-fg font-bold text-canvas'
                      : 'border border-default text-muted hover:text-fg',
                  )}
                >
                  {season.is_current
                    ? say(locale, 'competitionPage.seasonCurrent', {
                        season: seasonDigits(locale, season.label),
                      })
                    : seasonDigits(locale, season.label)}
                </Link>
              );
            })}
          </nav>
        )}
        <SectionTabs
          label={say(locale, 'competitionPage.sections')}
          testId="competition-tab"
          tabs={tabs.map((t) => ({
            key: t,
            href: tabHref(locale, c.id, page.season, t, t === 'players' ? minMinutes : null),
            label:
              t === 'table' && !hasTable(page)
                ? say(locale, 'competitionPage.tab.knockout')
                : say(locale, TAB_KEY[t]),
            current: t === tab,
          }))}
        />
      </div>
    </div>
  );
}

/** "18 clubs · 59 matches played · next: Matchweek 8, Thu 2 Oct": only what the season holds. */
function SeasonFacts({
  page,
  locale,
  timeZone,
  matchweek,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  matchweek: Matchweek | null;
}) {
  const clubs = clubCount(page);
  // The main competition's matches; a cup's qualifying rounds are named apart (D-209).
  const played = mainResults(page.results).length;
  const qualifying = page.results.length - played;
  const first = matchweek?.state === 'next' ? matchweek.fixtures.find(notOver) : undefined;
  const facts: ReactNode[] = [];
  if (clubs !== null) {
    facts.push(
      <Translated
        key="clubs"
        locale={locale}
        message="competitionPage.facts.clubs"
        count={clubs}
      />,
    );
  }
  facts.push(
    <Translated
      key="played"
      locale={locale}
      message="competitionPage.facts.played"
      count={played}
    />,
  );
  if (qualifying > 0) {
    facts.push(
      <Translated
        key="qualifying"
        locale={locale}
        message="competitionPage.facts.qualifying"
        count={qualifying}
      />,
    );
  }
  if (first !== undefined) {
    const day = formatDate(locale, first.kickoff_at, timeZone, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    facts.push(
      <span key="next">
        {matchweek?.label != null
          ? say(locale, 'competitionPage.facts.nextRound', { round: matchweek.label, day })
          : say(locale, 'competitionPage.facts.next', { day })}
      </span>,
    );
  }
  return (
    <p className="mt-1.5 text-sm font-medium text-muted" data-testid="season-facts">
      {facts.map((fact, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {fact}
        </span>
      ))}
    </p>
  );
}

const notOver = (f: SeasonFixture): boolean => f.status === 'scheduled' || f.status === 'live';

// ---------------------------------------------------------------------------
// Following the competition
// ---------------------------------------------------------------------------

/**
 * Follow the competition (T-1385): the same plain form the settings page
 * posts, so it works without JavaScript. A guest is sent to sign in; a
 * follow list that cannot be read is a sentence, never a guessed button.
 */
export function CompetitionFollow({
  locale,
  competitionId,
  name,
  signedIn,
  following,
}: {
  locale: string;
  competitionId: string;
  /** The competition's name as the page shows it, for the push offer (T-1429). */
  name: string;
  signedIn: boolean;
  following: FollowedEntity[] | null;
}) {
  return (
    <EntityFollow
      locale={locale}
      entityType="competition"
      entityId={competitionId}
      name={name}
      signedIn={signedIn}
      following={following}
      followingKey="competitionPage.follow.following"
      unreachableKey="competitionPage.follow.unreachable"
    />
  );
}

/**
 * Follow a competition, a club or a player from its band (T-1385, T-1386):
 * one form for the three, each with its own "you follow this …" and
 * "cannot be checked" sentence. The test ids are `<type>-follow…`.
 */
export function EntityFollow({
  locale,
  entityType,
  entityId,
  name,
  signedIn,
  following,
  followingKey,
  unreachableKey,
}: {
  locale: string;
  entityType: 'competition' | 'team' | 'person';
  entityId: string;
  /**
   * The name the page shows. A team or a competition followed here brings up
   * the push offer naming it (T-1429); a player's follow sends no match
   * alerts, so it is not offered.
   */
  name?: string;
  signedIn: boolean;
  following: FollowedEntity[] | null;
  followingKey: MessageKey;
  unreachableKey: MessageKey;
}) {
  if (!signedIn) {
    return (
      <ButtonLink
        href={`/${locale}/login`}
        variant="primary"
        size="md"
        data-testid={`${entityType}-follow-guest`}
      >
        <Icon name="bell" size={18} />
        <Translated locale={locale} message="competitionPage.follow.signIn" />
      </ButtonLink>
    );
  }
  if (following === null) {
    return (
      <p className="max-w-60 text-sm text-muted" data-testid={`${entityType}-follow-unreachable`}>
        <Translated locale={locale} message={unreachableKey} />
      </p>
    );
  }
  const followed = following.some((f) => f.entity_type === entityType && f.entity_id === entityId);
  const action = (followed ? unfollowAction : followAction).bind(null, locale);
  const offered = entityType !== 'person' && name !== undefined;
  const form = (
    <form
      action={action}
      className="flex flex-col items-start gap-1.5"
      data-testid={`${entityType}-follow`}
      data-following={followed}
    >
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      {offered && !followed && <FollowIntentMark />}
      {followed && (
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Icon name="check" size={16} />
          <Translated locale={locale} message={followingKey} />
        </p>
      )}
      <Button type="submit" variant={followed ? 'secondary' : 'primary'} size="md">
        {!followed && <Icon name="bell" size={18} />}
        <Translated
          locale={locale}
          message={followed ? 'competitionPage.follow.stop' : 'competitionPage.follow.start'}
        />
      </Button>
    </form>
  );
  if (!followed || entityType === 'person' || name === undefined) return form;
  return (
    <div className="flex flex-col items-start gap-2">
      {form}
      <PushOfferFor locale={locale} entity={{ type: entityType, id: entityId }} name={name} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

/** "UK time" or "Tehran time": the zone every kick-off on the page is in (D-207). */
export { zoneWords };

/** When, or what happened instead: the day and time, "live", "postponed". */
export function When({
  fixture,
  locale,
  timeZone,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
}) {
  const status = fixture.status as FixtureStatus;
  const day = formatDate(locale, fixture.kickoff_at, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = formatDate(locale, fixture.kickoff_at, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const word = STATUS_KEY[status];
  return (
    <span className="flex flex-col font-mono text-xs [:root:is(:lang(fa),:lang(ar))_&]:font-sans leading-snug text-muted">
      <time dateTime={fixture.kickoff_at}>
        <span className="block">{day}</span>
        {status !== 'finished' && <span className="block">{time}</span>}
      </time>
      {word !== undefined && (
        <span
          className={cx('font-sans font-bold', status === 'live' ? 'text-live' : 'text-warning')}
          data-testid="fixture-status"
        >
          {say(locale, word)}
        </span>
      )}
    </span>
  );
}

/**
 * One match as a row (T-1385; the Design System's `MatchRow`, T-1508): the
 * kick-off time and day, or what happened instead; home above away; the
 * score, or before kick-off the model's three percentages where the page has
 * them, with the model's receipt under the row. On `/fa` the grid follows
 * the reading direction, so the status is on the right. The row opens the
 * match centre.
 */
export function FixtureRow({
  fixture,
  locale,
  timeZone,
  forecast,
  forecastWords,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
  /** The model's pre-kick-off forecast; undefined where the page did not ask. */
  forecast?: CardForecast;
  forecastWords?: ForecastBarWords;
}) {
  const status = fixture.status as FixtureStatus;
  const day = formatDate(locale, fixture.kickoff_at, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = formatDate(locale, fixture.kickoff_at, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const word = STATUS_KEY[status];
  const row =
    status === 'scheduled'
      ? 'scheduled'
      : status === 'finished'
        ? 'ft'
        : status === 'live'
          ? 'live'
          : 'off';
  return (
    <MatchRow
      testId="fixture"
      href={`/${locale}/match/${fixture.id}`}
      status={row}
      when={
        row === 'scheduled' ? (
          <time dateTime={fixture.kickoff_at}>{time}</time>
        ) : row === 'ft' ? (
          <Translated locale={locale} message="status.fullTime" />
        ) : (
          <span data-testid="fixture-status">
            {word === undefined ? status : say(locale, word)}
          </span>
        )
      }
      sub={row === 'live' ? undefined : <time dateTime={fixture.kickoff_at}>{day}</time>}
      home={{
        name: fixture.home.short_name ?? fixture.home.name,
        score: fixture.score?.home ?? null,
      }}
      away={{
        name: fixture.away.short_name ?? fixture.away.name,
        score: fixture.score?.away ?? null,
      }}
      model={
        forecast !== undefined && forecastWords !== undefined
          ? { forecast, words: forecastWords }
          : undefined
      }
      locale={locale}
      timeZone={timeZone}
      zone={zoneWords(locale, timeZone)}
    />
  );
}

/** The freshness of a list with a match in progress (rule 4); nothing when none is live. */
export function LiveFreshness({
  fixtures,
  checkedAt,
  now,
  locale,
  words,
}: {
  fixtures: readonly SeasonFixture[];
  checkedAt: string | null;
  now: number;
  locale: string;
  words: FreshnessWords;
}) {
  if (checkedAt === null || !fixtures.some((f) => f.status === 'live')) return null;
  return (
    <FreshnessStamp
      checkedAt={checkedAt}
      now={now}
      staleAfterMs={STALE_LIVE_AFTER_MS}
      locale={locale}
      words={words}
    />
  );
}

/**
 * The Overview's round (T-1385): its matches with scores or kick-off times,
 * and the model's three-way for each where it has one. Each bar names the
 * model and when it computed (blueprint 6.2); the note says what the figures
 * are and which zone the times are in.
 */
export function MatchweekPanel({
  matchweek,
  page,
  locale,
  timeZone,
  forecasts,
  forecastWords,
  freshness,
}: {
  matchweek: Matchweek | null;
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  forecasts: Record<string, CardForecast>;
  forecastWords: ForecastBarWords;
  freshness: ReactNode;
}) {
  const title =
    matchweek === null
      ? say(locale, 'competitionPage.matchweek.none')
      : (matchweek.label ??
        say(
          locale,
          matchweek.state === 'next'
            ? 'competitionPage.matchweek.next'
            : 'competitionPage.matchweek.latest',
        ));
  return (
    <Panel testId="matchweek" title={title} aside={freshness}>
      {matchweek === null ? (
        <p className="text-sm text-muted" data-testid="matchweek-empty">
          <Translated locale={locale} message="competitionPage.noFixtures" />
        </p>
      ) : (
        <>
          {matchweek.state === 'latest' && (
            <p className="text-sm text-muted" data-testid="matchweek-latest">
              <Translated locale={locale} message="competitionPage.matchweek.seasonOver" />
            </p>
          )}
          <ul className="flex flex-col">
            {matchweek.fixtures.map((f) => (
              <FixtureRow
                key={f.id}
                fixture={f}
                locale={locale}
                timeZone={timeZone}
                forecast={forecasts[f.id] ?? { state: 'none' }}
                forecastWords={forecastWords}
              />
            ))}
          </ul>
          <p className="text-xs text-muted">
            {say(locale, 'competitionPage.matchweek.note', {
              zone: zoneWords(locale, timeZone),
            })}
          </p>
          {matchweek.more > 0 && (
            <MoreLink href={tabHref(locale, page.competition.id, page.season, 'fixtures')}>
              <Translated
                locale={locale}
                message="competitionPage.matchweek.more"
                count={matchweek.more}
              />
            </MoreLink>
          )}
        </>
      )}
    </Panel>
  );
}

/** Fixtures or results by round (T-1385), each round headed in our words or not at all. */
export function RoundsPanel({
  testId,
  title,
  groups,
  empty,
  locale,
  timeZone,
  freshness,
}: {
  testId: string;
  title: ReactNode;
  groups: RoundGroup[];
  empty: ReactNode;
  locale: string;
  timeZone: string;
  freshness?: ReactNode;
}) {
  return (
    <Panel testId={testId} title={title} aside={freshness}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted" data-testid={`${testId}-empty`}>
          {empty}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col" data-testid="round">
                {group.label !== null && (
                  <h3 className="border-b border-strong pb-1.5 text-xs font-extrabold text-muted uppercase ltr:tracking-wider">
                    {group.label}
                  </h3>
                )}
                <ul className="flex flex-col">
                  {group.fixtures.map((f) => (
                    <FixtureRow key={f.id} fixture={f} locale={locale} timeZone={timeZone} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">{zoneWords(locale, timeZone)}</p>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The table's notes
// ---------------------------------------------------------------------------

/**
 * The season projection's slot (T-1385, D-203): a planned model feature, not
 * built. The sentence says so; the table's dashed columns stay empty. Never
 * a figure, never an estimate (rule 3).
 */
export function ProjectionNote({ locale }: { locale: string }) {
  return (
    <p className="text-sm text-muted" data-testid="projection-note">
      <b className="font-bold text-warning">
        <Translated locale={locale} message="competitionPage.projection.head" />.
      </b>{' '}
      <Translated locale={locale} message="competitionPage.projection.note" />
    </p>
  );
}

/** A cup with no table (T-1385): said once, so its Overview opens on its rounds instead. */
export function NoTableNote({ locale }: { locale: string }) {
  return (
    <Panel testId="no-table" title={say(locale, 'competitionPage.tab.table')}>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="competitionPage.noTable" />
      </p>
    </Panel>
  );
}

/** What the marks mean, where they come from, and what is not listed (rule 3). */
export function ZoneLegend({ locale, zones }: { locale: string; zones: LeagueZones }) {
  const absent = zonesAbsentLine(locale, zones);
  if (zones.state !== 'listed') {
    return absent === null ? null : (
      <p className="text-xs text-muted" data-testid="table-zones-absent">
        {absent}
      </p>
    );
  }
  const separator = say(locale, 'competitionPage.list.separator');
  return (
    <div className="flex flex-col gap-1 text-xs text-muted" data-testid="table-zones">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {zones.zones.map((z) => (
          <li key={`${z.kind}-${z.from}`} className={`border-s-4 ps-2 ${ZONE_MARK[z.kind]}`}>
            {say(locale, ZONE_KEY[z.kind])}: {zoneBand(locale, z)}
          </li>
        ))}
      </ul>
      <p>
        <Translated locale={locale} message="competitionPage.zones.lead" />
        {zones.sources.map((url, i) => (
          <span key={url}>
            {i === 0 ? ' (' : separator}
            <a
              href={url}
              className="inline-flex min-h-6 items-center underline"
              rel="noopener noreferrer"
            >
              {say(locale, 'competitionPage.zones.source', { number: formatNumber(locale, i + 1) })}
            </a>
            {i === zones.sources.length - 1 ? ')' : ''}
          </span>
        ))}
        . <Translated locale={locale} message="competitionPage.zones.cupWinners" />
        {zones.complete ? (
          ''
        ) : (
          <>
            {' '}
            <Translated locale={locale} message="competitionPage.zones.incomplete" />
          </>
        )}
      </p>
      {zones.note !== null && <p>{zones.note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

type BoardPlayer = AssistLeader | CleanSheetLeader | CardLeader;

/** One player on a board: place, photo, name and club, minutes, and the board's own figure. */
function PlayerRow({
  locale,
  place,
  row,
  figure,
  minutes = true,
}: {
  locale: string;
  place: number;
  row: Leader | BoardPlayer;
  figure: ReactNode;
  /** The season's minutes beside the name; the Overview's short list leaves them out. */
  minutes?: boolean;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-default py-2 text-sm last:border-b-0">
      <span className="text-caption">{formatNumber(locale, place)}</span>
      <EntityImage media={row.person.photo} kind="photo" name={row.person.name} size={40} />
      <span className="min-w-0">
        <Link
          href={`/${locale}/player/${row.person.id}`}
          className="inline-flex min-h-6 items-center font-semibold hover:underline focus-visible:underline"
        >
          {row.person.name}
        </Link>
        {row.team !== null && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <EntityImage media={row.team.crest} kind="crest" name={row.team.name} size={20} />
            {row.team.name}
          </span>
        )}
        {minutes && (
          <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            <span data-testid="appearances">
              {row.appearances === null ? (
                <span className="italic">
                  <Translated locale={locale} message="competition.leaders.appearancesNone" />
                </span>
              ) : (
                <Translated
                  locale={locale}
                  message="competition.leaders.appearances"
                  count={row.appearances}
                />
              )}
            </span>
            <MinutesFigure locale={locale} minutes={row.minutes} className="text-xs text-muted" />
          </span>
        )}
      </span>
      {figure}
    </li>
  );
}

/** A board's big figure: the condensed display weight. */
function Figure({ locale, value }: { locale: string; value: number }) {
  return (
    <b className="text-end font-sans text-2xl leading-none font-black font-stretch-condensed tabular-nums">
      {formatNumber(locale, value)}
    </b>
  );
}

/** The scorers as rows; `limit` for the Overview's short list. */
export function ScorerList({
  leaders,
  locale,
  limit,
}: {
  leaders: Leader[];
  locale: string;
  limit?: number;
}) {
  const shown = limit === undefined ? leaders : leaders.slice(0, limit);
  return (
    <ol className="flex flex-col">
      {shown.map((leader, index) => (
        <PlayerRow
          key={`${leader.person.id}:${leader.team?.id ?? ''}`}
          locale={locale}
          place={index + 1}
          row={leader}
          minutes={limit === undefined}
          figure={<Figure locale={locale} value={leader.goals} />}
        />
      ))}
    </ol>
  );
}

/**
 * Said above the Players tab when its tables are the provider's season totals
 * and not our own count (T-1441, D-232): which source, and that it lists only
 * the players the provider has been asked about, so a leader may be missing.
 */
export function ProviderTotalsNote({ locale }: { locale: string }) {
  return (
    <p className="text-sm text-muted lg:col-span-2" data-testid="leaders-provider-totals">
      <Translated locale={locale} message="competition.leaders.providerTotals" />
    </p>
  );
}

/** The boards beyond goals (T-943), in the order the page shows them. */
export const BOARDS = [
  {
    key: 'assists',
    testId: 'board-assists',
    title: 'competition.boards.assists',
    none: 'competition.boards.noAssists',
  },
  {
    key: 'clean_sheets',
    testId: 'board-clean-sheets',
    title: 'competition.boards.cleanSheets',
    none: 'competition.boards.noCleanSheets',
  },
  {
    key: 'yellow_cards',
    testId: 'board-yellow-cards',
    title: 'competition.boards.yellowCards',
    none: 'competition.boards.noYellowCards',
  },
  {
    key: 'red_cards',
    testId: 'board-red-cards',
    title: 'competition.boards.redCards',
    none: 'competition.boards.noRedCards',
  },
] as const;

/** A board's rows with each one's own figure. */
export function BoardList({
  rows,
  board,
  locale,
}: {
  rows: BoardPlayer[];
  board: (typeof BOARDS)[number]['key'];
  locale: string;
}) {
  return (
    <ol className="flex flex-col">
      {rows.map((row, index) => (
        <PlayerRow
          key={`${row.person.id}:${row.team?.id ?? ''}`}
          locale={locale}
          place={index + 1}
          row={row}
          figure={<BoardFigure locale={locale} row={row} board={board} />}
        />
      ))}
    </ol>
  );
}

/** A board row's own figure: assists, clean sheets over starts in goal, yellows or reds. */
function BoardFigure({
  locale,
  row,
  board,
}: {
  locale: string;
  row: BoardPlayer;
  board: (typeof BOARDS)[number]['key'];
}) {
  if (board === 'assists' && 'assists' in row) {
    return <Figure locale={locale} value={row.assists} />;
  }
  if (board === 'clean_sheets' && 'clean_sheets' in row) {
    return (
      <span className="flex items-baseline gap-2">
        <span className="text-xs text-muted">
          <Translated
            locale={locale}
            message="competition.boards.startsInGoal"
            count={row.starts_in_goal}
          />
        </span>
        <Figure locale={locale} value={row.clean_sheets} />
      </span>
    );
  }
  if (board === 'yellow_cards' && 'yellow_cards' in row) {
    return <Figure locale={locale} value={row.yellow_cards} />;
  }
  if (board === 'red_cards' && 'red_cards' in row) {
    return <Figure locale={locale} value={row.red_cards} />;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The season in figures
// ---------------------------------------------------------------------------

/**
 * The season in figures (T-1385), counted from the stored results: goals per
 * match, draws, home wins and goalless draws, each tile its figure and what
 * it is over. No result with a score is a sentence, never four noughts.
 */
export function LeagueNumbersPanel({
  numbers,
  locale,
}: {
  numbers: LeagueNumbers;
  locale: string;
}) {
  const n = numbers.counted;
  const tiles: { value: string; label: string; testId: string }[] = [
    {
      value: perMatch(locale, numbers.goals, n),
      label: say(locale, 'competitionPage.numbers.goals'),
      testId: 'numbers-goals',
    },
    {
      value: sharePercent(locale, numbers.draws, n),
      label: say(locale, 'competitionPage.numbers.draws', {
        draws: formatNumber(locale, numbers.draws),
        matches: formatNumber(locale, n),
      }),
      testId: 'numbers-draws',
    },
    {
      value: sharePercent(locale, numbers.homeWins, n),
      label: say(locale, 'competitionPage.numbers.homeWins'),
      testId: 'numbers-home-wins',
    },
    {
      value: formatNumber(locale, numbers.goalless),
      label: say(locale, 'competitionPage.numbers.goalless'),
      testId: 'numbers-goalless',
    },
  ];
  return (
    <Panel
      testId="numbers"
      title={say(locale, 'competitionPage.numbers.title')}
      aside={<Coverage locale={locale} state={numbers.coverage} />}
    >
      {n === 0 ? (
        <p className="text-sm text-muted" data-testid="numbers-empty">
          <Translated
            locale={locale}
            message={
              numbers.qualifying > 0
                ? 'competitionPage.numbers.noneMain'
                : 'competitionPage.numbers.none'
            }
          />
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {tiles.map((tile) => (
              <div
                key={tile.testId}
                className="rounded-tile bg-surface-raised p-3.5"
                data-testid={tile.testId}
              >
                <b className="block font-sans text-display-1 leading-none font-black font-stretch-condensed tabular-nums">
                  <bdi>{tile.value}</bdi>
                </b>
                <span className="text-sm font-semibold text-muted">{tile.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted" data-testid="numbers-over">
            <Translated
              locale={locale}
              message={
                numbers.qualifying > 0
                  ? 'competitionPage.numbers.overMain'
                  : 'competitionPage.numbers.over'
              }
              count={n}
            />
            {numbers.unscored > 0 && (
              <>
                {' '}
                <Translated
                  locale={locale}
                  message="competitionPage.numbers.unscored"
                  count={numbers.unscored}
                />
              </>
            )}
            {numbers.qualifying > 0 && (
              <>
                {' '}
                <Translated
                  locale={locale}
                  message="competitionPage.numbers.qualifying"
                  count={numbers.qualifying}
                />
              </>
            )}
          </p>
        </>
      )}
    </Panel>
  );
}

/** The season's declared coverage per module, each a badge (rule 3), and the last data update. */
export function CoveragePanel({
  page,
  locale,
  timeZone,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
}) {
  const modules = Object.entries(page.coverage);
  return (
    <Panel
      testId="coverage"
      title={<Translated locale={locale} message="competitionPage.coverage" />}
    >
      {modules.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="competitionPage.noCoverage" />
        </p>
      ) : (
        <ul className="flex flex-col">
          {modules.map(([module, state]) => (
            <li
              key={module}
              className="flex items-center justify-between gap-3 border-b border-default py-2 text-sm last:border-b-0"
              data-module={module}
            >
              <span className="first-letter:uppercase">{moduleName(locale, module)}</span>
              <Coverage locale={locale} state={state} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        {page.last_updated_at === null ? (
          <Translated locale={locale} message="competitionPage.noData" />
        ) : (
          <>
            <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
            <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
          </>
        )}
      </p>
    </Panel>
  );
}

/** The coverage modules a season declares, in the match centre's words; an unknown one by its key. */
const MODULE_KEY: Record<string, MessageKey> = {
  scores: 'matchCentre.module.scores',
  incidents: 'matchCentre.module.incidents',
  lineups: 'matchCentre.module.lineups',
  statistics: 'matchCentre.module.statistics',
  standings: 'matchCentre.module.standings',
  availability: 'matchCentre.module.availability',
  advanced_statistics: 'matchCentre.module.advancedStatistics',
};

function moduleName(locale: string, module: string): string {
  const key = MODULE_KEY[module];
  return key === undefined ? module.replace(/_/g, ' ') : say(locale, key);
}

/**
 * Under a cup's boards (T-1394, D-209): they count the main competition, from
 * the league or group stage on, and the qualifying rounds' matches are not in
 * them. Nothing for a season with no qualifying match.
 */
export function QualifyingNote({
  results,
  locale,
}: {
  results: readonly Pick<SeasonFixture, 'qualifying'>[];
  locale: string;
}) {
  const qualifying = results.length - mainResults(results).length;
  if (qualifying === 0) return null;
  return (
    <p className="text-xs text-muted" data-testid="boards-main-phase">
      <Translated locale={locale} message="competitionPage.boards.mainPhase" count={qualifying} />
    </p>
  );
}
