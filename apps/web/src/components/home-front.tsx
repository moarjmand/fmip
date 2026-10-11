import type {
  CommunityConsensusResponse,
  FounderAnalysisResponse,
  NewsStoryCard,
  ScoreCard,
  TableRow,
} from '@fmip/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CommunityPicksBrief } from '@/components/community-consensus';
import { EntityImage } from '@/components/entity-image';
import { ForecastBar } from '@/components/forecast-bar';
import { FounderAnalysisBrief } from '@/components/founder-analysis';
import { MessageText } from '@/components/message-text';
import { NewsPhoto } from '@/components/news-image';
import { CommunityLane, ModelLane, ThreeProductsNote } from '@/components/product-lanes';
import { Score } from '@/components/score';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink, CoverageBadge, Icon } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import type { KeyGroup } from '@/lib/home';
import { storyHref } from '@/lib/news';
import type { CardForecast } from '@/lib/score-card-products';
import { dateIn, formatKickoff, statusLabel } from '@/lib/scores';
import { formatPercent } from '@/lib/words';
import { forecastBarWords, scoresWords } from '@/lib/words-server';

/**
 * The homepage's main column in the Hybrid design (T-1382, D-200; boards h1
 * and h9): the dateline, the lead story, the day's biggest match, the three
 * forecasts kept apart and today's key matches. Server components only: no
 * script reaches the reader for any of it.
 *
 * Every block says what it does not have (rule 3): a match with no forecast
 * gets blank cells and a note, a lane with nothing in it a sentence.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** "Tehran time", or "<city> time" for any other zone (the next-match card's words). */
export function zoneName(locale: Locale, timeZone: string): string {
  return timeZone === 'Asia/Tehran'
    ? t(locale, 'nextMatch.tehranTime')
    : interpolate(t(locale, 'nextMatch.zoneTime'), {
        zone: timeZone.split('/').at(-1)?.replace(/_/g, ' ') ?? timeZone,
      });
}

/** A section's heading on the ink rule: the serif title, and a quiet note at the end. */
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
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t-2 border-fg pt-2.5">
      <H
        id={id}
        className={cx('font-serif font-semibold', size === 'lg' ? 'text-3xl' : 'text-2xl')}
      >
        {title}
      </H>
      {aside !== undefined && <span className="text-sm text-caption">{aside}</span>}
    </div>
  );
}

/**
 * The page's own heading and the date line under the header: "Today", then
 * the day and time in the reader's zone, and the lead match's competition.
 * The `<h1>` keeps the inline-start accent bar the RTL check measures.
 */
export function HomeDateline({
  locale,
  timeZone,
  now,
  context,
}: {
  locale: string;
  timeZone: string;
  now: string;
  /** "Persian Gulf Pro League · Matchweek 8", or nothing. */
  context: string | null;
}) {
  const l = asLocale(locale);
  // The weekday apart from the date: ICU joins the two with a comma, and in
  // Persian puts the year first ("۱۴۰۵ مهر ۱۶, پنجشنبه"); the board reads
  // "Thursday 8 October 2026" and «پنجشنبه ۱۶ مهر ۱۴۰۵».
  const date = `${formatDate(l, now, timeZone, { weekday: 'long' })} ${formatDate(
    l,
    now,
    timeZone,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  )}`;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-default py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1
          className="border-s-4 border-s-accent ps-4 font-serif text-2xl font-semibold"
          data-testid="title"
        >
          <Translated locale={l} message="home.title" />
        </h1>
        <p className="font-serif text-lg text-muted italic [:root:is(:lang(fa),:lang(ar))_&]:not-italic">
          <time dateTime={now}>
            {date} · {formatKickoff(l, now, timeZone)}
          </time>{' '}
          {zoneName(l, timeZone)}
        </p>
      </div>
      {context !== null && <p className="text-sm font-semibold text-muted">{context}</p>}
    </div>
  );
}

