import type { Metadata } from 'next';
import {
  MAX_CONSENSUS_FIXTURES,
  type CommunityConsensusResponse,
  type Prediction,
  type ScoreCard,
  type ScoresResponse,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import { LiveScores } from '@/components/live-scores';
import {
  fetchConsensusList,
  fetchForecastSummaries,
  fetchFounderFeed,
  fetchIngestionHealth,
  fetchMe,
  fetchMyPredictions,
  fetchOwnPrediction,
  fetchScores,
  fetchViewingBatch,
} from '@/lib/api';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute, message, t, type MessageKey } from '@/i18n/messages';
import { feedTrouble } from '@/lib/live';
import {
  apiQuery,
  dayStrip,
  firstMatchDay,
  NEXT_DAY_WINDOWS,
  pageHref,
  readScoresQuery,
  scoresView,
  shiftDate,
  viewFlags,
  type ScoresView,
} from '@/lib/scores';
import { formatDate, formatNumber } from '@/i18n/format';
import {
  applyFilters,
  filterOptions,
  filterParams,
  isFiltered,
  isOpenForPick,
  NO_FILTERS,
  withSelected,
  type FilterOption,
} from '@/lib/scores-filters';
import { ownPredictions } from '@/lib/predictions-days';
import {
  cardIds,
  loadCardForecasts,
  loadScoreCardProducts,
  NO_PRODUCTS,
} from '@/lib/score-card-products';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { forecastBarWords, scoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { Button, ButtonLink, Notice, controlClasses } from '@/components/ui';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { zoneWords } from '@/lib/reader-time-zone';
import { MatchPreview, NoPreview } from './match-preview';
import { MatchesAnalysis } from './matches-analysis';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/scores',
    title: `${t(resolved, 'scores.title')} · Stadiomind`,
    description: t(resolved, 'scores.metaDescription'),
  });
}

/** Every card of the day, pinned and grouped, once each. */
function allCards(res: ScoresResponse): ScoreCard[] {
  return [...res.pinned, ...res.groups.flatMap((group) => group.fixtures)];
}

/** The founder's newest analyses under the list (T-1519). */
const ANALYSES = 5;

/**
 * Matches and predictions on one page (T-1496, D-268; blueprint 4.1 and 2.1):
 * one day at a time in the viewer's zone, the day strip, four views (All,
 * Live, Not picked yet, My teams), the day's competitions as cards whose rows
 * carry the model's three percentages and a Pick action, and the preview of
 * one match with the pick form -- the side column on a desktop, above the
 * list on a phone once a Pick was pressed. Data comes from `GET /scores`,
 * then stays current over the web app's own SSE proxy (T-032); when the API
 * cannot be reached the page says so instead of rendering a quiet day.
 *
 * T-633: any date through a native date picker, previous / next day, and
 * country, competition and stage filters offering only what the day holds.
 * Both are plain GET forms, and every view, filter and open preview is an
 * address, so all of it works without JavaScript and can be shared.
 *
 * T-1519 (D-269): the old Predictions page's other content lands here, under
 * the list: the founder's analysis (`#analysis`) and the links to the
 * prediction league and the model's record.
 */
