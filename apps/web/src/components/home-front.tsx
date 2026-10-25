import type {
  CommunityConsensusResponse,
  ForecastVersion,
  FounderAnalysisResponse,
  ScoreCard,
  TableRow,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import { CommunityPicksBrief } from '@/components/community-consensus';
import { EntityImage } from '@/components/entity-image';
import { ForecastBar } from '@/components/forecast-bar';
import { FounderAnalysisBrief } from '@/components/founder-analysis';
import { MessageText } from '@/components/message-text';
import { CommunityVoice, ModelVoice, ThreeProductsNote } from '@/components/voices';
import { Score, ScorePair } from '@/components/score';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink, CoverageBadge, Icon } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, plural, t } from '@/i18n/messages';
import { factorLabel, kindLabel } from '@/lib/forecast';
import { type HeroMatch, type HeroSlot, type KeyGroup, sharedRound, topFactors } from '@/lib/home';
import { stageName } from '@/lib/competition';
import type { CardForecast } from '@/lib/score-card-products';
import { formatKickoff, statusLabel } from '@/lib/scores';
import { formatFixed, formatPercent, formatSigned } from '@/lib/words';
import { zoneWords } from '@/lib/reader-time-zone';
import { forecastBarWords, scoresWords } from '@/lib/words-server';

/**
 * The home page's main column in the Stadiomind design (T-1495, D-263, D-270;
 * the canvas boards Home and HomePhone): the day's heading, the matches in
 * play, the big match with the model's forecast and the other two voices kept
 * apart, and today by competition. Server components only: no script reaches
 * the reader for any of it.
 *
 * Every block says what it does not have (rule 3): no forecast is the bar's
 * sentence, an empty lane says so, and a block with nothing to show is left
 * out rather than drawn empty.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** "UK time", "Tehran time", "UTC" or "<city> time" (D-207): one wording on every page. */
export function zoneName(locale: Locale, timeZone: string): string {
  return zoneWords(locale, timeZone);
}

/** A section's heading: Archivo, heavy and a little wide, and a quiet note at the end. */
export function RuleHeading({
  id,
  title,
  aside,
  level = 2,
  size = 'md',
}: {
  id?: string;
  title: ReactNode;
  aside?: ReactNode;
  level?: 2 | 3;
  size?: 'md' | 'lg';
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <H
        id={id}
        className={cx(
          'leading-tight font-extrabold font-stretch-semi-expanded',
          size === 'lg' ? 'text-3xl' : 'text-[1.375rem]',
        )}
      >
        {title}
      </H>
      {aside !== undefined && <span className="text-sm text-caption">{aside}</span>}
    </div>
  );
}

/**
 * The page's own heading: "Today", then the day and time in the reader's zone.
 * The `<h1>` keeps the inline-start accent bar the RTL check measures.
 */
export function HomeDateline({
  locale,
  timeZone,
  now,
}: {
  locale: string;
  timeZone: string;
  now: string;
}) {
  const l = asLocale(locale);
  // The weekday apart from the date: ICU joins the two with a comma, and in
  // Persian puts the year first; "Saturday 24 October" and «شنبه ۲ آبان».
  const date = `${formatDate(l, now, timeZone, { weekday: 'long' })} ${formatDate(
    l,
    now,
    timeZone,
    {
      day: 'numeric',
      month: 'long',
    },
  )}`;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1
        className="border-s-4 border-s-accent ps-4 text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded"
        data-testid="title"
      >
        <Translated locale={l} message="home.title" />
      </h1>
      <p className="text-sm text-muted">
        <time dateTime={now}>
          {date} · {formatKickoff(l, now, timeZone)}
        </time>{' '}
        {zoneName(l, timeZone)}
      </p>
    </div>
  );
}

/**
 * A match's status where its time would be: the minute in play, FT or
 * postponed; a live answer gone stale says "behind" beside its minute (rule 4).
 */