/**
 * The lead story (D-200): the newest story an editor marked breaking, in the
 * publisher's words and language, with its photo and credit where the
 * licence covers it, and the way to the story page.
 */
export function LeadStory({
  story,
  locale,
  timeZone,
}: {
  story: NewsStoryCard;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const at = story.published_at ?? story.breaking?.marked_at ?? null;
  return (
    <article className="flex flex-col gap-3" data-testid="home-lead-story">
      <p className="text-xs font-bold tracking-widest text-accent uppercase">
        <Translated locale={l} message="news.breaking.title" />
        {story.breaking !== null && (
          <span className="font-semibold tracking-normal text-muted normal-case">
            {' · '}
            {story.breaking.note}
          </span>
        )}
      </p>
      <h2
        className="font-serif text-display-2 font-semibold md:text-display-4"
        lang={story.language}
      >
        <Link href={storyHref(locale, story.story_id)} className="hover:underline">
          {story.headline}
        </Link>
      </h2>
      {story.summary !== null && (
        <p className="font-serif text-xl text-muted" lang={story.language}>
          {story.summary}
        </p>
      )}
      <p className="text-sm text-caption">
        <bdi>{story.source.name}</bdi>
        {at !== null && (
          <>
            {' · '}
            <time dateTime={at}>
              {formatDate(l, at, timeZone, { day: 'numeric', month: 'short' })}{' '}
              {formatKickoff(l, at, timeZone)}
            </time>
          </>
        )}
      </p>
      <NewsPhoto image={story.image} headline={story.headline} locale={locale} />
    </article>
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

/**
 * The day's biggest match as the lead card (D-200): competition and round,
 * kick-off in the reader's zone, the venue, both teams with their place in
 * the table when it is known, the model's bar with its version and time, the
 * scores coverage, and the two ways on.
 */
export function LeadMatchCard({
  card,
  forecast,
  homeRow,
  awayRow,
  tableSize,
  note,
  today,
  locale,
  timeZone,
}: {
  card: ScoreCard;
  forecast: CardForecast;
  homeRow: TableRow | null;
  awayRow: TableRow | null;
  tableSize: number;
  /** The editor's note when the match is featured (D-153). */
  note: string | null;
  today: string;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const words = scoresWords(l);
  const day =
    dateIn(timeZone, new Date(card.kickoff_at)) === today
      ? t(l, 'scores.today')
      : formatDate(l, card.kickoff_at, timeZone, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
  const competition = card.competition.short_name ?? card.competition.name;
  const started = card.status !== 'scheduled';
  const side = (
    name: string,
    crest: ScoreCard['home']['crest'],
    line: string | null,
    end: boolean,
  ) => (
    <span
      className={cx(
        'flex min-w-0 flex-col items-center gap-1.5 text-center md:flex-row md:gap-3',
        end ? 'md:justify-start md:text-start' : 'md:flex-row-reverse md:justify-start md:text-end',
      )}
    >
      <EntityImage media={crest} kind="crest" name={name} size={48} />
      <span className="flex min-w-0 flex-col">
        <b className="font-sans text-xl leading-tight font-black font-stretch-condensed uppercase [overflow-wrap:anywhere] md:text-display-1">
          <bdi>{name}</bdi>
        </b>
        {line !== null && <span className="text-sm text-muted">{line}</span>}
      </span>
    </span>
  );
  return (
    <article
      className="flex flex-col gap-4 border border-default border-t-3 border-t-fg bg-surface p-4 md:px-5.5 md:py-5"
      data-testid="home-lead-match"
      aria-labelledby="home-lead-match-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id="home-lead-match-title"
          className="font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans text-sm text-caption uppercase"
        >
          <bdi>{competition}</bdi>
          {card.round !== null && (
            <>
              {' · '}
              <bdi>{card.round}</bdi>
            </>
          )}
          {' · '}
          {day} {formatKickoff(l, card.kickoff_at, timeZone)} · {zoneName(l, timeZone)}
        </p>
        {card.venue !== null && (
          <p className="text-sm text-muted">
            <bdi>{card.venue.name}</bdi>
            {card.venue.city !== null && (
              <>
                {', '}
                <bdi>{card.venue.city}</bdi>
              </>
            )}
          </p>
        )}
      </div>
      {note !== null && (
        <p className="text-sm" data-testid="home-featured-note">
          <span className="font-semibold">
            <Translated locale={l} message="home.featured" />
          </span>
          : {note}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 md:gap-4">
        {side(card.home.name, card.home.crest, standing(l, homeRow, tableSize), false)}
        <span className="flex flex-col items-center gap-1 text-center">
          {card.scores.current !== null ? (
            <Score
              home={card.scores.current.home}
              away={card.scores.current.away}
              locale={l}
              className="font-sans text-display-1 font-black font-stretch-condensed tabular-nums"
              testId="home-lead-score"
            />
          ) : (
            <span className="text-lg text-caption">
              <Translated locale={l} message="home.versus" />
            </span>
          )}
          {started && (
            <span
              className={cx(
                'text-xs font-bold',
                card.status === 'live' ? 'text-live' : 'text-muted',
              )}
            >
              {statusLabel(card, l, timeZone, undefined, words.m)}
            </span>
          )}
          {card.freshness === 'stale' && (
            <span className="text-xs font-bold text-warning">
              <Translated locale={l} message="status.behind" />
            </span>
          )}
        </span>
        {side(card.away.name, card.away.crest, standing(l, awayRow, tableSize), true)}
      </div>
      <ForecastBar
        forecast={forecast}
        home={card.home.name}
        away={card.away.name}
        started={started}
        locale={l}
        timeZone="UTC"
        words={forecastBarWords(l)}
      />
      <p className="flex flex-wrap items-center gap-2 text-xs text-caption">
        <Translated locale={l} message="home.lead.coverage" />
        <CoverageBadge
          state={card.coverage}
          label={<Translated locale={l} message={COVERAGE_KEY[card.coverage]} />}
        />
      </p>
      <div className="flex flex-wrap gap-2.5">
        <ButtonLink href={`/${locale}/match/${card.id}`} variant="primary" size="md">
          <Translated locale={l} message="home.lead.open" />
          <Icon name="forward" />
        </ButtonLink>
        <ButtonLink href={`/${locale}/about#model`} variant="secondary" size="md">
          <Translated locale={l} message="home.lead.how" />
        </ButtonLink>
      </div>
    </article>
  );
}

/**
 * "Three forecasts, kept apart" for the lead match (rule 6, D-206): the
 * model's bar in its lane, the founder's published analysis in theirs, the
 * members' picks in theirs (the count, the split only after the reader's own
 * pick), and the note that they are three products. Each lane is that
 * product's own component; nothing here takes "a forecast" from either.
 */
export function ThreeForecasts({
  card,
  forecast,
  founder,
  consensus,
  revealed,
  locale,
}: {
  card: ScoreCard;
  forecast: CardForecast;
  founder: FounderAnalysisResponse | null;
  consensus: CommunityConsensusResponse | null;
  revealed: boolean;
  locale: string;
}) {
  const l = asLocale(locale);
  const match = `/${locale}/match/${card.id}`;
  return (
    <section aria-labelledby="home-three" data-testid="home-three">
      <RuleHeading
        id="home-three"
        title={<Translated locale={l} message="home.three.title" />}
        aside={
          <>
            <bdi>{card.home.name}</bdi> <Translated locale={l} message="home.versus" />{' '}
            <bdi>{card.away.name}</bdi>
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        <ModelLane locale={l}>
          <ForecastBar
            forecast={forecast}
            home={card.home.name}
            away={card.away.name}
            started={card.status !== 'scheduled'}
            locale={l}
            timeZone="UTC"
            words={forecastBarWords(l)}
            size="compact"
          />
        </ModelLane>
        <FounderAnalysisBrief
          analysis={founder}
          home={card.home.name}
          away={card.away.name}
          href={`${match}#analysis`}
          timeZone="UTC"
          locale={l}
        />
        <CommunityLane locale={l}>
          <CommunityPicksBrief
            consensus={consensus}
            revealed={revealed}
            home={card.home.name}
            away={card.away.name}
            href={match}
            locale={l}
          />
        </CommunityLane>
      </div>
      <ThreeProductsNote locale={l} className="mt-2.5" />
    </section>
  );
}

/** The highest of a row's three numbers is shaded deeper: the model's favourite, at a glance. */
function Cell({ value, top, locale }: { value: number; top: boolean; locale: Locale }) {
  return (
    <td className="p-0 text-center">
      <span
        className={cx(
          'block px-1 py-3 text-sm font-bold tabular-nums',
          top ? 'bg-model/25' : 'bg-model/10',
        )}
        dir="ltr"
      >
        {formatPercent(locale, value, 0)}
      </span>
    </td>
  );
}

function BlankCells({ locale }: { locale: Locale }) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <td key={index} className="p-0 text-center">
          <span className="block bg-surface-raised px-1 py-3 text-sm text-caption">
            {index === 0 ? (
              <span className="sr-only">
                <Translated locale={locale} message="home.key.noForecast" />
              </span>
            ) : null}
            <span aria-hidden="true">–</span>
          </span>
        </td>
      ))}
    </>
  );
}

/**
 * "Today's key matches" (D-200): every competition of the day, grouped, the
 * member's own teams first; per row the model's three percentages where a
 * forecast exists and blank cells where none does, with the reason said
 * under the table; the model's version and time, and the way to every
 * competition on the scores page.
 */
export function KeyMatches({
  groups,
  isToday,
  day,
  forecasts,
  notes,
  competitions,
  scoresHref,
  signedIn,
  locale,
  timeZone,
}: {
  groups: KeyGroup[];
  isToday: boolean;
  /** The key day, `YYYY-MM-DD`, for a heading that is not today. */
  day: string;
  forecasts: ReadonlyMap<string, CardForecast>;
  notes: ReadonlyMap<string, string>;
  competitions: number;
  scoresHref: string;
  signedIn: boolean;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const words = scoresWords(l);
  const rows = groups.flatMap((group) => group.cards);
  const available = rows.flatMap((card) => {
    const forecast = forecasts.get(card.id);
    return forecast?.state === 'available' ? [forecast] : [];
  });
  const latest = [...available].sort((a, b) => b.computed_at.localeCompare(a.computed_at))[0];
  const versions = [...new Set(available.map((forecast) => forecast.model_version))];
  const blanks = rows.length - available.length;
  const head = 'px-0 py-1.5 text-xs font-bold text-muted';
  const title = isToday ? (
    <Translated locale={l} message="home.key.title" />
  ) : (
    <MessageText
      message={{
        ...message(l, 'home.key.titleOn'),
        text: interpolate(t(l, 'home.key.titleOn'), {
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
    <section aria-labelledby="home-key" data-testid="home-matches">
      <RuleHeading
        id="home-key"
        title={title}
        aside={
          <>
            <Translated locale={l} message="home.key.model" /> · {zoneName(l, timeZone)}
          </>
        }
      />
      <p className="mb-1 text-sm text-muted">
        <Translated locale={l} message="home.key.intro" />
        {signedIn && (
          <>
            {' '}
            <Translated locale={l} message="home.key.introMember" />
          </>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th scope="col" className={cx(head, 'w-16 pe-2 text-start')}>
                <Translated locale={l} message="home.key.kickoff" />
              </th>
              <th scope="col" className={cx(head, 'text-start')}>
                <Translated locale={l} message="home.key.match" />
              </th>
              <th scope="col" className={cx(head, 'w-12 md:w-16')}>
                <Translated locale={l} message="home.key.home" />
              </th>
              <th scope="col" className={cx(head, 'w-12 md:w-16')}>
                <Translated locale={l} message="forecast.draw" />
              </th>
              <th scope="col" className={cx(head, 'w-12 md:w-16')}>
                <Translated locale={l} message="home.key.away" />
              </th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody
              key={group.competition?.id ?? 'yours'}
              data-testid="home-key-group"
              data-kind={group.kind}
            >
              <tr>
                <th
                  colSpan={5}
                  scope="colgroup"
                  className="border-b border-fg pt-4 pb-1.5 text-start text-xs font-extrabold tracking-widest uppercase"
                >
                  {group.kind === 'yours' ? (
                    <Translated locale={l} message="home.key.yours" />
                  ) : (
                    <bdi>{group.competition?.name}</bdi>
                  )}
                </th>
              </tr>
              {group.cards.map((card) => {
                const forecast = forecasts.get(card.id);
                const note = notes.get(card.id);
                return (
                  <tr key={card.id} className="border-b border-default" data-testid="home-key-row">
                    <td className="pe-2 font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans text-xs text-caption">
                      {card.status === 'scheduled'
                        ? formatKickoff(l, card.kickoff_at, timeZone)
                        : statusLabel(card, l, timeZone, undefined, words.m)}
                    </td>
                    <td className="pe-2">
                      <Link
                        href={`/${locale}/match/${card.id}`}
                        className="inline-flex min-h-touch flex-wrap items-center gap-x-1.5 py-1 text-sm font-semibold hover:underline"
                      >
                        <bdi>{card.home.name}</bdi>
                        {card.scores.current !== null ? (
                          <Score
                            home={card.scores.current.home}
                            away={card.scores.current.away}
                            locale={l}
                            className="font-extrabold"
                          />
                        ) : (
                          <span className="font-normal text-caption">
                            <Translated locale={l} message="home.versus" />
                          </span>
                        )}
                        <bdi>{card.away.name}</bdi>
                      </Link>
                      {note !== undefined && (
                        <span className="block pb-1 text-xs" data-testid="home-featured-note">
                          <span className="font-semibold">
                            <Translated locale={l} message="home.featured" />
                          </span>
                          : {note}
                        </span>
                      )}
                    </td>
                    {forecast?.state === 'available' ? (
                      (['home', 'draw', 'away'] as const).map((key) => (
                        <Cell
                          key={key}
                          value={forecast[key]}
                          top={
                            forecast[key] === Math.max(forecast.home, forecast.draw, forecast.away)
                          }
                          locale={l}
                        />
                      ))
                    ) : (
                      <BlankCells locale={l} />
                    )}
                  </tr>
                );
              })}
              {group.more > 0 && (
                <tr>
                  <td colSpan={5} className="py-1 text-xs text-caption">
                    <Translated locale={l} message="home.key.more" count={group.more} />
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
        {versions.map((version) => (
          <span key={version} dir="ltr" className="font-mono text-model">
            {version}
          </span>
        ))}
        {latest !== undefined && (
          <span className="font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans text-caption">
            <MessageText
              message={{
                ...message(l, 'forecastBar.computed'),
                text: interpolate(t(l, 'forecastBar.computed'), {
                  time: `${formatDate(l, latest.computed_at, 'UTC', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23',
                  })} UTC`,
                }),
              }}
            />
          </span>
        )}
        <CoverageBadge
          state={blanks === 0 ? 'available' : 'limited'}
          label={
            <Translated
              locale={l}
              message={blanks === 0 ? 'status.coverage.available' : 'status.coverage.limited'}
            />
          }
        />
        {blanks > 0 && (
          <span className="text-caption" data-testid="home-key-blank-note">
            <Translated locale={l} message="home.key.blankNote" count={blanks} />
          </span>
        )}
      </div>
      <Link
        href={scoresHref}
        className="inline-flex min-h-touch items-center gap-1.5 text-sm font-bold text-accent"
      >
        <Translated locale={l} message="home.key.all" count={competitions} />
        <Icon name="forward" />
      </Link>
    </section>
  );
}
