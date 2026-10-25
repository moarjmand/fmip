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
import { Module } from '@/components/match-centre-cards';
import { MatchLineupsView } from '@/components/match-lineups';
import { MessageText } from '@/components/message-text';
import { Score, ScorePair } from '@/components/score';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { LiveBadge } from '@/components/ui/live-badge';

/** The server-rendered panels the page slots between the live modules (T-605). */
export type MatchSlot =
  | 'summary'
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
 * The phone's tabs (T-1384, D-202), in their order, each with its label and
 * the anchor its link opens. On a phone one tab's sections show at a time;
 * from 768px every section is open in columns and the tabs are not drawn.
 * The tabs are plain anchors: `globals.css` shows the tab that holds the
 * page's `:target` (the Summary when there is none), so a tab, a deep link
 * (`#lineups`, `#forecast`) and a page with no script all work alike. The
 * statistical model, the founder's analysis and the community stay three
 * sections inside Predictions (rule 6).
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
        <Region id="timeline">
          <Timeline centre={centre} locale={locale} timeZone={timeZone} words={words} />
        </Region>
        {/* After full time: what each product forecast, against the result. */}
        <Region id="verdict">{slots.verdict}</Region>
        {slots.summary}
        <Region id="context">{slots.context}</Region>
        {slots.venue}
        <Region id="news">{slots.news}</Region>
      </Panel>
    ),
    stats: (
      <Region id="stats" tab="stats">
        <Statistics centre={centre} locale={locale} words={words} />
        <PlayerStatistics centre={centre} locale={locale} words={words} />
        <PlayerExpectedGoals centre={centre} locale={locale} words={words} />
        {slots.form}
        {slots.headToHead}
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
          <Availability
            centre={centre}
            locale={locale}
            timeZone={timeZone}
            now={now}
            words={words}
          />
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

  // The columns from 768px: what happened, who played, what was forecast.
  // On a phone the columns are no box at all and the tabs choose.
  const COLUMN = 'flex min-w-0 grow flex-col gap-5 max-md:contents [&:not(:has(>*))]:hidden';

  return (
    <div className="flex flex-col gap-5" data-match-root="">
      <Hero
        centre={centre}
        locale={locale}
        timeZone={timeZone}
        now={now}
        hero={hero}
        words={words}
      />

      <nav
        aria-label={m['matchCentre.onThisPage'].text}
        className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b border-default bg-stage px-2 md:hidden"
        data-testid="section-nav"
      >
        <ul className="flex">
          {tabs.map(([tab, label]) => (
            <li key={tab} className="shrink-0">
              <a
                href={`#${tab}`}
                data-tab-link={tab}
                className="inline-flex min-h-touch items-center px-2.5 text-sm font-medium whitespace-nowrap text-muted"
              >
                <MessageText message={m[label]} />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div
        className="flex flex-col gap-5 md:flex-row md:flex-wrap md:items-start"
        data-match-tabs=""
      >
        <div className={cx(COLUMN, 'md:basis-90')} data-column="events">
          {panels.summary}
          {panels.stats}
        </div>
        <div className={cx(COLUMN, 'md:basis-100')} data-column="teams">
          {panels.lineups}
          {panels.discussion}
        </div>
        <div className={cx(COLUMN, 'md:basis-90')} data-column="forecasts">
          {panels.predictions}
          {panels.watch}
        </div>
      </div>

      {slots.coverage}
    </div>
  );
}

/**
 * The score band (boards h4, h5, h10): competition and round, both sides with
 * their crests, the score large and condensed between them -- each side's
 * goals beside that side in either direction (D-193, `ScorePair`) -- the
 * status (the live minute in red), the stream's freshness stamp (rule 4),
 * where to watch, then the match's facts; after full time the official
 * highlight first.
 */
function Hero({
  centre,
  locale,
  timeZone,
  now,
  hero,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  now: number | undefined;
  hero: MatchHero;
  words: MatchWords;
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
    'block max-w-full font-black leading-[0.95] break-words hyphens-auto',
    naskh
      ? 'text-lg md:text-display-1'
      : 'text-lg uppercase font-stretch-condensed md:text-display-1 lg:text-display-2',
  );
  const figure = cx(
    'font-sans font-black tabular-nums whitespace-nowrap',
    naskh
      ? 'text-display-4 leading-[1.1] md:text-display-5'
      : 'text-display-4 leading-[0.85] font-stretch-condensed md:text-display-6',
  );
  const live = f.status === 'live' && !behind;
  return (
    <header
      className="flex flex-col gap-4 border-b border-default pb-4 md:pb-6"
      data-testid="match-header"
    >
      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-muted">
        <Link
          href={`/${locale}/competition/${f.competition.id}?season=${f.season.id}`}
          className="inline-flex min-h-touch items-center gap-2 underline md:min-h-0"
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
      {/* Home, score, away from the inline start: the whole band mirrors on /fa. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 md:items-center md:gap-10">
        <div data-testid="home-team" className="min-w-0">
          <Link
            href={`/${locale}/team/${f.home.id}`}
            className="flex flex-col items-center gap-2 text-center md:flex-row md:justify-end md:gap-5 md:text-end"
          >
            <bdi className={name}>{f.home.name}</bdi>
            <Crest team={f.home} className="max-md:order-first" />
          </Link>
        </div>
        <div className="flex flex-col items-center gap-2.5">
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
              <span className="mx-[0.12em] align-[0.5em] text-[0.45em] text-caption">–</span>
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
          ) : live ? (
            <LiveBadge
              label={
                status !== m['status.live'].text ? (
                  <MessageText message={m['status.live']} />
                ) : undefined
              }
            >
              <span data-testid="match-status">{status}</span>
            </LiveBadge>
          ) : (
            <span
              className={cx(
                'inline-flex min-h-7.5 items-center gap-2 rounded-pill px-3 text-sm font-extrabold',
                behind ? 'bg-warning/15 text-warning' : 'bg-surface-raised text-fg',
              )}
            >
              <span data-testid="match-status">{status}</span>
            </span>
          )}
        </div>
        <div data-testid="away-team" className="min-w-0">
          <Link
            href={`/${locale}/team/${f.away.id}`}
            className="flex flex-col items-center gap-2 text-center md:flex-row md:justify-start md:gap-5 md:text-start"
          >
            <Crest team={f.away} />
            <bdi className={name}>{f.away.name}</bdi>
          </Link>
        </div>
      </div>

      {/* Under the score, full width so the names keep their columns on a phone:
          the stream's freshness stamp, then where to watch. */}
      {(hero.live !== undefined || hero.watch !== undefined) && (
        <div className="-mt-2 flex flex-col items-center gap-2 text-center">
          {hero.live}
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
        {f.scores.half_time !== null && (
          <li>
            <MessageText message={m['status.halfTime']} />{' '}
            <Score home={f.scores.half_time.home} away={f.scores.half_time.away} locale={locale} />
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
        <li data-testid="last-update">
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
    </header>
  );
}

/** A side's crest on a white tile, so a dark crest reads on the Night stage. */
function Crest({ team, className }: { team: MatchCentre['fixture']['home']; className?: string }) {
  return (
    <span
      className={cx(
        'inline-grid size-14 shrink-0 place-items-center rounded-tile border border-default bg-surface md:size-21 md:rounded-card',
        className,
      )}
    >
      <EntityImage media={team.crest} kind="crest" name={team.name} size={40} aboveFold />
    </span>
  );
}

/**
 * The key events (boards h4, h5): latest first, each with its minute, a
 * mark for its kind and the side, then the players. Kick-off closes the list
 * once the match has started.
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
  return (
    <Module
      title={m[f.status === 'finished' ? 'matchCentre.keyEvents' : 'matchCentre.timeline']}
      module={centre.timeline}
      testId="timeline"
      words={words}
    >
      {(incidents) => {
        // A shoot-out is its own block, its kicks in order and numbered, never
        // penalties at minutes of added time (T-1477).
        const kicksFrom = shootoutStart(incidents, f.scores.penalties);
        const play = kicksFrom === null ? incidents : incidents.slice(0, kicksFrom);
        const rows = [
          ...(kicksFrom === null ? [] : incidents.slice(kicksFrom)).map((i, k) => ({
            i,
            kick: k + 1,
          })),
          ...[...play].reverse().map((i) => ({ i, kick: null })),
        ];
        return (
          <>
            {/* Nothing recorded is said, never an empty card (rule 3). */}
            {incidents.length === 0 && (
              <p dir="auto" className="text-sm text-muted" data-testid="no-events">
                <MessageText message={m['matchCentre.noEventsYet']} />
              </p>
            )}
            <ol className="flex flex-col text-sm">
              {kicksFrom !== null && f.scores.penalties !== null && (
                <li
                  className="border-b border-default py-2.5 font-bold text-fg"
                  data-testid="shootout"
                >
                  <MessageText message={m['matchCentre.shootout']} />{' '}
                  <Score
                    home={f.scores.penalties.home}
                    away={f.scores.penalties.away}
                    locale={locale}
                  />
                </li>
              )}
              {rows.map(({ i, kick }) => (
                <li
                  key={i.id}
                  className="grid grid-cols-[3.5rem_2.25rem_minmax(0,1fr)] items-center gap-3 border-b border-default py-2.5"
                  data-kick={kick ?? undefined}
                >
                  <span className="font-mono text-muted tabular-nums">
                    {kick !== null ? (
                      fill(m['matchCentre.shootoutKick'].text, { n: formatNumber(locale, kick) })
                    ) : (
                      <span dir="ltr">{formatMinute(locale, i.minute, i.added_time)}</span>
                    )}
                  </span>
                  <IncidentMark kind={i.kind} />
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
                      {i.kind === 'substitution' &&
                      i.player !== null &&
                      i.related_player !== null ? (
                        // Who came on and who went off, in words (T-1478): an
                        // arrow between two names said neither.
                        <>
                          <FilledMessage
                            message={m['matchCentre.subOn']}
                            params={{
                              player: (
                                <Link
                                  href={`/${locale}/player/${i.related_player.id}`}
                                  className="underline"
                                >
                                  {listName(locale, i.related_player.name)}
                                </Link>
                              ),
                            }}
                          />
                          {' · '}
                          <FilledMessage
                            message={m['matchCentre.subOff']}
                            params={{
                              player: (
                                <Link
                                  href={`/${locale}/player/${i.player.id}`}
                                  className="underline"
                                >
                                  {listName(locale, i.player.name)}
                                </Link>
                              ),
                            }}
                          />
                        </>
                      ) : (
                        <>
                          {i.player !== null && (
                            <Link href={`/${locale}/player/${i.player.id}`} className="underline">
                              {listName(locale, i.player.name)}
                            </Link>
                          )}
                          {i.related_player !== null &&
                            (i.kind === 'substitution' ? null : (
                              <>
                                {' · '}
                                <FilledMessage
                                  message={m['matchCentre.assist']}
                                  params={{
                                    player: (
                                      <Link
                                        href={`/${locale}/player/${i.related_player.id}`}
                                        className="underline"
                                      >
                                        {listName(locale, i.related_player.name)}
                                      </Link>
                                    ),
                                  }}
                                />
                              </>
                            ))}
                        </>
                      )}
                    </span>
                  </span>
                </li>
              ))}
              {started && (
                <li className="grid grid-cols-[3.5rem_2.25rem_minmax(0,1fr)] items-center gap-3 py-2.5">
                  <span className="font-mono text-muted tabular-nums">
                    {formatKickoff(locale, f.kickoff_at, timeZone)}
                  </span>
                  <IncidentMark kind="kickoff" />
                  <b className="font-bold text-fg">
                    <MessageText message={m['matchCentre.kickedOff']} />
                  </b>
                </li>
              )}
            </ol>
            {incidents.length > 0 && (
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
      className="grid size-9 place-items-center rounded-control bg-surface-raised text-fg"
    >
      {shape}
    </span>
  );
}

/**
 * The team statistics as a dense grid of tiles (T-1384): each metric's two
 * figures large and condensed, its name between them, and the two shares as
 * bars from the middle out -- the home side's in the brand green, the away
 * side's neutral; never a club colour. A side the provider left out is "–"
 * and there is no bar for that row.
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
  return (
    <Module
      title={m['matchCentre.statistics']}
      module={centre.statistics}
      testId="statistics"
      words={words}
    >
      {(rows) => (
        <>
          <ul className="grid grid-cols-1 gap-2 @md:grid-cols-2" data-testid="stat-grid">
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
  const figure = 'text-2xl leading-none font-black font-stretch-condensed tabular-nums';
  return (
    <li
      className="flex flex-col gap-2 rounded-tile bg-surface-raised px-3 py-2.5"
      data-metric={row.metric}
    >
      <div className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_minmax(3rem,auto)] items-center gap-2">
        <b className={figure}>
          <span dir="ltr">{statValue(row.metric, row.home, locale)}</span>
        </b>
        <span className="text-center text-xs text-muted">
          <MessageText message={words.m[STAT_KEY[row.metric]]} />
        </span>
        <b className={cx(figure, 'text-end')}>
          <span dir="ltr">{statValue(row.metric, row.away, locale)}</span>
        </b>
      </div>
      {bars && (
        <div aria-hidden="true" className="flex h-1.5 gap-1">
          <span className="flex flex-1 justify-end overflow-hidden rounded-xs bg-canvas">
            <span
              className="rounded-xs bg-accent"
              style={{ inlineSize: `${((row.home ?? 0) / total) * 100}%` }}
            />
          </span>
          <span className="flex flex-1 overflow-hidden rounded-xs bg-canvas">
            <span
              className="rounded-xs bg-muted"
              style={{ inlineSize: `${((row.away ?? 0) / total) * 100}%` }}
            />
          </span>
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
          <div className="grid grid-cols-1 gap-4 text-sm @md:grid-cols-2">
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