function status(card: ScoreCard, locale: Locale, timeZone: string): string {
  const words = scoresWords(locale).m;
  const label = statusLabel(card, locale, timeZone, undefined, words);
  return card.status === 'live' && card.freshness === 'stale'
    ? `${label} · ${words['status.behind'].text}`
    : label;
}

/**
 * "Live now · 3" (D-270): every match in play as a chip with its minute and
 * score, each opening its match, and when the live answer was last heard from
 * (rule 4); a chip whose answer is behind says "behind" for its minute. Not
 * drawn when nothing is in play.
 */
export function LiveNow({
  cards,
  total,
  checkedAt,
  scoresHref,
  locale,
  timeZone,
}: {
  /** The chips, at most `LIVE_STRIP`. */
  cards: readonly ScoreCard[];
  /** Every match in play. */
  total: number;
  checkedAt: string | null;
  scoresHref: string;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  return (
    <section
      aria-labelledby="home-live"
      data-testid="home-live"
      className="flex flex-wrap items-center gap-2.5"
    >
      <h2
        id="home-live"
        className="flex items-center gap-2 text-sm font-extrabold tracking-wide text-live uppercase"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
        <Translated locale={l} message="home.live.title" />
        {/* A badge, not "· 3": beside a Persian digit the dot reads as a zero. */}
        <span
          className="rounded-pill bg-accent px-1.5 text-xs leading-5 font-extrabold text-on-accent tabular-nums"
          data-testid="home-live-count"
        >
          {formatNumber(l, total)}
        </span>
      </h2>
      <ul className="contents">
        {cards.map((card) => (
          <li key={card.id} className="min-w-0">
            <Link
              href={`/${locale}/match/${card.id}`}
              data-testid="home-live-chip"
              className="flex min-h-touch flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-control border border-default bg-surface px-3 py-2 text-sm font-semibold font-stretch-semi-condensed hover:border-strong"
            >
              <span className="font-extrabold text-live tabular-nums">
                {status(card, l, timeZone)}
                <span className="font-semibold text-caption md:hidden">
                  {' · '}
                  <bdi>{card.competition.short_name ?? card.competition.name}</bdi>
                </span>
              </span>
              <span>
                <bdi>{card.home.name}</bdi>{' '}
                {card.scores.current !== null && (
                  <Score
                    home={card.scores.current.home}
                    away={card.scores.current.away}
                    locale={l}
                    className="font-extrabold font-stretch-condensed"
                  />
                )}{' '}
                <bdi>{card.away.name}</bdi>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > cards.length && (
        <Link href={scoresHref} className="text-sm font-bold text-accent hover:underline">
          <Translated locale={l} message="home.live.all" />
        </Link>
      )}
      {checkedAt !== null && (
        <span
          className="ms-auto font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
          data-testid="home-live-updated"
        >
          <span aria-hidden="true">● </span>
          <MessageText
            message={{
              ...message(l, 'home.live.updated'),
              text: interpolate(t(l, 'home.live.updated'), {
                time: formatKickoff(l, checkedAt, timeZone),
              }),
            }}
          />
        </span>
      )}
    </section>
  );
}

/** "1st of 16 · 16 pts" under a team's name, from the league table, or nothing. */
function standing(locale: Locale, row: TableRow | null, total: number): string | null {
  if (row === null) return null;
  return interpolate(t(locale, 'teamPage.contextLine'), {
    position: plural(locale, 'team.position', row.position).text,
    total: formatNumber(locale, total),
    points: formatNumber(locale, row.points),
  });
}

const SLOT_KEY: Record<HeroSlot, MessageKey> = {
  live: 'home.live.title',
  today: 'home.hero.today',
  tomorrow: 'home.hero.tomorrow',
  later: 'home.hero.later',
};

/** A label over a figure in the model's block. */
function Figure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-caption">{label}</span>
      {children}
    </div>
  );
}

/**
 * What the version adds to the bar: the expected goals, the likeliest scores,
 * what moved it most and its receipt (blueprint 6.2: whose version, of what
 * kind, on how many matches). Only what the version stored; nothing here is
 * worked out on the page.
 */
function ModelFigures({
  version,
  home,
  away,
  live,
  locale,
}: {
  version: ForecastVersion;
  home: string;
  away: string;
  live: boolean;
  locale: Locale;
}) {
  const factors = topFactors(version);
  const widest = Math.max(...factors.map((f) => Math.abs(f.magnitude)), Number.EPSILON);
  const scorelines = (version.most_likely_scorelines ?? []).slice(0, 3);
  const nextVersion = !live && (version.kind === 'early' || version.kind === 'lineups_predicted');
  return (
    <>
      {(version.expected_goals !== null || scorelines.length > 0) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9.5rem,100%),1fr))] gap-4">
          {version.expected_goals !== null && (
            <Figure label={<Translated locale={locale} message="home.hero.xg" />}>
              <ScorePair
                locale={locale}
                className="text-2xl leading-none font-extrabold font-stretch-condensed tabular-nums"
                testId="home-hero-xg"
              >
                {formatFixed(locale, version.expected_goals.home, 2)}
                {' – '}
                {formatFixed(locale, version.expected_goals.away, 2)}
              </ScorePair>
            </Figure>
          )}
          {scorelines.length > 0 && (
            <Figure label={<Translated locale={locale} message="home.hero.scorelines" />}>
              <ul className="flex flex-wrap gap-1.5 text-sm font-bold tabular-nums">
                {scorelines.map((line) => (
                  <li
                    key={`${line.home}-${line.away}`}
                    className="rounded-control border border-default bg-surface-raised px-2 py-0.5"
                    data-testid="home-hero-scoreline"
                  >
                    <Score home={line.home} away={line.away} locale={locale} />{' '}
                    <span className="font-medium text-caption">
                      {formatPercent(locale, line.probability * 100)}
                    </span>
                  </li>
                ))}
              </ul>
            </Figure>
          )}
        </div>
      )}
      {factors.length > 0 && (
        <Figure label={<Translated locale={locale} message="home.hero.factors" />}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {factors.map((factor) => (
              <li
                key={factor.factor}
                className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_3rem] items-center gap-x-3"
                data-testid="home-hero-factor"
              >
                <span className="text-muted">
                  {factorLabel(factor.factor, locale)}
                  {factor.favours !== 'neither' && (
                    <span className="sr-only">
                      {' '}
                      {interpolate(t(locale, 'home.hero.favours'), {
                        team: factor.favours === 'home' ? home : away,
                      })}
                    </span>
                  )}
                </span>
                <span aria-hidden="true" className="h-1.5 rounded-pill bg-surface-raised">
                  <span
                    className="block h-1.5 rounded-pill bg-model"
                    style={{ inlineSize: `${(Math.abs(factor.magnitude) / widest) * 100}%` }}
                  />
                </span>
                <span className="font-mono text-xs text-model" dir="ltr">
                  {formatSigned(locale, factor.magnitude, 2)}
                </span>
              </li>
            ))}
          </ul>
        </Figure>
      )}
      <p
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-default pt-2.5 font-mono text-xs leading-relaxed text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        data-testid="home-hero-receipt"
      >
        <span>
          {interpolate(t(locale, 'home.hero.receipt'), {
            version: formatNumber(locale, version.version_number),
            kind: kindLabel(version.kind, locale),
            matches: formatNumber(locale, version.inputs?.matches_used ?? 0),
          })}
        </span>
        {version.data_completeness === 'limited' && (
          <CoverageBadge
            state="limited"
            label={<Translated locale={locale} message="status.coverage.limited" />}
          />
        )}
        {nextVersion && (
          <span className="text-caption">
            <Translated locale={locale} message="home.hero.nextVersion" />
          </span>
        )}
      </p>
    </>
  );
}

