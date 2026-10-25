import type {
  ExpectedGoalsMetric,
  MatchAbsenceGap,
  MatchCentre,
  MatchIncident,
  MatchPlayerExpected,
  MatchPlayerStats,
  MatchStatRow,
  PlayerMatchMetric,
} from '@fmip/contracts';
import { AVAILABILITY_STALE_AFTER_MS } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import Link from '@/components/ui/link';
import { INCIDENT_KEY, STAT_KEY, incidentDetailKey, shootoutStart, statValue } from '@/lib/match';
import { isBehind } from '@/lib/live';
import { formatKickoff, formatStamp, freshnessStamp, statusLabel } from '@/lib/scores';
import { fill, filled, formatFixed, formatMinute } from '@/lib/words';
import { listName } from '@/lib/person-name';
import { stageAndRoundLabels } from '@/lib/stage-label';
import type { MatchWords } from '@/lib/words-server';
import { formatDate, formatDateTime } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { CARD, Module, RatingChip } from '@/components/match-centre-cards';
import { MatchLineupsView } from '@/components/match-lineups';
import { MessageText } from '@/components/message-text';
import { Score, ScorePair } from '@/components/score';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { Fragment } from 'react';

/** The server-rendered panels the page slots between the live modules (T-605). */
export type MatchSlot =
  // The Summary's opening card (T-1497): what the model forecast, and what happened.
  | 'outcome'
  | 'summary'
  // The three voices against the result, after full time.
  | 'verdict'
  // What does not move in play, rendered on the server (`match-record.tsx`).
  | 'form'
  | 'headToHead'
  | 'coverage'
  | 'context'
  // The ground's card (T-1438), from the server: a ground does not change in play.
  | 'venue'
  | 'players'
  | 'forecast'
  | 'analysis'
  | 'community'
  | 'discussion'
  | 'watch'
  | 'news';
export type MatchSlots = Partial<Record<MatchSlot, React.ReactNode>>;

/**
 * What the page adds to the score band (T-1384): the live line (the stream's
 * freshness stamp, from `LiveMatch`), where to watch, and after full time the
 * official highlight. Server-rendered where they need the viewing answer.
 */
export interface MatchHero {
  live?: React.ReactNode;
  watch?: React.ReactNode;
  highlights?: React.ReactNode;
}

type Key = keyof MatchWords['m'];

/**
 * The match's section tabs (T-1384, D-202; T-1497), in their order, each
 * with its label and the anchor its link opens. On a phone one tab's
 * sections show at a time; from 768px every section is open, in a main and
 * a side column, and the tabs are jump links. The tabs are plain anchors:
 * `globals.css` shows the tab that holds the page's `:target` (the Summary
 * when there is none), so a tab, a deep link (`#lineups`, `#forecast`) and a
 * page with no script all work alike. The statistical model, the founder's
 * analysis and the community stay three sections inside Predictions (rule 6).
 */
export const TABS = [
  ['summary', 'matchCentre.tab.summary'],
  ['lineups', 'matchCentre.lineups'],
  ['stats', 'matchCentre.nav.stats'],
  ['predictions', 'matchCentre.tab.predictions'],
  ['watch', 'nav.watch'],
  ['discussion', 'matchCentre.nav.discussion'],
] as const satisfies readonly (readonly [string, Key])[];

export type MatchTab = (typeof TABS)[number][0];

/**
 * Every section anchor the page has, and the tab that holds it. Other pages
 * link to these (`story-links.tsx`: `#forecast`, `#analysis`, `#community`;
 * the discussion's links to `#lineups`, `#stats`, `#timeline`), so they stay.
 */
export const SECTIONS = {
  timeline: 'summary',
  verdict: 'summary',
  context: 'summary',
  news: 'summary',
  stats: 'stats',
  lineups: 'lineups',
  players: 'lineups',
  forecast: 'predictions',
  analysis: 'predictions',
  community: 'predictions',
  watch: 'watch',
  discussion: 'discussion',
} as const satisfies Record<string, MatchTab>;

/** The per-player columns the match centre shows (T-101), in reading order. */
const PLAYER_COLUMNS: readonly [PlayerMatchMetric, Key][] = [
  ['minutes', 'matchCentre.player.minutes'],
  ['rating', 'matchCentre.player.rating'],
  ['goals', 'matchCentre.player.goals'],
  ['assists', 'matchCentre.player.assists'],
  ['shots', 'matchCentre.player.shots'],
  ['key_passes', 'matchCentre.player.keyPasses'],
  ['tackles', 'matchCentre.player.tackles'],
];

/**
 * The expected-goals columns (T-1432), from their own source: a keeper's xGOT
 * conceded and goals prevented are stored, not shown here.
 */
const EXPECTED_COLUMNS: readonly [ExpectedGoalsMetric, Key][] = [
  ['xg', 'matchCentre.expectedGoals.xg'],
  ['xa', 'matchCentre.expectedGoals.xa'],
  ['xgot', 'matchCentre.expectedGoals.xgot'],
];

/** Why the absence list is empty (T-1364): each reason its own sentence. */
const ABSENCE_GAP_KEY = {
  not_covered: 'matchCentre.absencesNotCovered',
  not_yet: 'matchCentre.absencesNotYet',
  not_asked: 'matchCentre.moduleNotSupplied',
} as const satisfies Record<MatchAbsenceGap, Key>;

/** Locales whose numerals and names are set in Vazirmatn: no condensed width, a smaller score (D-198). */
const ARABIC_SCRIPT = new Set(['fa', 'ar']);

/** One player cell: the provider's rating to one decimal, a count as it is, `–` when not supplied. */
function playerCell(locale: string, player: MatchPlayerStats, metric: PlayerMatchMetric): string {
  const value = player.stats[metric];
  if (value === undefined) return '–';
  return metric === 'rating' ? formatFixed(locale, value, 1) : formatNumber(locale, value);
}

/**
 * One section of the page, the target of an anchor. Its top clears the
 * sticky tabs when jumped to; with nothing in it, it is not rendered. `tab`
 * makes it a tab's whole panel (Stats, Watch, Discussion).
 */