export default async function ScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const say = (key: MessageKey): string => t(resolved, key);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const zone = await pageTimeZone(locale, me);
  // A guest has no picks and no teams: those two views are a member's.
  const asked = readScoresQuery(query, zone.timeZone);
  const q = me === null ? { ...asked, unpicked: false } : asked;
  const view = scoresView(q);
  const [result, ingestion, founder] = await Promise.all([
    fetchScores(apiQuery(q), cookie),
    fetchIngestionHealth(),
    // The founder's analysis, its own product in its own section (T-1519).
    fetchFounderFeed({ limit: ANALYSES }),
  ]);
  const filters = q.filters ?? NO_FILTERS;
  // An empty day (an international break, a winter pause) points at the next
  // day with a match rather than leaving the reader to step through blanks (T-1331).
  let nextDay: string | null = null;
  if (result.ok && result.data.total === 0 && view === 'all') {
    for (const [start, end] of NEXT_DAY_WINDOWS) {
      const ahead = await fetchScores(
        apiQuery({ ...q, date: shiftDate(q.date, start) }, shiftDate(q.date, end)),
        cookie,
      );
      nextDay = ahead.ok ? firstMatchDay(ahead.data, q.timezone) : null;
      if (nextDay !== null || !ahead.ok) break;
    }
  }

  const listed = result.ok ? applyFilters(result.data, filters) : null;
  const cards = listed === null ? [] : allCards(listed);
  const now = Date.now();
  const words = scoresWords(locale);
  // The preview: the match whose Pick was pressed, else on a desktop the
  // first match still open for a pick, so the side column is never blank.
  const day = result.ok ? allCards(result.data) : [];
  const chosen =
    q.pick === null || q.pick === undefined ? null : (day.find((c) => c.id === q.pick) ?? null);
  const previewCard = chosen ?? cards.find((card) => isOpenForPick(card, now)) ?? null;

  // T-940 (D-114): the model's line for every row, one request per 50
  // matches; the member's picks from one page of their own history (D-201's
  // way), so a row can say "Picked" and "Not picked yet" can leave it out.
  let consensus: CommunityConsensusResponse | null = null;
  const [forecasts, mine, previewLines] = await Promise.all([
    listed === null
      ? Promise.resolve({})
      : loadCardForecasts(cardIds(listed), fetchForecastSummaries),
    me === null || cookie === undefined || cards.length === 0
      ? Promise.resolve(null)
      : fetchMyPredictions(cookie, MAX_CONSENSUS_FIXTURES),
    previewCard === null
      ? Promise.resolve(NO_PRODUCTS)
      : loadScoreCardProducts(
          [previewCard.id],
          {
            forecasts: fetchForecastSummaries,
            // The raw consensus is kept for the pick form's split (D-206).
            consensus: async (ids) => {
              const answer = await fetchConsensusList(ids);
              if (answer.ok) {
                consensus =
                  answer.data.fixtures.find((e) => e.fixture_id === previewCard.id)?.consensus ??
                  null;
              }
              return answer;
            },
            viewing: me === null ? null : (ids) => fetchViewingBatch(ids, undefined, cookie),
          },
          locale,
        ),
  ]);
  const own =
    mine !== null && mine.ok && mine.data.kind === 'visible'
      ? ownPredictions(mine.data.items, mine.data.items.length >= MAX_CONSENSUS_FIXTURES, cards)
          .found
      : new Map<string, Prediction>();
  // The previewed match's own pick is read directly when the page could not answer.
  const current: Prediction | null =
    previewCard === null
      ? null
      : (own.get(previewCard.id) ??
        (me === null ? null : await fetchOwnPrediction(previewCard.id, cookie)));
  if (previewCard !== null && current !== null) own.set(previewCard.id, current);

  // A provider outage is named on the page (T-083), never hidden behind old numbers.
  const trouble = feedTrouble(ingestion, locale, q.timezone);
  const strip = dayStrip(q, locale, {
    yesterday: say('scores.yesterday'),
    today: say('scores.today'),
    tomorrow: say('scores.tomorrow'),
  });
  const dayNav = attribute(resolved, 'scores.dayNav');
  const viewNav = attribute(resolved, 'scores.filter.label');
  const railNav = attribute(resolved, 'scores.competitionsNav');
  // The day steps, each a thumb-sized button.
  const stepClass = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1';
  const filtered = isFiltered(filters);
  const clearFiltersHref = pageHref(locale, q, { filters: NO_FILTERS });
  const options = result.ok ? filterOptions(result.data) : null;
  const inputClass = controlClasses('sm');
  // What a form must carry besides its own fields, so submitting it keeps the view.
  const hidden = (fields: [string, string | null | false][]) =>
    fields.map(([name, value]) =>
      value === null || value === false ? null : (
        <input key={name} type="hidden" name={name} value={value} />
      ),
    );
  const zoneField: [string, string | null] = ['tz', q.explicitTimezone ? q.timezone : null];
  const flagFields: [string, string | false][] = [
    ['live', q.live && '1'],
    ['favourites', q.favourites && '1'],
    ['unpicked', q.unpicked === true && '1'],
  ];
  const select = (
    name: string,
    label: string,
    all: string,
    list: FilterOption[],
    selected: string | null,
  ) =>
    list.length === 0 && selected === null ? null : (
      <label className="flex min-w-0 flex-col gap-1">
        <span>{label}</span>
        <select
          name={name}
          defaultValue={selected ?? ''}
          className={`${inputClass} min-h-11 max-w-full`}
          data-testid={`filter-${name}`}
        >
          <option value="">{all}</option>
          {withSelected(list, selected).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  const views: { view: ScoresView; key: MessageKey; member: boolean }[] = [
    { view: 'all', key: 'scores.filter.all', member: false },
    { view: 'live', key: 'scores.filter.live', member: false },
    { view: 'unpicked', key: 'scores.filter.unpicked', member: true },
    { view: 'mine', key: 'scores.filter.favourites', member: true },
  ];
  // The day's competitions with how many matches each holds, for the desktop rail.
  const rail = new Map<string, { name: string; count: number }>();
  for (const card of result.ok ? day : []) {
    const entry = rail.get(card.competition.id) ?? { name: card.competition.name, count: 0 };
    rail.set(card.competition.id, { ...entry, count: entry.count + 1 });
  }
  const railLink = (active: boolean): string =>
    `flex min-h-11 items-center justify-between gap-3 rounded-md px-2.5 ${
      active ? 'bg-surface-raised font-bold' : 'hover:bg-surface-raised'
    }`;

  return (
    <main className="mx-auto flex w-full max-w-[85rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:py-5">
      <h1 className="text-2xl font-extrabold font-stretch-semi-expanded" data-testid="title">
        <Translated locale={locale} message="scores.title" />
      </h1>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem] xl:grid-cols-[13.75rem_minmax(0,1fr)_21.25rem]">
        {result.ok && (
          <nav
            aria-label={railNav.text}
            lang={railNav.lang}
            className="hidden flex-col gap-0.5 text-sm xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:flex"
            data-testid="competition-rail"
          >
            <Link
              href={pageHref(locale, q, { filters: { ...filters, competition: null } })}
              aria-current={filters.competition === null ? 'true' : undefined}
              className={railLink(filters.competition === null)}
            >
              <Translated locale={locale} message="scores.allCompetitions" />
              <span className="text-caption tabular-nums">{formatNumber(locale, day.length)}</span>
            </Link>
            {[...rail].map(([id, entry]) => (
              <Link
                key={id}
                href={pageHref(locale, q, { filters: { ...filters, competition: id } })}
                aria-current={filters.competition === id ? 'true' : undefined}
                className={railLink(filters.competition === id)}
              >
                <bdi className="min-w-0 truncate">{entry.name}</bdi>
                <span className="text-caption tabular-nums">
                  {formatNumber(locale, entry.count)}
                </span>
              </Link>
            ))}
          </nav>
        )}

        <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1 xl:col-start-2">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* One row that scrolls inside itself on a phone, never the page (T-605). */}
            <nav
              aria-label={dayNav.text}
              lang={dayNav.lang}
              className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-default bg-surface p-1 text-sm"
              data-testid="day-strip"
            >
              {strip.map((d) => (
                <Link
                  key={d.date}
                  href={pageHref(locale, q, { date: d.date })}
                  aria-current={d.isSelected ? 'date' : undefined}
                  className={`flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-md px-3 whitespace-nowrap sm:flex-row sm:gap-1 ${
                    d.isSelected
                      ? 'bg-brand font-extrabold text-on-brand'
                      : 'font-semibold text-muted hover:bg-surface-raised'
                  }`}
                >
                  <span className="max-sm:text-xs">{d.weekday}</span>
                  <span className="max-sm:text-base max-sm:font-bold">{d.day}</span>
                </Link>
              ))}
            </nav>
            <nav
              aria-label={viewNav.text}
              lang={viewNav.lang}
              className="flex max-w-full gap-1.5 overflow-x-auto text-sm"
              data-testid="filters"
            >
              {views
                .filter((v) => me !== null || !v.member)
                .map((v) => {
                  const active = v.view === view;
                  return (
                    <Link
                      key={v.view}
                      href={pageHref(locale, q, viewFlags(v.view))}
                      aria-current={active ? 'true' : undefined}
                      className={`inline-flex min-h-11 shrink-0 items-center rounded-pill border px-3.5 whitespace-nowrap ${
                        active
                          ? 'border-fg bg-fg font-bold text-canvas'
                          : 'border-default font-semibold hover:bg-surface-raised'
                      }`}
                      data-testid={`view-${v.view}`}
                    >
                      <Translated locale={locale} message={v.key} />
                    </Link>
                  );
                })}
            </nav>
          </div>
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-caption">
            <span data-testid="timezone">
              <FilledMessage
                message={message(
                  resolved,
                  !zone.chosen && !q.explicitTimezone ? 'scores.timesInGuest' : 'scores.timesIn',
                )}
                params={{ zone: q.timezone, zoneName: zoneWords(locale, q.timezone) }}
              />
            </span>
            <span className="text-model">
              <Translated locale={locale} message="scores.modelLegend" />
            </span>
          </p>

          {/* On a phone the picker and the steps fold behind one control (T-1482,
              the maintainer's choice of 2026-10-23), so the first match is on the
              first screen; the day strip above covers the week. Open when the day
              shown is not on the strip. From 640px it is no box at all (globals.css). */}
          <details
            className="date-fold group"
            open={!strip.some((d) => d.isSelected)}
            data-testid="date-fold"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="transition-transform group-open:rotate-90 rtl:-scale-x-100"
              >
                ▸
              </span>
              <Translated locale={locale} message="scores.chooseDate" />
            </summary>
            {/* The day first, then the steps: on a phone the date and its button take
              one row and the two steps the next, so neither is squeezed (T-605). */}
            <div className="flex flex-wrap items-end gap-2 text-sm" data-testid="date-picker">
              <form
                method="get"
                action={`/${locale}/scores`}
                className="flex min-w-0 basis-full items-end gap-2 sm:basis-auto"
              >
                {hidden([zoneField, ...flagFields, ...filterParams(filters)])}
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span>
                    <Translated locale={locale} message="scores.date" />
                  </span>
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={q.date}
                    className={`${inputClass} min-h-11 w-full min-w-0`}
                    data-testid="date-input"
                  />
                </label>
                <Button type="submit" className="min-h-11 shrink-0 font-medium">
                  <Translated locale={locale} message="scores.showDay" />
                </Button>
              </form>
              {/* The arrows are bidi-mirrored characters, so they point the right way in RTL. */}
              <ButtonLink
                href={pageHref(locale, q, { date: shiftDate(q.date, -1) })}
                className={stepClass}
                data-testid="previous-day"
              >
                <span aria-hidden="true">‹</span>
                <span>
                  <Translated locale={locale} message="scores.previousDay" />
                </span>
              </ButtonLink>
              <ButtonLink
                href={pageHref(locale, q, { date: shiftDate(q.date, 1) })}
                className={stepClass}
                data-testid="next-day"
              >
                <span>
                  <Translated locale={locale} message="scores.nextDay" />
                </span>
                <span aria-hidden="true">›</span>
              </ButtonLink>
            </div>
          </details>

          {options !== null &&
            (filtered ||
              options.countries.length + options.competitions.length + options.stages.length >
                0) && (
              <details open={filtered} className="group text-sm" data-testid="more-filters">
                {/* A flex summary loses the browser's triangle, so it draws its own (T-1479):
                    without one the line read as a heading, not a control. */}
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden="true"
                    className="transition-transform group-open:rotate-90 rtl:-scale-x-100"
                  >
                    ▸
                  </span>
                  <Translated
                    locale={locale}
                    message={filtered ? 'scores.filter.moreActive' : 'scores.filter.more'}
                  />
                </summary>
                <form
                  method="get"
                  action={`/${locale}/scores`}
                  className="mt-2 flex flex-wrap items-end gap-3"
                >
                  {hidden([['date', q.date === q.today ? null : q.date], zoneField, ...flagFields])}
                  {select(
                    'country',
                    say('scores.filter.country'),
                    say('scores.filter.allCountries'),
                    options.countries,
                    filters.country,
                  )}
                  {select(
                    'competition',
                    say('scores.filter.competition'),
                    say('scores.filter.allCompetitions'),
                    options.competitions,
                    filters.competition,
                  )}
                  {select(
                    'stage',
                    say('scores.filter.stage'),
                    say('scores.filter.allStages'),
                    options.stages,
                    filters.stage,
                  )}
                  <Button type="submit" className="min-h-11 font-medium">
                    <Translated locale={locale} message="scores.filter.apply" />
                  </Button>
                  {filtered && (
                    <Link
                      href={clearFiltersHref}
                      className="inline-flex min-h-11 items-center px-2 underline"
                    >
                      <Translated locale={locale} message="scores.filter.clear" />
                    </Link>
                  )}
                </form>
              </details>
            )}
        </div>

        {/* The preview: beside the list from 1024px, sticky while the list
            scrolls; on a phone above the list, and only once a Pick asked for it. */}
        {result.ok && (
          <aside
            className={`flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto xl:col-start-3 ${
              chosen === null ? 'max-lg:hidden' : ''
            }`}
            data-testid="preview-column"
          >
            {previewCard === null ? (
              <NoPreview locale={locale} />
            ) : (
              <MatchPreview
                card={previewCard}
                locale={locale}
                timeZone={q.timezone}
                zone={zoneWords(locale, q.timezone)}
                me={me}
                current={current}
                consensus={consensus}
                forecast={previewLines.forecast[previewCard.id]}
                community={previewLines.community[previewCard.id]}
                viewing={previewLines.viewing[previewCard.id]}
                closeHref={chosen === null ? undefined : pageHref(locale, q)}
                now={now}
                words={words}
                forecastWords={forecastBarWords(locale)}
              />
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2 xl:col-start-2">
          {!result.ok ? (
            <Notice tone="danger" data-testid="scores-unreachable">
              <Translated
                locale={locale}
                message={result.status === 401 ? 'scores.signInFavourites' : 'scores.unreachable'}
              />
            </Notice>
          ) : (
            <>
              {trouble !== null && (
                <p role="status" className="text-sm font-medium" data-testid="feed-notice">
                  <FilledMessage
                    message={message(
                      resolved,
                      trouble.kind === 'failure' ? 'scores.feed.failure' : 'scores.feed.partial',
                    )}
                    params={{ time: trouble.at }}
                  />
                </p>
              )}
              {/* The snapshot renders now; the client keeps it current over SSE (T-032). */}
              <LiveScores
                initial={result.data}
                streamQuery={apiQuery(q)}
                timeZone={q.timezone}
                locale={locale}
                filters={filters}
                clearFiltersHref={clearFiltersHref}
                forecasts={forecasts}
                unpicked={q.unpicked === true}
                live={q.live}
                picked={[...own.keys()]}
                selected={previewCard?.id ?? null}
                pickBase={pageHref(locale, q)}
                words={words}
              />
              {nextDay !== null && (
                <p data-testid="scores-next-day">
                  <Translated locale={locale} message="scores.nextMatchDay" />{' '}
                  <Link href={pageHref(locale, q, { date: nextDay })} className="underline">
                    {formatDate(locale, `${nextDay}T00:00:00Z`, 'UTC', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </Link>
                </p>
              )}
            </>
          )}
          <MatchesAnalysis
            locale={locale}
            timeZone={q.timezone}
            analyses={founder.ok ? founder.data.analyses : null}
          />
        </div>
      </div>
    </main>
  );
}