/**
 * The big match (D-263 point 4, D-270): when and where, both teams with their
 * place in the table, the kick-off or the score, then the three voices each in
 * its own lane (rule 6): the model's bar with what its last pre-kick-off
 * version stored, the founder's analysis or that there is none, and the
 * members' picks, whose split shows only after the reader's own pick.
 */
export function BigMatch({
  hero,
  forecast,
  version,
  homeRow,
  awayRow,
  tableSize,
  note,
  founder,
  consensus,
  revealed,
  locale,
  timeZone,
}: {
  hero: HeroMatch;
  forecast: CardForecast;
  /** The version the bar is of, with its figures; `null` when it could not be read. */
  version: ForecastVersion | null;
  homeRow: TableRow | null;
  awayRow: TableRow | null;
  tableSize: number;
  /** The editor's note when the match is featured (D-153). */
  note: string | null;
  founder: FounderAnalysisResponse | null;
  consensus: CommunityConsensusResponse | null;
  revealed: boolean;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const { card, slot } = hero;
  const started = card.status !== 'scheduled';
  const match = `/${locale}/match/${card.id}`;
  const round = card.round === null ? null : stageName(locale, card.round);
  const day =
    slot === 'today' || slot === 'live'
      ? t(l, 'scores.today')
      : formatDate(l, card.kickoff_at, timeZone, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
  const side = (team: ScoreCard['home'], line: string | null, end: boolean) => (
    <div
      className={cx(
        'flex min-w-0 flex-col items-center gap-2 text-center md:gap-4',
        end ? 'md:flex-row-reverse md:text-end' : 'md:flex-row md:text-start',
      )}
    >
      <EntityImage media={team.crest} kind="crest" name={team.name} size={48} aboveFold />
      <span className="flex min-w-0 flex-col gap-1">
        <b className="text-lg leading-none font-extrabold [overflow-wrap:anywhere] md:text-display-1">
          <bdi>{team.name}</bdi>
        </b>
        {line !== null && <span className="text-xs text-muted md:text-sm">{line}</span>}
      </span>
    </div>
  );
  return (
    <article
      className="overflow-hidden rounded-tile border border-default bg-surface"
      data-testid="home-hero"
      data-slot={slot}
      aria-labelledby="home-hero-title"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-default px-4 py-3.5 text-sm text-muted md:px-6">
        <span
          className="text-xs font-extrabold tracking-widest text-live uppercase"
          data-testid="home-hero-slot"
        >
          <Translated locale={l} message={SLOT_KEY[slot]} />
        </span>
        <span>
          <bdi>{card.competition.short_name ?? card.competition.name}</bdi>
          {round !== null && (
            <>
              {' · '}
              <bdi>{round}</bdi>
            </>
          )}
        </span>
        <span>
          {day} · {formatKickoff(l, card.kickoff_at, timeZone)} {zoneName(l, timeZone)}
        </span>
        {card.venue !== null && (
          <span>
            {/* One isolate (T-1479): two Latin names in a Persian line put the
                comma between them on the wrong side. */}
            <bdi>
              {card.venue.city === null
                ? card.venue.name
                : `${card.venue.name}, ${card.venue.city}`}
            </bdi>
          </span>
        )}
        <span className="flex items-center gap-2 text-xs text-caption md:ms-auto">
          <Translated locale={l} message="home.lead.coverage" />
          <CoverageBadge
            state={card.coverage}
            label={<Translated locale={l} message={COVERAGE_KEY[card.coverage]} />}
          />
        </span>
      </div>
      {note !== null && (
        <p className="px-4 pt-3 text-sm md:px-6" data-testid="home-featured-note">
          <span className="font-semibold">
            <Translated locale={l} message="home.featured" />
          </span>
          : {note}
        </p>
      )}
      <h2 id="home-hero-title" className="sr-only">
        {interpolate(t(l, 'home.fixture'), { home: card.home.name, away: card.away.name })}
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 pt-6 pb-2 md:gap-6 md:px-6 md:pt-7">
        {side(card.home, standing(l, homeRow, tableSize), false)}
        <div className="flex flex-col items-center gap-1 text-center">
          {card.scores.current !== null ? (
            <Score
              home={card.scores.current.home}
              away={card.scores.current.away}
              locale={l}
              className="text-display-2 leading-none font-extrabold font-stretch-condensed tabular-nums"
              testId="home-hero-score"
            />
          ) : (
            <span className="text-3xl leading-none font-extrabold font-stretch-condensed tabular-nums md:text-display-2">
              {formatKickoff(l, card.kickoff_at, timeZone)}
            </span>
          )}
          {started ? (
            <span
              className={cx(
                'text-xs font-bold',
                card.status === 'live' ? 'text-live' : 'text-muted',
              )}
              data-testid="home-hero-status"
            >
              {status(card, l, timeZone)}
            </span>
          ) : (
            <span className="text-xs text-caption">{zoneName(l, timeZone)}</span>
          )}
        </div>
        {side(card.away, standing(l, awayRow, tableSize), true)}
      </div>
      <div className="flex flex-wrap gap-4 p-4 md:p-6">
        <ModelVoice locale={l} className="min-w-0 flex-[3_1_26rem]">
          <p className="text-sm text-muted">
            <Translated locale={l} message="home.hero.model" />
          </p>
          <ForecastBar
            forecast={forecast}
            home={card.home.name}
            away={card.away.name}
            started={started}
            locale={l}
            timeZone={timeZone}
            zone={zoneName(l, timeZone)}
            words={forecastBarWords(l)}
          />
          {forecast.state === 'available' && version !== null && (
            <ModelFigures
              version={version}
              home={card.home.name}
              away={card.away.name}
              live={started}
              locale={l}
            />
          )}
        </ModelVoice>
        <div className="flex min-w-0 flex-[2_1_17rem] flex-col gap-4">
          <FounderAnalysisBrief
            analysis={founder}
            home={card.home.name}
            away={card.away.name}
            href={`${match}#analysis`}
            timeZone={timeZone}
            locale={l}
          />
          <CommunityVoice locale={l}>
            <CommunityPicksBrief
              consensus={consensus}
              revealed={revealed}
              home={card.home.name}
              away={card.away.name}
              href={match}
              locale={l}
            />
          </CommunityVoice>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 md:px-6 md:pb-6">
        <ThreeProductsNote locale={l} />
        <ButtonLink href={match} variant="secondary" size="md">
          <Translated locale={l} message="home.lead.open" />
          <Icon name="forward" />
        </ButtonLink>
      </div>
    </article>
  );
}

/** One match of a competition's card: status, the two teams stacked, each one's goals beside it. */
function TodayRow({
  card,
  locale,
  timeZone,
}: {
  card: ScoreCard;
  locale: Locale;
  timeZone: string;
}) {
  const score = card.scores.current;
  const finished = card.status === 'finished' && score !== null;
  const won = (side: 'home' | 'away') =>
    finished && score[side] > score[side === 'home' ? 'away' : 'home'];
  const lost = (side: 'home' | 'away') =>
    finished && score[side] < score[side === 'home' ? 'away' : 'home'];
  const team = (side: 'home' | 'away') => (
    <span
      className={cx(
        'flex min-w-0 items-center gap-2',
        won(side) && 'font-bold',
        lost(side) && 'text-muted',
      )}
    >
      <EntityImage media={card[side].crest} kind="crest" name={card[side].name} size={20} />
      <bdi className="truncate">{card[side].name}</bdi>
    </span>
  );
  const goals = (side: 'home' | 'away') =>
    score === null ? null : (
      <span className={cx(lost(side) && 'text-muted')}>{formatNumber(locale, score[side])}</span>
    );
  return (
    <li className="border-b border-default last:border-b-0">
      <Link
        href={`/${locale}/match/${card.id}`}
        className="grid min-h-touch grid-cols-[2.75rem_minmax(0,1fr)_1.75rem] items-center gap-3 px-4 py-2.5 hover:bg-surface-raised"
        data-testid="home-today-row"
        data-status={card.status}
      >
        <span
          className={cx(
            'text-sm font-bold tabular-nums',
            card.status === 'live' ? 'font-extrabold text-live' : 'text-muted',
          )}
        >
          {card.status === 'scheduled'
            ? formatKickoff(locale, card.kickoff_at, timeZone)
            : status(card, locale, timeZone)}
        </span>
        <span className="flex min-w-0 flex-col gap-1.5 text-[0.9375rem] font-semibold font-stretch-semi-condensed">
          {team('home')}
          {team('away')}
        </span>
        <span
          aria-hidden="true"
          className={cx(
            'flex flex-col items-end gap-1.5 text-base font-extrabold font-stretch-condensed tabular-nums',
            card.status === 'live' && 'text-live',
          )}
        >
          {goals('home')}
          {goals('away')}
        </span>
        {score !== null && (
          <span className="sr-only">
            <Score home={score.home} away={score.away} locale={locale} />
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Today by competition (D-270): each competition of the day as a card, in the
 * competitions' order (D-154), a member's own teams first in a card of their
 * own; per match the status, both teams and the goals beside each, winners in
 * bold; the round when the whole card shares one; what is left out is counted
 * and the scores page has it.
 */
export function TodayByCompetition({
  groups,
  isToday,
  day,
  total,
  scoresHref,
  locale,
  timeZone,
}: {
  groups: KeyGroup[];
  isToday: boolean;
  /** The day shown, `YYYY-MM-DD`, for a heading that is not today. */
  day: string;
  /** Every match of the day, for "All N matches". */
  total: number;
  scoresHref: string;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const title = isToday ? (
    <Translated locale={l} message="home.today.title" />
  ) : (
    <MessageText
      message={{
        ...message(l, 'home.today.titleOn'),
        text: interpolate(t(l, 'home.today.titleOn'), {
          day: formatDate(l, `${day}T12:00:00Z`, 'UTC', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }),
        }),
      }}
    />
  );
  return (
    <section aria-labelledby="home-today" data-testid="home-matches">
      <RuleHeading
        id="home-today"
        title={title}
        aside={
          <Link
            href={scoresHref}
            className="inline-flex min-h-touch items-center gap-1.5 text-sm font-bold text-accent hover:underline"
          >
            <Translated locale={l} message="home.today.all" count={total} />
            <Icon name="forward" />
          </Link>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(23.75rem,100%),1fr))] gap-4">
        {groups.map((group) => {
          const id = `home-today-${group.competition?.id ?? 'yours'}`;
          const round = group.kind === 'competition' ? sharedRound(group.cards) : null;
          const roundName = round === null ? null : stageName(locale, round);
          return (
            <section
              key={group.competition?.id ?? 'yours'}
              aria-labelledby={id}
              data-testid="home-today-group"
              data-kind={group.kind}
              className="overflow-hidden rounded-tile border border-default bg-surface"
            >
              <h3
                id={id}
                className="flex items-center gap-2.5 border-b border-default px-4 py-3 text-sm font-bold"
              >
                {group.competition !== null && (
                  <EntityImage
                    media={group.competition.logo}
                    kind="logo"
                    name={group.competition.name}
                    size={20}
                  />
                )}
                {group.kind === 'yours' ? (
                  <Translated locale={l} message="home.key.yours" />
                ) : (
                  <bdi>{group.competition?.name}</bdi>
                )}
                <span className="ms-auto text-xs font-medium text-caption">
                  {roundName !== null && group.more === 0 ? (
                    <bdi>{roundName}</bdi>
                  ) : (
                    <Translated
                      locale={l}
                      message="home.today.count"
                      count={group.cards.length + group.more}
                    />
                  )}
                </span>
              </h3>
              <ul>
                {group.cards.map((card) => (
                  <TodayRow key={card.id} card={card} locale={l} timeZone={timeZone} />
                ))}
              </ul>
              {group.more > 0 && (
                <Link
                  href={scoresHref}
                  className="flex min-h-touch items-center border-t border-default px-4 py-3 text-sm font-bold text-accent hover:underline"
                >
                  <Translated locale={l} message="home.today.more" count={group.more} />
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