function Region({ id, tab, children }: { id: string; tab?: MatchTab; children?: React.ReactNode }) {
  if (children === undefined || children === null || children === false) return null;
  return (
    <div
      id={id}
      className="flex min-w-0 scroll-mt-16 flex-col gap-5"
      data-testid={`section-${id}`}
      data-tab={tab}
    >
      {children}
    </div>
  );
}

/** A tab's panel that holds several sections (Summary, Line-ups, Predictions). */
function Panel({ tab, id, children }: { tab: MatchTab; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="flex min-w-0 scroll-mt-16 flex-col gap-5" data-tab={tab}>
      {children}
    </div>
  );
}

/**
 * The match centre from one `MatchCentre` payload (T-034), in the Hybrid
 * "Front Row" data mode (T-1384, D-202): a score band on the stage, then
 * every section as a card, side by side in columns from 768px and one tab at
 * a time on a phone. Every module renders its coverage state beside its name;
 * a module without data says so (rule 3). Pure rendering: the server page and
 * the live client component both use it, which is why its words arrive
 * resolved (`words`, T-1303) rather than from the catalogue. Brand green and
 * the three lane colours only: no club colour on this page.
 */
export function MatchCentreView({
  centre,
  timeZone,
  locale,
  now,
  slots = {},
  hero = {},
  words,
}: {
  centre: MatchCentre;
  timeZone: string;
  locale: string;
  /** The client clock, ms since epoch, so a feed that stops is caught (T-083). */
  now?: number;
  /** Server-rendered panels, each placed in its own section. */
  slots?: MatchSlots;
  /** What the page adds to the score band. */
  hero?: MatchHero;
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const has = (slot: MatchSlot) => (slots[slot] ?? null) !== null;

  // Which tabs this page has: a tab with nothing in it is not offered.
  const present: Record<MatchTab, boolean> = {
    summary: true,
    lineups: true,
    stats: true,
    predictions: has('forecast') || has('analysis') || has('community'),
    watch: has('watch'),
    discussion: has('discussion'),
  };
  const tabs = TABS.filter(([tab]) => present[tab]);

  const panels: Record<MatchTab, React.ReactNode> = {
    summary: (
      <Panel tab="summary" id="summary">
        {/* What the model forecast and what happened, then the three voices (T-1497). */}
        {slots.outcome}
        <Region id="verdict">{slots.verdict}</Region>
        <Region id="timeline">
          <Timeline centre={centre} locale={locale} timeZone={timeZone} words={words} />
        </Region>
        {slots.summary}
      </Panel>
    ),
    stats: (
      <Region id="stats" tab="stats">
        <Statistics centre={centre} locale={locale} words={words} />
        <PlayerStatistics centre={centre} locale={locale} words={words} />
        <PlayerExpectedGoals centre={centre} locale={locale} words={words} />
      </Region>
    ),
    lineups: (
      <Panel tab="lineups">
        <Region id="lineups">
          <Module
            title={m['matchCentre.lineups']}
            module={centre.lineups}
            testId="lineups"
            words={words}
            empty={f.status === 'scheduled' ? 'matchCentre.lineupsNotYet' : null}
            notInYet={f.status === 'live'}
          >
            {(lineups) => (
              <MatchLineupsView
                home={f.home}
                away={f.away}
                lineups={lineups}
                locale={locale}
                words={words}
              />
            )}
          </Module>
        </Region>
        <Region id="players">{slots.players}</Region>
      </Panel>
    ),
    predictions: present.predictions ? (
      // Three sections with three names, never one panel (rule 6, T-605).
      <Panel tab="predictions" id="predictions">
        <Region id="forecast">{slots.forecast}</Region>
        <Region id="analysis">{slots.analysis}</Region>
        <Region id="community">{slots.community}</Region>
      </Panel>
    ) : null,
    watch: (
      <Region id="watch" tab="watch">
        {slots.watch}
      </Region>
    ),
    discussion: (
      <Region id="discussion" tab="discussion">
        {slots.discussion}
      </Region>
    ),
  };

  // From 768px a main column and a side column (the Design System's 999 1
  // 640px and 1 1 340px), the side wrapping under the main where the page is
  // narrow; on a phone the columns are no box at all and the tabs choose.
  const COLUMN = 'flex min-w-0 flex-col gap-6 max-md:contents';

  return (
    <div className="flex flex-col gap-5 md:gap-6" data-match-root="">
      <Hero
        centre={centre}
        locale={locale}
        timeZone={timeZone}
        now={now}
        hero={hero}
        words={words}
        tabs={tabs}
      />

      <div
        className="flex flex-col gap-5 md:flex-row md:flex-wrap md:items-start md:gap-6"
        data-match-tabs=""
      >
        <div className={cx(COLUMN, 'md:grow-999 md:basis-160')} data-column="main">
          {panels.summary}
          {panels.stats}
          {panels.lineups}
          {panels.predictions}
          {panels.watch}
          {panels.discussion}
        </div>
        <aside className={cx(COLUMN, 'gap-5 md:grow md:basis-85')} data-column="side">
          {/* Beside the Summary: the best rated, who was missing, the past
              meetings; beside the statistics, each side's form. */}
          <div className="flex min-w-0 flex-col gap-5" data-tab="summary">
            <TopRated centre={centre} locale={locale} words={words} />
            <Availability
              centre={centre}
              locale={locale}
              timeZone={timeZone}
              now={now}
              words={words}
            />
            {slots.headToHead}
            <Region id="context">{slots.context}</Region>
            {slots.venue}
            <Region id="news">{slots.news}</Region>
          </div>
          {slots.form !== undefined && (
            <div className="flex min-w-0 flex-col gap-5" data-tab="stats">
              {slots.form}
            </div>
          )}
          {/* The data footer: every module's state, on every tab. */}
          {slots.coverage}
        </aside>
      </div>
    </div>
  );
}

/**
 * The score band (the canvas's Match, MatchPhone and LivePhone boards,
 * T-1497): on the surface, across the page. Competition and round; both
 * sides with their crests, the score large and narrow between them -- each
 * side's goals beside that side in either direction (D-193, `ScorePair`) --
 * and each side's scorers under its name; live, the saffron live badge above
 * the score, the minute along a bar and the stream's freshness stamp under
 * it (rule 4); where to watch; the match's facts; after full time the
 * official highlight; and the section tabs at its foot.
 */
function Hero({
  centre,
  locale,
  timeZone,
  now,
  hero,
  words,
  tabs,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  now: number | undefined;
  hero: MatchHero;
  words: MatchWords;
  tabs: readonly (readonly [MatchTab, Key])[];
}) {
  const m = words.m;
  const n = (value: number): string => formatNumber(locale, value);
  const f = centre.fixture;
  const naskh = ARABIC_SCRIPT.has(locale);
  const headline =
    f.status === 'finished' ? (f.scores.full_time ?? f.scores.current) : f.scores.current;
  const behind = now !== undefined && isBehind(f, now);
  const status = statusLabel(f, locale, timeZone, now, m);
  // Every freshness time on the page says its day when it is not today (T-1371).
  const at = (iso: string) => <time dateTime={iso}>{formatStamp(locale, iso, timeZone, now)}</time>;
  // The fixture lists re-ask hourly; a check after the last change is the
  // newer truth about the match, and the change keeps its own time (D-189).
  const checked =
    f.last_checked_at != null && Date.parse(f.last_checked_at) > Date.parse(f.last_updated_at)
      ? f.last_checked_at
      : null;
  const venue =
    f.venue === null ? null : `${f.venue.name}${f.venue.city !== null ? `, ${f.venue.city}` : ''}`;
  const name = cx(
    'block max-w-full text-base leading-tight font-extrabold hyphens-auto [overflow-wrap:anywhere] md:text-3xl md:leading-none',
  );
  const figure = cx(
    'font-sans font-extrabold tabular-nums whitespace-nowrap',
    naskh
      ? 'text-display-3 leading-[1.1] md:text-display-5'
      : 'text-display-4 leading-[0.9] font-stretch-condensed md:text-display-5',
    f.status === 'live' && !behind && 'text-live',
  );
  const live = f.status === 'live' && !behind;
  const scorers = scorersOf(centre, locale);
  return (
    <header
      className="flex flex-col gap-4 bg-surface pt-3 [box-shadow:0_0_0_100vmax_var(--token-surface),0_1px_0_100vmax_var(--token-border)] [clip-path:inset(0_-100vmax_-1px)] md:gap-5 md:pt-4"
      data-testid="match-header"
    >
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-caption">
        <Link
          href={`/${locale}/competition/${f.competition.id}?season=${f.season.id}`}
          className="inline-flex min-h-touch items-center gap-2 font-semibold text-muted underline md:min-h-0"
          data-testid="competition-link"
        >
          <EntityImage
            media={f.competition.logo}
            kind="logo"
            name={f.competition.name}
            size={22}
            aboveFold
          />
          {f.competition.name}
        </Link>
        <span>
          · {f.season.label}
          {stageAndRoundLabels(f.stage?.name, f.round, (key) => m[key].text, locale).map(
            (label) => ` · ${label}`,
          )}
          {f.group_name !== null
            ? ` · ${fill(m['matchCentre.group'].text, { group: f.group_name })}`
            : ''}
          {f.leg !== null ? ` · ${fill(m['scores.card.leg'].text, { leg: n(f.leg) })}` : ''}
        </span>
      </p>

      {/* One heading names the match (T-1478); the band below draws it. */}
      <h1 className="sr-only">
        {fill(m['matchCentre.fixtureTitle'].text, { home: f.home.name, away: f.away.name })}
      </h1>

      {f.status === 'live' && (
        // The live badge (Design System `LiveBadge`): saffron, with its dot;
        // amber words instead when the feed has fallen behind (rule 4).
        <p className="-mb-2 flex justify-center">
          <span
            className={cx(
              'inline-flex min-h-7.5 items-center gap-2 rounded-pill px-3 text-sm font-extrabold uppercase',
              live ? 'bg-live/15 text-live' : 'bg-warning/15 text-warning',
            )}
            data-testid="live-badge"
          >
            {live && (
              <>
                <span aria-hidden="true" className="live-dot size-2 rounded-full bg-live" />
                {status !== m['status.live'].text && (
                  <span>
                    <MessageText message={m['status.live']} /> ·{' '}
                  </span>
                )}
              </>
            )}
            <span data-testid="match-status">{status}</span>
          </span>
        </p>
      )}

      {/* Home, score, away from the inline start: the whole band mirrors on /fa. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 md:items-center md:gap-8">
        <div data-testid="home-team" className="min-w-0">
          <div className="flex flex-col items-center gap-2 text-center md:flex-row md:justify-end md:gap-5 md:text-end">
            <span className="flex max-w-full min-w-0 flex-col gap-1.5">
              <Link href={`/${locale}/team/${f.home.id}`} className="min-w-0">
                <bdi className={name}>{f.home.name}</bdi>
              </Link>
              {scorers.home !== '' && (
                <span className="text-xs text-muted md:text-sm" data-testid="scorers-home">
                  {scorers.home}
                </span>
              )}
            </span>
            <Crest team={f.home} className="max-md:order-first" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          {f.status === 'scheduled' ? (
            // Before kick-off the band's figure is the kick-off time, never a 0-0.
            <span className={figure} data-testid="match-status">
              {status}
            </span>
          ) : headline === null ? (
            // Live with no score supplied: none, rather than a 0-0 (rule 3).
            <span className={figure} data-testid="score">
              –
            </span>
          ) : (
            <ScorePair locale={locale} className={figure} testId="score">
              {n(headline.home)}
              <span className="mx-[0.06em]">–</span>
              {n(headline.away)}
            </ScorePair>
          )}
          {f.status === 'scheduled' ? (
            <span className="text-sm font-semibold text-muted">
              <time dateTime={f.kickoff_at}>
                {formatDate(locale, f.kickoff_at, timeZone, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </time>
            </span>
          ) : (
            f.status !== 'live' && (
              <span className="text-xs font-bold text-muted md:text-sm">
                <span data-testid="match-status">{status}</span>
                {f.scores.half_time !== null && (
                  <>
                    {' · '}
                    <MessageText message={m['status.halfTime']} />{' '}
                    <Score
                      home={f.scores.half_time.home}
                      away={f.scores.half_time.away}
                      locale={locale}
                    />
                  </>
                )}
              </span>
            )
          )}
        </div>
        <div data-testid="away-team" className="min-w-0">
          <div className="flex flex-col items-center gap-2 text-center md:flex-row md:justify-start md:gap-5 md:text-start">
            <Crest team={f.away} />
            <span className="flex max-w-full min-w-0 flex-col gap-1.5">
              <Link href={`/${locale}/team/${f.away.id}`} className="min-w-0">
                <bdi className={name}>{f.away.name}</bdi>
              </Link>
              {scorers.away !== '' && (
                <span className="text-xs text-muted md:text-sm" data-testid="scorers-away">
                  {scorers.away}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Live: the minute along the match, then kick-off and the stream's stamp. */}
      {f.status === 'live' && (
        <div className="flex flex-col gap-1.5" data-testid="live-progress">
          {f.minute !== null && (
            <span aria-hidden="true" className="block h-1 rounded-pill bg-surface-raised">
              <span
                className="block h-1 rounded-pill bg-accent"
                style={{ inlineSize: `${Math.min(f.minute / 90, 1) * 100}%` }}
              />
            </span>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
            <span>
              <FilledMessage
                message={m['scores.card.kickoff']}
                params={{
                  time: (
                    <time dateTime={f.kickoff_at}>
                      {formatKickoff(locale, f.kickoff_at, timeZone)}
                    </time>
                  ),
                }}
              />
            </span>
            {hero.live}
          </div>
        </div>
      )}
      {(hero.watch !== undefined || (f.status !== 'live' && hero.live !== undefined)) && (
        <div className="-mt-1 flex flex-col items-center gap-2 text-center">
          {f.status !== 'live' && hero.live}
          {hero.watch}
        </div>
      )}

      {behind && (
        <p
          role="status"
          className="text-center text-sm font-medium text-warning"
          data-testid="feed-behind"
        >
          <FilledMessage
            message={m['matchCentre.behind']}
            params={{ time: at(f.last_updated_at) }}
          />
        </p>
      )}

      {hero.highlights}

      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted">
        <li>
          <FilledMessage
            message={m['scores.card.kickoff']}
            params={{
              time: (
                <time dateTime={f.kickoff_at}>
                  {formatDateTime(locale, f.kickoff_at, timeZone)}
                </time>
              ),
            }}
          />
        </li>
        {venue !== null && (
          <li>
            {f.is_neutral_venue ? (
              <MessageText message={filled(m['matchCentre.neutralVenue'], { venue })} />
            ) : (
              venue
            )}
          </li>
        )}
        <li>
          <MessageText
            message={filled(m['matchCentre.referee'], {
              name: f.referee === null ? m['status.coverage.notSupplied'].text : f.referee.name,
            })}
          />
        </li>
        {f.attendance !== null && (
          <li>
            <MessageText
              message={filled(m['matchCentre.attendance'], { count: n(f.attendance) })}
            />
          </li>
        )}
        {f.scores.aggregate !== null && (
          <li>
            <MessageText message={m['status.aggregate']} />{' '}
            <Score home={f.scores.aggregate.home} away={f.scores.aggregate.away} locale={locale} />
          </li>
        )}
        {f.scores.penalties !== null && (
          <li>
            <MessageText message={m['status.penalties']} />{' '}
            <Score home={f.scores.penalties.home} away={f.scores.penalties.away} locale={locale} />
          </li>
        )}
        <li
          data-testid="last-update"
          className="font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        >
          <span aria-hidden="true">● </span>
          {checked === null ? (
            <FilledMessage
              message={m['matchCentre.lastUpdate']}
              params={{ time: at(f.last_updated_at) }}
            />
          ) : (
            <FilledMessage
              message={m['matchCentre.lastChecked']}
              params={{ time: at(checked), changed: at(f.last_updated_at) }}
            />
          )}
        </li>
      </ul>

      {/* The section tabs (Design System `Tabs`): plain anchors, the saffron
          edge under the one on show (globals.css), scrolling sideways on a phone. */}
      <nav
        aria-label={m['matchCentre.onThisPage'].text}
        className="-mx-4 overflow-x-auto px-2 md:mx-0 md:px-0"
        data-testid="section-nav"
      >
        <ul className="flex gap-0.5">
          {tabs.map(([tab, label]) => (
            <li key={tab} className="shrink-0">
              <a
                href={`#${tab}`}
                data-tab-link={tab}
                className="inline-flex min-h-touch items-center px-3 text-sm font-semibold whitespace-nowrap text-muted hover:text-fg"
              >
                <MessageText message={m[label]} />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Each side's scorers for the band, "Jackson 6′, 60′", in the order they
 * scored. None at all when the timeline holds an own goal: which side it
 * counts for is not certain from the feed, and a scorer under the wrong
 * name would be invented (rule 3; the alerts make the same choice).
 */
function scorersOf(centre: MatchCentre, locale: string): Record<'home' | 'away', string> {
  const none = { home: '', away: '' };
  const incidents = centre.timeline.data;
  if (incidents === null || incidents.some((i) => i.kind === 'own_goal')) return none;
  const by: Record<'home' | 'away', Map<string, string[]>> = { home: new Map(), away: new Map() };
  for (const i of incidents) {
    if ((i.kind !== 'goal' && i.kind !== 'penalty_goal') || i.side === null || i.player === null)
      continue;
    const name = listName(locale, i.player.name);
    const minutes = by[i.side].get(name) ?? [];
    minutes.push(formatMinute(locale, i.minute, i.added_time));
    by[i.side].set(name, minutes);
  }
  const line = (side: 'home' | 'away') =>
    [...by[side]].map(([name, minutes]) => `${name} ${minutes.join(', ')}`).join(' · ');
  return { home: line('home'), away: line('away') };
}

/** A side's crest on a white tile, so a dark crest reads on the Night ground. */
function Crest({ team, className }: { team: MatchCentre['fixture']['home']; className?: string }) {
  return (
    <span
      className={cx(
        'inline-grid size-13 shrink-0 place-items-center rounded-tile border border-default bg-surface md:size-21 md:rounded-card',
        className,
      )}
    >
      <EntityImage media={team.crest} kind="crest" name={team.name} size={40} aboveFold />
    </span>
  );
}

/** Goals and cards on the axis; every other incident is in the list only. */
const AXIS_KINDS = new Set<MatchIncident['kind']>([
  'goal',
  'penalty_goal',
  'own_goal',
  'yellow_card',
  'second_yellow_card',
  'red_card',
]);

/**
 * The timeline (the canvas's "How it unfolded"; T-1497): an axis from
 * kick-off to the last minute with half-time marked, each goal a dot and
 * each card a card, the home side's above the line and the away side's
 * below, the axis running with the reading direction; then the events as a
 * list in two columns, one per side, from 768px. After full time the list
 * reads in order from kick-off; while the match is on, latest first.
 */
function Timeline({
  centre,
  locale,
  timeZone,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const started = f.status !== 'scheduled';
  const finished = f.status === 'finished';
  return (
    <Module
      title={m[finished ? 'matchCentre.keyEvents' : 'matchCentre.timeline']}
      module={centre.timeline}
      testId="timeline"
      words={words}
      notInYet={f.status === 'live'}
    >
      {(incidents) => {
        // A shoot-out is its own block, its kicks in order and numbered, never
        // penalties at minutes of added time (T-1477).
        const kicksFrom = shootoutStart(incidents, f.scores.penalties);
        const play = kicksFrom === null ? incidents : incidents.slice(0, kicksFrom);
        const kicks = (kicksFrom === null ? [] : incidents.slice(kicksFrom)).map((i, k) => ({
          i,
          kick: k + 1,
        }));
        const inPlay = (finished ? play : [...play].reverse()).map((i) => ({ i, kick: null }));
        const rows = finished ? [...inPlay, ...kicks] : [...kicks, ...inPlay];
        const kickoff = started && (
          <li
            key="kickoff"
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 border-b border-default py-2.5 last:border-b-0 md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="font-mono text-muted tabular-nums">
              {formatKickoff(locale, f.kickoff_at, timeZone)}
            </span>
            <span className="flex items-center gap-3 md:col-span-2">
              <IncidentMark kind="kickoff" />
              <b className="font-bold text-fg">
                <MessageText message={m['matchCentre.kickedOff']} />
              </b>
            </span>
          </li>
        );
        return (
          <>
            {/* Nothing recorded is said, never an empty card (rule 3). */}
            {incidents.length === 0 && (
              <p dir="auto" className="text-sm text-muted" data-testid="no-events">
                <MessageText message={m['matchCentre.noEventsYet']} />
              </p>
            )}
            {play.length > 0 && <Axis incidents={play} locale={locale} words={words} />}
            <ol className="flex flex-col text-sm">
              {kicksFrom !== null && f.scores.penalties !== null && !finished && (
                <Shootout centre={centre} locale={locale} words={words} />
              )}
              {finished && kickoff}
              {rows.map(({ i, kick }, index) => (
                <Fragment key={i.id}>
                  {finished && kick === 1 && f.scores.penalties !== null && (
                    <Shootout centre={centre} locale={locale} words={words} />
                  )}
                  <li
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 border-b border-default py-2.5 md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]"
                    data-kick={kick ?? undefined}
                    data-side={i.side ?? undefined}
                    data-index={index}
                  >
                    <span className="font-mono text-muted tabular-nums">
                      {kick !== null ? (
                        fill(m['matchCentre.shootoutKick'].text, { n: formatNumber(locale, kick) })
                      ) : (
                        <span dir="ltr">{formatMinute(locale, i.minute, i.added_time)}</span>
                      )}
                    </span>
                    <span
                      className={cx(
                        'flex min-w-0 items-center gap-3',
                        i.side === 'away'
                          ? 'md:col-start-3'
                          : i.side === null
                            ? 'md:col-span-2'
                            : 'md:col-start-2',
                      )}
                    >
                      <IncidentMark kind={i.kind} />
                      <IncidentText incident={i} centre={centre} locale={locale} words={words} />
                    </span>
                  </li>
                </Fragment>
              ))}
              {!finished && kickoff}
            </ol>
            {incidents.length > 0 && !finished && (
              <p className="text-xs text-caption">
                <MessageText message={m['matchCentre.latestFirst']} />
              </p>
            )}
          </>
        );
      }}
    </Module>
  );
}

function Shootout({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const penalties = centre.fixture.scores.penalties;
  if (penalties === null) return null;
  return (
    <li className="border-b border-default py-2.5 font-bold text-fg" data-testid="shootout">
      <MessageText message={words.m['matchCentre.shootout']} />{' '}
      <Score home={penalties.home} away={penalties.away} locale={locale} />
    </li>
  );
}

/** One incident's words: its kind and side, then who (T-1478: who came on, who went off). */
function IncidentText({
  incident: i,
  centre,
  locale,
  words,
}: {
  incident: MatchIncident;
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const player = (p: { id: string; name: string }) => (
    <Link href={`/${locale}/player/${p.id}`} className="underline">
      {listName(locale, p.name)}
    </Link>
  );
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      <b className="block font-bold text-fg">
        <MessageText message={m[INCIDENT_KEY[i.kind]]} />
        {i.side !== null ? (
          <>
            {' · '}
            <bdi>{i.side === 'home' ? f.home.name : f.away.name}</bdi>
          </>
        ) : null}
        <IncidentDetail detail={i.detail} words={words} />
      </b>
      <span className="text-muted">
        {i.kind === 'substitution' && i.player !== null && i.related_player !== null ? (
          <>
            <FilledMessage
              message={m['matchCentre.subOn']}
              params={{ player: player(i.related_player) }}
            />
            {' · '}
            <FilledMessage
              message={m['matchCentre.subOff']}
              params={{ player: player(i.player) }}
            />
          </>
        ) : (
          <>
            {i.player !== null && player(i.player)}
            {i.related_player !== null && i.kind !== 'substitution' && (
              <>
                {' · '}
                <FilledMessage
                  message={m['matchCentre.assist']}
                  params={{ player: player(i.related_player) }}
                />
              </>
            )}
          </>
        )}
      </span>
    </span>
  );
}

/**
 * The axis: where on the clock each goal and card fell. A minute of added
 * time sits after its half's last minute; the first half's are pressed
 * together at half-time so the second half keeps its place. The picture is
 * described for a screen reader; the list under it says every event in words.
 */
function Axis({
  incidents,
  locale,
  words,
}: {
  incidents: MatchIncident[];
  locale: string;
  words: MatchWords;
}) {
  const marked = incidents.filter((i) => AXIS_KINDS.has(i.kind) && i.side !== null);
  const at = (i: MatchIncident) => i.minute + (i.added_time ?? 0) * (i.minute <= 45 ? 0.15 : 1);
  const end = Math.max(90, ...marked.map(at));
  const pos = (minute: number) => `${(Math.min(minute, end) / end) * 100}%`;
  const goals = marked.filter((i) => GOAL_KINDS.has(i.kind)).length;
  return (
    <div
      role="img"
      aria-label={fill(words.m['matchCentre.axis'].text, {
        goals: formatNumber(locale, goals),
        cards: formatNumber(locale, marked.length - goals),
      })}
      className="relative h-23"
      data-testid="timeline-axis"
    >
      <span className="absolute inset-x-0 top-11.5 h-0.5 bg-border" />
      <span
        className="absolute top-7.5 h-8.5 w-px bg-caption"
        style={{ insetInlineStart: pos(45) }}
      />
      <span
        className="absolute top-17.5 font-mono text-xs text-caption"
        style={{ insetInlineStart: pos(45) }}
      >
        <MessageText message={words.m['status.halfTime']} />
      </span>
      {marked.map((i) => {
        const goal = GOAL_KINDS.has(i.kind);
        const home = i.side === 'home';
        return (
          <span
            key={i.id}
            data-kind={i.kind}
            data-side={i.side}
            className={cx(
              'absolute',
              goal
                ? cx(
                    'size-4.5 -translate-x-1/2 rounded-full rtl:translate-x-1/2',
                    home ? 'top-4.5 bg-accent' : 'top-14 bg-border-strong',
                  )
                : cx(
                    'h-2.75 w-2 -translate-x-1/2 rounded-xs rtl:translate-x-1/2',
                    home ? 'top-7.5' : 'top-12.75',
                    i.kind === 'yellow_card' ? 'bg-warning' : 'bg-danger',
                  ),
            )}
            style={{ insetInlineStart: pos(at(i)) }}
          />
        );
      })}
    </div>
  );
}

const GOAL_KINDS = new Set<MatchIncident['kind']>(['goal', 'penalty_goal', 'own_goal']);

/** A small mark for an incident's kind, in tokens: a ball, a card's colour, an arrow. */
function IncidentMark({ kind }: { kind: MatchIncident['kind'] | 'kickoff' }) {
  const shape =
    kind === 'yellow_card' ? (
      <span className="h-4 w-3 rounded-xs bg-warning" />
    ) : kind === 'red_card' || kind === 'second_yellow_card' ? (
      <span className="h-4 w-3 rounded-xs bg-danger" />
    ) : kind === 'substitution' ? (
      <span className="text-base leading-none">⇄</span>
    ) : kind === 'var' ? (
      <span className="text-xs font-extrabold">VAR</span>
    ) : kind === 'kickoff' ? (
      <span className="size-2.5 rounded-full border-2 border-fg" />
    ) : kind === 'penalty_missed' ? (
      <span className="size-3 rounded-full border-2 border-dashed border-fg" />
    ) : (
      <span className="size-3 rounded-full bg-accent" />
    );
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-raised text-fg"
    >
      {shape}
    </span>
  );
}

/**
 * The team statistics (Design System `StatBar`): each metric's two figures
 * at the ends, its name between them, and a split bar under it -- the home
 * side's share in ink from the inline start, the away side's grey; never a
 * club colour. A side the provider left out is "–" and there is no bar for
 * that row. While the match is on and nothing has come, "Not in yet".
 */
function Statistics({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  return (
    <Module
      title={m['matchCentre.statistics']}
      module={centre.statistics}
      testId="statistics"
      words={words}
      notInYet={f.status === 'live'}
    >
      {(rows) => (
        <>
          <p aria-hidden="true" className="-mt-1 flex gap-3.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-fg" />
              <bdi>{f.home.name}</bdi>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-border-strong" />
              <bdi>{f.away.name}</bdi>
            </span>
          </p>
          <ul className="flex flex-col gap-3.5" data-testid="stat-grid">
            {rows.map((row) => (
              <StatTile key={row.metric} row={row} locale={locale} words={words} />
            ))}
          </ul>
          {rows.some((row) => row.metric === 'expected_goals') ? null : (
            <p
              className="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-3 text-sm text-muted"
              data-testid="xg-not-supplied"
            >
              <span dir="auto">
                <MessageText message={m['matchCentre.xgNotSupplied']} />
              </span>
              <CoverageBadge
                state="not_supplied"
                label={<MessageText message={m['status.coverage.notSupplied']} />}
              />
            </p>
          )}
        </>
      )}
    </Module>
  );
}

function StatTile({
  row,
  locale,
  words,
}: {
  row: MatchStatRow;
  locale: string;
  words: MatchWords;
}) {
  const total = (row.home ?? 0) + (row.away ?? 0);
  const bars = row.home !== null && row.away !== null && total > 0;
  return (
    <li className="flex flex-col gap-1.5 tabular-nums" data-metric={row.metric}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <b className="font-bold">
          <span dir="ltr">{statValue(row.metric, row.home, locale)}</span>
        </b>
        <span className="text-center text-muted">
          <MessageText message={words.m[STAT_KEY[row.metric]]} />
        </span>
        <b className="font-bold">
          <span dir="ltr">{statValue(row.metric, row.away, locale)}</span>
        </b>
      </div>
      {bars && (
        <div aria-hidden="true" className="flex h-2 gap-0.75">
          {(row.home ?? 0) > 0 && (
            <span
              className="rounded-pill bg-fg"
              style={{ flexGrow: row.home ?? 0, flexBasis: 0 }}
            />
          )}
          {(row.away ?? 0) > 0 && (
            <span
              className="rounded-pill bg-border-strong"
              style={{ flexGrow: row.away ?? 0, flexBasis: 0 }}
            />
          )}
        </div>
      )}
    </li>
  );
}

function PlayerStatistics({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  return (
    <Module
      title={m['matchCentre.playerStatistics']}
      module={centre.player_statistics}
      testId="player-statistics"
      words={words}
    >
      {(players) => (
        <div className="flex flex-col gap-3 text-sm">
          {/* A phone cannot fit every column (T-1395): say so, and shade the edge that hides more. */}
          <p className="text-xs text-caption md:hidden" data-testid="player-statistics-scroll-hint">
            <span aria-hidden="true">↔ </span>
            <MessageText message={m['matchCentre.playerStatistics.scroll']} />
          </p>
          {(
            [
              ['home', f.home.name],
              ['away', f.away.name],
            ] as const
          ).map(([side, team]) => {
            // A substitute who never came on did not play (T-1478): the feed
            // still lists him at 0 minutes with a 0.0 rating, figures that
            // were never earned, so he is not a row (rule 3).
            const rows = players.filter((p) => p.side === side && p.stats.minutes !== 0);
            if (rows.length === 0) return null;
            return (
              // A named region a keyboard can reach and scroll with the arrow keys.
              <div
                key={side}
                role="region"
                aria-label={fill(m['matchCentre.playerStatistics.region'].text, { team })}
                tabIndex={0}
                className="scroll-cue overflow-x-auto rounded-control"
                data-testid="player-statistics-scroll"
              >
                <table className="w-full">
                  <caption className="text-start font-bold">{team}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1 text-start font-normal text-muted">
                        <MessageText message={m['matchCentre.playerColumn']} />
                      </th>
                      {PLAYER_COLUMNS.map(([metric, label]) => (
                        <th
                          key={metric}
                          scope="col"
                          className="px-2 py-1 text-end font-normal text-muted"
                        >
                          <MessageText message={m[label]} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((player) => (
                      <tr key={player.id} className="border-t border-default">
                        <th scope="row" className="py-1 text-start font-normal">
                          <Link href={`/${locale}/player/${player.id}`}>
                            {listName(locale, player.name)}
                          </Link>
                        </th>
                        {PLAYER_COLUMNS.map(([metric]) => (
                          <td key={metric} className="px-2 py-1 text-end tabular-nums">
                            {playerCell(locale, player, metric)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </Module>
  );
}

/**
 * Per-player expected goals from their one source (T-1432, D-224), a card of
 * its own under the player statistics: labelled "xG (Highlightly)", never a
 * column of the table above, `–` for a figure the source did not supply, and
 * an explicit state when it supplied none (rule 3).
 */
function PlayerExpectedGoals({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const expected = centre.player_expected_goals;
  const cell = (player: MatchPlayerExpected, metric: ExpectedGoalsMetric): string => {
    const value = player.figures[metric];
    return value === undefined ? '–' : formatFixed(locale, value, 2);
  };
  return (
    <Module
      title={m['matchCentre.expectedGoals']}
      module={expected}
      testId="player-expected-goals"
      words={words}
      empty={expected.last_updated_at === null ? null : 'matchCentre.expectedGoals.none'}
    >
      {(players) => (
        <div className="flex flex-col gap-3 text-sm">
          {(
            [
              ['home', f.home.name],
              ['away', f.away.name],
            ] as const
          ).map(([side, team]) => {
            const rows = players.filter((p) => p.side === side);
            if (rows.length === 0) return null;
            return (
              <div
                key={side}
                role="region"
                aria-label={fill(m['matchCentre.expectedGoals.region'].text, { team })}
                tabIndex={0}
                className="scroll-cue overflow-x-auto rounded-control"
              >
                <table className="w-full">
                  <caption className="text-start font-bold">{team}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1 text-start font-normal text-muted">
                        <MessageText message={m['matchCentre.playerColumn']} />
                      </th>
                      {EXPECTED_COLUMNS.map(([metric, label]) => (
                        <th
                          key={metric}
                          scope="col"
                          className="px-2 py-1 text-end font-normal text-muted"
                        >
                          <MessageText message={m[label]} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((player) => (
                      <tr key={player.id} className="border-t border-default">
                        <th scope="row" className="py-1 text-start font-normal">
                          <Link href={`/${locale}/player/${player.id}`}>
                            {listName(locale, player.name)}
                          </Link>
                        </th>
                        {EXPECTED_COLUMNS.map(([metric]) => (
                          <td key={metric} className="px-2 py-1 text-end tabular-nums">
                            {cell(player, metric)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <p className="text-xs text-muted" data-testid="player-expected-goals-note">
            <MessageText message={m['matchCentre.expectedGoals.note']} />
          </p>
          {expected.unplaced > 0 && (
            <p className="text-xs text-muted" data-testid="player-expected-goals-unplaced">
              <FilledMessage
                message={m['matchCentre.expectedGoals.unplaced']}
                params={{ count: formatNumber(locale, expected.unplaced) }}
              />
            </p>
          )}
        </div>
      )}
    </Module>
  );
}

function Availability({
  centre,
  locale,
  timeZone,
  now,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  now: number | undefined;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const asked = centre.availability.last_updated_at;
  // An absence answer before kick-off is re-asked every three hours (D-127).
  const askedStamp =
    asked === null
      ? null
      : freshnessStamp(
          locale,
          asked,
          timeZone,
          now,
          f.status === 'scheduled' ? AVAILABILITY_STALE_AFTER_MS : undefined,
        );
  return (
    <Module
      title={m['player.availability.title']}
      module={centre.availability}
      testId="availability"
      words={words}
      empty={ABSENCE_GAP_KEY[centre.availability.gap ?? 'not_asked']}
    >
      {(absences) =>
        absences.length === 0 ? (
          <p className="text-sm" data-testid="no-absences">
            {askedStamp === null ? (
              <MessageText message={m['matchCentre.noAbsences']} />
            ) : (
              <>
                <MessageText
                  message={filled(m['matchCentre.noAbsencesAsked'], { time: askedStamp.text })}
                />
                {askedStamp.stale && (
                  <>
                    {' '}
                    <MessageText message={m['player.availability.stale']} />
                  </>
                )}
              </>
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {(
              [
                ['home', f.home.name],
                ['away', f.away.name],
              ] as const
            ).map(([side, team]) => (
              <div key={side} className="flex flex-col gap-1">
                <h3 className="font-bold">{team}</h3>
                <ul className="flex flex-col gap-1">
                  {absences
                    .filter((a) => a.side === side)
                    .map((a) => (
                      <li key={a.id}>
                        <Link href={`/${locale}/player/${a.id}`}>{listName(locale, a.name)}</Link>{' '}
                        <span className="text-muted">
                          <MessageText
                            message={
                              m[a.status === 'out' ? 'matchCentre.out' : 'matchCentre.doubtful']
                            }
                          />
                          {a.reason === null ? '' : ` · ${a.reason}`}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )
      }
    </Module>
  );
}

/** Every rating the feed gave, by player id; none for a player it did not rate. */
export function ratingsOf(centre: MatchCentre): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const p of centre.player_statistics.data ?? []) {
    const rating = p.stats.rating;
    if (rating !== undefined && (p.stats.minutes ?? 1) > 0) ratings.set(p.id, rating);
  }
  return ratings;
}

/**
 * The best rated (the canvas's "Top rated" and "Ratings, best six"; T-1497):
 * the highest rating of the match with that player's goals, assists and xG
 * where they were supplied, then the best six. From the feed's ratings only;
 * with none there is no card, since the statistics already say why (rule 3).
 */
function TopRated({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const ratings = ratingsOf(centre);
  const best = (centre.player_statistics.data ?? [])
    .filter((p) => ratings.has(p.id))
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    .slice(0, 6);
  const top = best[0];
  if (top === undefined) return null;
  const team = (side: 'home' | 'away') => (side === 'home' ? f.home : f.away);
  const photo = [...(centre.lineups.data?.home ?? []), ...(centre.lineups.data?.away ?? [])].find(
    (p) => p.id === top.id,
  )?.photo;
  const xg = centre.player_expected_goals.data?.find((p) => p.id === top.id)?.figures.xg;
  const figures: [string, Key][] = [];
  if (top.stats.goals !== undefined)
    figures.push([formatNumber(locale, top.stats.goals), 'matchCentre.player.goals']);
  if (top.stats.assists !== undefined)
    figures.push([formatNumber(locale, top.stats.assists), 'matchCentre.player.assists']);
  if (xg !== undefined) figures.push([formatFixed(locale, xg, 2), 'matchCentre.expectedGoals.xg']);
  return (
    <section className={CARD} data-testid="top-rated">
      <h2 className="text-xs font-extrabold tracking-wider text-accent uppercase">
        <MessageText message={m['matchCentre.topRated']} />
      </h2>
      <div className="flex items-center gap-3.5">
        <EntityImage media={photo} kind="photo" name={top.name} size={48} />
        <span className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/${locale}/player/${top.id}`}
            className="text-lg leading-tight font-extrabold text-fg"
          >
            {listName(locale, top.name)}
          </Link>
          <span className="text-sm text-muted">
            <bdi>{team(top.side).name}</bdi>
            {top.stats.minutes !== undefined && (
              <>
                {' · '}
                <MessageText
                  message={filled(m['matchCentre.minutesPlayed'], {
                    minutes: formatNumber(locale, top.stats.minutes),
                  })}
                />
              </>
            )}
          </span>
        </span>
        <RatingChip value={ratings.get(top.id) ?? 0} locale={locale} size="large" />
      </div>
      {figures.length > 0 && (
        <dl className="grid grid-cols-3 gap-2.5 tabular-nums">
          {figures.map(([value, label]) => (
            <div key={label} className="flex flex-col-reverse gap-0.5">
              <dt className="text-xs text-caption">
                <MessageText message={m[label]} />
              </dt>
              <dd className="text-2xl leading-none font-extrabold font-stretch-condensed">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <h3 className="border-t border-default pt-3 text-sm font-extrabold">
        <MessageText message={m['matchCentre.bestSix']} />
      </h3>
      <ol className="-mt-1 flex flex-col divide-y divide-default text-sm" data-testid="best-rated">
        {best.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 py-2">
            <EntityImage
              media={team(p.side).crest}
              kind="crest"
              name={team(p.side).name}
              size={20}
            />
            <Link href={`/${locale}/player/${p.id}`} className="min-w-0 truncate">
              {listName(locale, p.name)}
            </Link>
            <RatingChip value={ratings.get(p.id) ?? 0} locale={locale} className="ms-auto" />
          </li>
        ))}
      </ol>
      <p className="font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
        <MessageText message={m['matchCentre.ratingsNote']} />
      </p>
    </section>
  );
}

/**
 * What an incident adds to its kind (a VAR review's decision), in the
 * reader's words (T-1378). Nothing when there is none or the page does not
 * know the code: the kind's own label stands, never the provider's text.
 */
function IncidentDetail({ detail, words }: { detail: MatchIncident['detail']; words: MatchWords }) {
  const key = incidentDetailKey(detail);
  if (key === null) return null;
  return (
    <span data-testid="incident-detail">
      {' · '}
      <MessageText message={words.m[key]} />
    </span>
  );
}
