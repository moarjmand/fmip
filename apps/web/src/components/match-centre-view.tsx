import type {
  AbsenceReasonCode,
  CoverageModule,
  ExpectedGoalsMetric,
  MatchAbsence,
  MatchAbsenceGap,
  MatchCentre,
  MatchIncident,
  MatchPlayerExpected,
  MatchPlayerStats,
  MatchStatRow,
  PlayerMatchMetric,
} from '@fmip/contracts';
import { AVAILABILITY_STALE_AFTER_MS, LIVE_STATS_STALE_AFTER_MS } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import Link from '@/components/ui/link';
import { INCIDENT_KEY, STAT_KEY, incidentDetailKey, shootoutStart, statValue } from '@/lib/match';
import { formatKickoff, formatStamp, freshnessStamp } from '@/lib/scores';
import { fill, filled, formatFixed, formatMinute } from '@/lib/words';
import { listName } from '@/lib/person-name';
import type { MatchWords } from '@/lib/words-server';
import { NAME_WRAP, NARROW_STEPS, nameFit } from '@/lib/word-fit';
import { formatDate, formatDateTime, localDigits } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { CARD, ComingCard, type ComingItem, Module } from '@/components/match-centre-cards';
import { LiveBadge } from '@/components/ui/live-badge';
import { RatingChip } from '@/components/ui/rating-chip';
import { StatBar } from '@/components/ui/stat-bar';
import { FreshnessLine } from '@/components/match-freshness-line';
import { FreshnessStamp } from '@/components/freshness-stamp';
import { MatchLineupsView } from '@/components/match-lineups';
import { BLEED, type BandState, ScoreBar, bandState } from '@/components/match-score-bar';
import { MessageText } from '@/components/message-text';
import { Score, ScorePair } from '@/components/score';
import { CoverageBadge, CoverageGlyph } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { Fragment } from 'react';

/** The server-rendered panels the page slots between the live modules (T-605). */
export type MatchSlot =
  // The Summary's opening card (T-1497): what the model forecast, and what happened.
  | 'outcome'
  // The reader's own pick (T-1739, D-360): the card directly under the model's.
  | 'pick'
  // The model's details before kick-off (T-1744): expected goals, likeliest
  // scores and every version, after the pick card. Nothing from kick-off on.
  | 'details'
  | 'summary'
  // What does not move in play, rendered on the server (`match-record.tsx`).
  | 'form'
  | 'headToHead'
  | 'coverage'
  | 'context'
  // The ground's card (T-1438), from the server: a ground does not change in play.
  | 'venue'
  // A finished match's statistics, player tables and xG, and its line-ups, drawn
  // on the server (T-1800..T-1802, `match-stats-panels.tsx`); in play the
  // modules below draw them from the stream.
  | 'matchStats'
  | 'matchLineups'
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
  /**
   * " · Round of 16" after the season: the stage and round, named by the
   * server (`stageAndRoundLabels`), so the stage parser is not in the page's
   * JavaScript (T-1693; a stage does not change while the match is live).
   */
  stage?: React.ReactNode;
  /**
   * The reader's zone in words ("UK time"), said after the full kick-off in
   * the phone's details (T-1743). Resolved by the server: the zone's words
   * are not in the page's JavaScript.
   */
  zone?: string;
  live?: React.ReactNode;
  /**
   * In play, and the page's live stream is stale or unreachable: the compact
   * score bar then drops its live badge, since the band's own line about it
   * is out of sight by the time the bar shows (rule 4).
   */
  streamBroken?: boolean;
  watch?: React.ReactNode;
  highlights?: React.ReactNode;
  /**
   * The notice of a scheduled match long past its kick-off (T-1708, D-343),
   * drawn by the server from the answer's `awaiting_update`, so its words are
   * not in the page's JavaScript. While the match is still scheduled the band
   * draws no kick-off time as its figure and no stream line beside it.
   */
  awaiting?: React.ReactNode;
  /**
   * A finished match whose recorded goals do not add up to its result
   * (T-1717, D-347): the marker beside the score and the line under the band,
   * drawn by the server from the answer's `score_dispute` (`scoreDisputeHero`).
   * The band then draws the score in the quiet colour and no ninety minutes:
   * no number is shown as final.
   */
  disputed?: { marker: React.ReactNode; note: React.ReactNode };
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
 * The pick card (T-1739, D-360) is a Predictions section the Summary also
 * shows: under the model's card there, first on Predictions, one element.
 * While the match is scheduled the Predictions tab opens it (`#pick`).
 * Since T-1744 (D-365) the founder's analysis, the community picks and the
 * approved contributors stand directly after it in the same way (`#analysis`
 * and `#community` inside `#predictions`), each once on the page; the lower
 * Predictions section (`#forecast`) says how the forecast was reached.
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
  context: 'summary',
  news: 'summary',
  stats: 'stats',
  lineups: 'lineups',
  players: 'lineups',
  pick: 'predictions',
  forecast: 'predictions',
  analysis: 'predictions',
  community: 'predictions',
  watch: 'watch',
  discussion: 'discussion',
} as const satisfies Record<string, MatchTab>;

/** The per-player columns the match centre shows (T-101), in reading order. */
export const PLAYER_COLUMNS: readonly [PlayerMatchMetric, Key][] = [
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
export const EXPECTED_COLUMNS: readonly [ExpectedGoalsMetric, Key][] = [
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

/**
 * An absence's reason in our words (T-1601, T-1626), never the feed's
 * English: the key is the code under one prefix. Written as a template and
 * not a table of fifty lines, which the page's JavaScript would carry
 * (T-1746); the type still refuses a code the catalogue has no words for.
 */
const absenceReasonWords = (code: AbsenceReasonCode): Key => `matchCentre.absenceReason.${code}`;

/** An absence's broad kind, when its reason is not one we can name. */
const ABSENCE_KIND_KEY = {
  injury: 'player.availability.kind.injury',
  suspension: 'player.availability.kind.suspension',
  illness: 'player.availability.kind.illness',
  other: 'player.availability.kind.other',
} as const satisfies Record<NonNullable<MatchAbsence['kind']>, Key>;

/** The order a side's absences are read in: who is out, then who may be. */
const ABSENCE_KIND_ORDER = ['suspension', 'injury', 'illness', 'other'] as const;

/**
 * One side's absences in reading order (T-1626): out before doubtful, then
 * suspended, injured, ill and the rest, then by name. Pure.
 */
export function absenceOrder(absences: MatchAbsence[]): MatchAbsence[] {
  const kind = (a: MatchAbsence) =>
    a.kind === null ? ABSENCE_KIND_ORDER.length : ABSENCE_KIND_ORDER.indexOf(a.kind);
  return [...absences].sort(
    (a, b) =>
      Number(a.status === 'doubtful') - Number(b.status === 'doubtful') ||
      kind(a) - kind(b) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The reason a reader sees (T-1626): ours from `reason_code`, else the broad
 * kind, else -- on an English page only -- the feed's own words; never the
 * feed's English on a page in another language (T-1601).
 */
export function absenceReasonKey(a: MatchAbsence): Key | null {
  if (a.reason_code !== undefined && a.reason_code !== null)
    return absenceReasonWords(a.reason_code);
  return a.kind === null ? null : ABSENCE_KIND_KEY[a.kind];
}

/** Locales whose numerals and names are set in Vazirmatn: no condensed width, a smaller score (D-198). */
const ARABIC_SCRIPT = new Set(['fa', 'ar']);

/** One player cell: the provider's rating to one decimal, a count as it is, `–` when not supplied. */
export function playerCell(
  locale: string,
  player: MatchPlayerStats,
  metric: PlayerMatchMetric,
): string {
  const value = player.stats[metric];
  if (value === undefined) return '–';
  return metric === 'rating' ? formatFixed(locale, value, 1) : formatNumber(locale, value);
}

/**
 * One section of the page, the target of an anchor. Its top clears the
 * sticky score bar and tabs when jumped to (`--match-stack`, their height
 * and a little air, set in `globals.css`; T-1742); with nothing in it, it is
 * not rendered. `tab`
 * makes it a tab's whole panel (Stats, Watch, Discussion); `also` names a
 * second tab that shows it on a phone (the pick card, `globals.css`).
 */
function Region({
  id,
  tab,
  also,
  children,
}: {
  id: string;
  tab?: MatchTab;
  also?: MatchTab;
  children?: React.ReactNode;
}) {
  if (children === undefined || children === null || children === false) return null;
  return (
    <div
      id={id}
      className="flex min-w-0 scroll-mt-(--match-stack) flex-col gap-3 md:gap-5"
      data-testid={`section-${id}`}
      data-tab={tab}
      data-tab-also={also}
    >
      {children}
    </div>
  );
}

/** A tab's panel that holds several sections (Summary, Line-ups, Predictions). */
function Panel({ tab, id, children }: { tab: MatchTab; id?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className="flex min-w-0 scroll-mt-(--match-stack) flex-col gap-3 md:gap-5"
      data-tab={tab}
    >
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

  // Before kick-off the in-play modules with nothing yet are one card
  // (T-1745, D-366), not an empty card each: `coming` is what it names.
  const coming = comingModules(centre);
  const isComing = (id: ComingItem['id']) => coming.some((item) => item.id === id);
  const statsComing = coming.filter((item) => item.tab === 'stats');
  const lineupsComing = isComing('lineups');
  // A tab whose every module is in that card holds, on a phone, a copy of the
  // card for its own modules and nothing else. From 768px the copy is not
  // drawn, so the tab's section is lifted to stand directly above the
  // Summary's card: its jump link then lands on the card that names it.
  const statsLifted = statsComing.length === 3;

  const statsRegion = (
    <Region id="stats" tab="stats">
      {statsComing.length > 0 && <ComingCard items={statsComing} words={words} phone />}
      {slots.matchStats ?? (
        <>
          {!isComing('statistics') && (
            <Statistics centre={centre} locale={locale} now={now} words={words} />
          )}
          {!isComing('player_statistics') && (
            <PlayerStatistics centre={centre} locale={locale} words={words} />
          )}
          {!isComing('expected_goals') && (
            <PlayerExpectedGoals centre={centre} locale={locale} words={words} />
          )}
        </>
      )}
    </Region>
  );
  const lineupsRegion = (
    <Region id="lineups" tab={lineupsComing ? 'lineups' : undefined}>
      {lineupsComing ? (
        <ComingCard items={coming.filter((item) => item.tab === 'lineups')} words={words} phone />
      ) : (
        (slots.matchLineups ?? (
          <Module
            title={m['matchCentre.lineups']}
            module={centre.lineups}
            testId="lineups"
            words={words}
            empty={f.status === 'scheduled' ? 'matchCentre.lineupsNotYet' : null}
            notInYet={f.status === 'live'}
            before={unplayed(centre)}
          >
            {(lineups) => (
              <MatchLineupsView
                home={f.home}
                away={f.away}
                lineups={lineups}
                ratings={ratingsOf(centre)}
                locale={locale}
                words={words}
              />
            )}
          </Module>
        ))
      )}
    </Region>
  );
  // The match as it went: before kick-off, the one card of what will come.
  const played = (
    <Panel tab="summary">
      <Region id="timeline">
        {coming.length > 0 && <ComingCard items={coming} words={words} />}
        {!isComing('timeline') && (
          <Timeline centre={centre} locale={locale} timeZone={timeZone} words={words} />
        )}
      </Region>
      {slots.summary}
    </Panel>
  );

  const panels: Record<MatchTab, React.ReactNode> = {
    summary: (
      <>
        <Panel tab="summary" id="summary">
          {/* What the model forecast and what happened (T-1497). */}
          {slots.outcome}
        </Panel>
        {/* The reader's pick, directly under the model's card (T-1739): a
            Predictions section, outside the Summary's panel so that tab shows it too. */}
        <Region id="pick" tab="predictions" also="summary">
          {slots.pick}
        </Region>
        {/* Before kick-off, the model's details after the pick (T-1744). */}
        {has('details') && <Panel tab="summary">{slots.details}</Panel>}
        {/* The other predictions of this match, each once on the page and
            each its own section (rule 6; T-1744, D-365): the founder's
            analysis, then the community picks and the approved contributors.
            Predictions sections the Summary also shows, as the pick is. */}
        {present.predictions && (
          <Region id="predictions" tab="predictions" also="summary">
            <Region id="analysis">{slots.analysis}</Region>
            <Region id="community">{slots.community}</Region>
          </Region>
        )}
        {statsLifted || lineupsComing ? (
          // No box on a phone, where the tabs choose; from 768px one block
          // with no gap, the lifted sections empty above the card.
          <div className="contents md:flex md:flex-col" data-coming-anchors="">
            {statsLifted && statsRegion}
            {lineupsComing && lineupsRegion}
            {played}
          </div>
        ) : (
          played
        )}
      </>
    ),
    stats: statsLifted ? null : statsRegion,
    lineups:
      !lineupsComing || has('players') ? (
        <Panel tab="lineups">
          {!lineupsComing && lineupsRegion}
          <Region id="players">{slots.players}</Region>
        </Panel>
      ) : null,
    // How the model's forecast was reached, and the Power Index (T-1744):
    // the forecast itself is the Summary's card, and the other predictions
    // stand after the pick.
    predictions: (
      <Region id="forecast" tab="predictions">
        {slots.forecast}
      </Region>
    ),
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

  // The score, the status and whether the feed is behind, read once: the
  // band and the compact bar are drawn from the same answer (T-1742, rule 4).
  const state = bandState(f, hero, { locale, timeZone, now, words });
  // The pick is open: the Predictions tab leads to its card (D-360).
  const pick = has('pick') && f.status === 'scheduled';

  return (
    <div className="flex flex-col gap-5 md:gap-6" data-match-root="" data-status={f.status}>
      <Hero
        centre={centre}
        locale={locale}
        timeZone={timeZone}
        now={now}
        hero={hero}
        words={words}
        state={state}
      />

      {/* The sticky stack (T-1742, D-363): the tab row, a child of the page
          column so it holds for the whole page, and above it the compact
          score bar, which takes no height and shows once the band has gone
          (`globals.css`). The negative margin closes the column's gap, so
          the tabs sit at the band's foot as before. */}
      <div className="sticky z-10 -mt-5 md:-mt-6" data-match-sticky="">
        <ScoreBar
          fixture={f}
          state={state}
          stale={hero?.streamBroken === true}
          locale={locale}
          words={words}
        />
        {/* The section tabs (Design System `Tabs`): plain anchors, the saffron
            edge under the one on show (globals.css), scrolling sideways on a phone. */}
        <nav
          aria-label={m['matchCentre.onThisPage'].text}
          className={cx('-mx-4 overflow-x-auto bg-surface px-2 md:mx-0 md:px-0', BLEED)}
          data-testid="section-nav"
        >
          <ul className="flex gap-0.5">
            {tabs.map(([tab, label]) => (
              <li key={tab} className="shrink-0">
                <a
                  href={`#${pick && tab === 'predictions' ? 'pick' : tab}`}
                  data-tab-link={tab}
                  className="inline-flex min-h-touch items-center px-3 text-sm font-semibold whitespace-nowrap text-muted hover:text-fg"
                >
                  <MessageText message={m[label]} />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* On a phone the cards stand 0.75rem apart and the first one closer to
          the tabs, so the model's bar and the pick's three outcomes are both
          on the first screen before kick-off (T-1743, board P2-4). */}
      <div
        className="-mt-2 flex flex-col gap-3 md:mt-0 md:flex-row md:flex-wrap md:items-start md:gap-6"
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
          <div className="flex min-w-0 flex-col gap-3 md:gap-5" data-tab="summary">
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
            <div className="flex min-w-0 flex-col gap-3 md:gap-5" data-tab="stats">
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
 * T-1497): on the surface, across the page. On a phone it is short (T-1743,
 * D-364; board P2-4): the competition line, the sides and the figure, one
 * line for the date and the ground, and one freshness line whose "Details"
 * hold the rest of the facts and where to watch; nothing between them but
 * what the match's state adds (the live badge and minute, a feed behind, a
 * notice). From 768px it is as it was. Competition and round; both
 * sides with their crests, the score large and narrow between them -- each
 * side's goals beside that side in either direction (D-193, `ScorePair`) --
 * and each side's scorers under its name; live, the saffron live badge above
 * the score, the minute along a bar and the stream's freshness stamp under
 * it (rule 4); where to watch; the match's facts; and after full time the
 * official highlight. The section tabs follow it, outside it, so they can
 * stick (T-1742); the band is the view timeline the compact score bar waits
 * on (`data-match-band`, `globals.css`).
 */
function Hero({
  centre,
  locale,
  timeZone,
  now,
  hero,
  words,
  state,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  now: number | undefined;
  hero: MatchHero;
  words: MatchWords;
  /** The score and status, shared with the compact bar (T-1742). */
  state: BandState;
}) {
  const m = words.m;
  const n = (value: number): string => formatNumber(locale, value);
  const f = centre.fixture;
  const naskh = ARABIC_SCRIPT.has(locale);
  // Scheduled with the kick-off long past and no word from the feed (T-1708,
  // D-343), `awaiting`: the band says so, and draws neither the kick-off time
  // as its figure nor the stream's "last checked", which is our check, not
  // the match's.
  const { headline, status, behind, awaiting, live } = state;
  // Goals and result disagree (T-1717, D-347): no number is drawn as final.
  const disputed = state.disputed ? hero.disputed : undefined;
  // After extra time the band also says the ninety minutes (D-317).
  const ninety = f.scores.extra_time !== null && !disputed ? f.scores.full_time : null;
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
  // The facts, said once and placed twice: in a row under the band from
  // 768px, and on a phone on the ground's line or behind "Details" (T-1743).
  const facts = {
    venue:
      venue === null ? null : f.is_neutral_venue ? (
        <MessageText message={filled(m['matchCentre.neutralVenue'], { venue })} />
      ) : (
        venue
      ),
    referee: (
      <MessageText
        message={filled(m['matchCentre.referee'], {
          name: f.referee === null ? m['status.coverage.notSupplied'].text : f.referee.name,
        })}
      />
    ),
    attendance:
      f.attendance === null ? null : (
        <MessageText message={filled(m['matchCentre.attendance'], { count: n(f.attendance) })} />
      ),
    aggregate:
      f.scores.aggregate === null ? null : (
        <>
          <MessageText message={m['status.aggregate']} />{' '}
          <Score home={f.scores.aggregate.home} away={f.scores.aggregate.away} locale={locale} />
        </>
      ),
    penalties:
      f.scores.penalties === null ? null : (
        <>
          <MessageText message={m['status.penalties']} />{' '}
          <Score home={f.scores.penalties.home} away={f.scores.penalties.away} locale={locale} />
        </>
      ),
    lastUpdate:
      checked === null ? (
        <FilledMessage
          message={m['matchCentre.lastUpdate']}
          params={{ time: at(f.last_updated_at) }}
        />
      ) : (
        <FilledMessage
          message={m['matchCentre.lastChecked']}
          params={{ time: at(checked), changed: at(f.last_updated_at) }}
        />
      ),
  };
  const kickoffFull = (
    <time dateTime={f.kickoff_at}>{formatDateTime(locale, f.kickoff_at, timeZone)}</time>
  );
  const kickoffDay = (
    <time dateTime={f.kickoff_at}>
      {formatDate(locale, f.kickoff_at, timeZone, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })}
    </time>
  );
  // Whole words only (T-1796, D-395): a single long word steps its width
  // down on a phone, where the cell holds about ten letters (96px at 375).
  const name = (team: string) =>
    cx(
      'block max-w-full text-base leading-tight font-extrabold md:text-3xl md:leading-none',
      NAME_WRAP,
      nameFit(team, 10, NARROW_STEPS),
    );
  const figure = cx(
    'font-sans font-extrabold tabular-nums whitespace-nowrap',
    naskh
      ? 'text-display-3 leading-[1.1] md:text-display-5'
      : 'text-display-4 leading-[0.9] font-stretch-condensed md:text-display-5',
    f.status === 'live' && !behind && 'text-live',
    disputed && 'text-muted',
  );
  const scorers = scorersOf(centre, locale);
  // Each side's name is a 44px target on a phone (T-1553), centred in its
  // column there; from 768px the line's own height, aligned by its row.
  const teamLink = 'flex min-h-touch min-w-0 items-center justify-center md:block md:min-h-0';
  return (
    <header
      className={cx('flex flex-col bg-surface md:gap-5 md:py-4', BLEED)}
      data-match-band=""
      data-testid="match-header"
    >
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-caption max-md:min-h-7">
        {/* A 44px target on a phone whose lower 16px lie over the band's top,
            which holds no control there: the line itself reads as 28px. */}
        <Link
          href={`/${locale}/competition/${f.competition.id}?season=${f.season.id}`}
          className="inline-flex min-h-touch items-center gap-2 font-semibold text-muted underline max-md:-mb-4 max-md:items-start max-md:pt-1 md:min-h-0"
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
          · {localDigits(locale, f.season.label)}
          {hero.stage}
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
        // The live badge (Design System `LiveBadge`, T-1523); when the feed has
        // fallen behind, amber words and no badge: the match is not shown as
        // live while its state may be old (rule 4).
        <p
          className="flex justify-center max-md:my-1 md:-mb-2"
          data-testid="live-badge"
          data-live={live}
        >
          {live ? (
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
            <span className="inline-flex min-h-7.5 items-center rounded-pill bg-warning/15 px-3 text-sm font-extrabold text-warning">
              <span data-testid="match-status">{status}</span>
            </span>
          )}
        </p>
      )}

      {/* Home, score, away from the inline start: the whole band mirrors on /fa. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 max-md:pt-1 md:items-center md:gap-8">
        <div data-testid="home-team" className="min-w-0">
          <div className="flex flex-col items-center text-center md:flex-row md:justify-end md:gap-5 md:text-end">
            <span className="flex max-w-full min-w-0 flex-col gap-1.5">
              <Link href={`/${locale}/team/${f.home.id}`} className={teamLink}>
                <bdi className={name(f.home.name)}>{f.home.name}</bdi>
              </Link>
              {scorers.home.length > 0 && (
                <span
                  className="text-xs text-muted max-md:pb-1.5 md:text-sm"
                  data-testid="scorers-home"
                >
                  {scorerLine(scorers.home)}
                </span>
              )}
            </span>
            <Crest team={f.home} className="max-md:order-first" />
          </div>
        </div>
        <div
          className={cx(
            'flex flex-col items-center gap-2',
            // Before kick-off the time stands alone on a phone, level with the sides.
            f.status === 'scheduled' && !awaiting && 'max-md:self-center',
          )}
        >
          {f.status === 'scheduled' && !awaiting ? (
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
            // On a phone the day shares the ground's line under the band (T-1743).
            <span className="text-sm font-semibold text-muted max-md:hidden">{kickoffDay}</span>
          ) : (
            f.status !== 'live' && (
              <span className="text-xs font-bold text-muted md:text-sm">
                <span data-testid="match-status">{status}</span>
                {f.scores.penalties !== null && (
                  <>
                    {' '}
                    <Score
                      home={f.scores.penalties.home}
                      away={f.scores.penalties.away}
                      locale={locale}
                    />
                  </>
                )}
                {ninety !== null && (
                  <span data-testid="ninety">
                    {' · '}
                    <MessageText message={m['status.regularTime']} />{' '}
                    <Score home={ninety.home} away={ninety.away} locale={locale} />
                  </span>
                )}
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
          {disputed?.marker}
        </div>
        <div data-testid="away-team" className="min-w-0">
          <div className="flex flex-col items-center text-center md:flex-row md:justify-start md:gap-5 md:text-start">
            <Crest team={f.away} />
            <span className="flex max-w-full min-w-0 flex-col gap-1.5">
              <Link href={`/${locale}/team/${f.away.id}`} className={teamLink}>
                <bdi className={name(f.away.name)}>{f.away.name}</bdi>
              </Link>
              {scorers.away.length > 0 && (
                <span
                  className="text-xs text-muted max-md:pb-1.5 md:text-sm"
                  data-testid="scorers-away"
                >
                  {scorerLine(scorers.away)}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Live: the minute along the match, then kick-off and the stream's stamp. */}
      {f.status === 'live' && (
        <div className="flex flex-col gap-1.5 max-md:my-2" data-testid="live-progress">
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
      {(hero.watch !== undefined ||
        (f.status !== 'live' && !awaiting && hero.live !== undefined)) && (
        <div className="flex flex-col items-center gap-2 text-center md:-mt-1">
          {f.status !== 'live' && !awaiting && hero.live}
          {/* From 768px the watch line stands here; on a phone it is in the details. */}
          {hero.watch !== undefined && <div className="max-md:hidden">{hero.watch}</div>}
        </div>
      )}

      {/* What the match's state adds: one group on a phone, where the band
          has no gap of its own; from 768px each is the band's own child. */}
      <div className="flex flex-col gap-2 empty:hidden max-md:my-1 md:contents">
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
        {awaiting && hero.awaiting}
        {disputed?.note}

        {hero.highlights}
      </div>

      {/* A phone (T-1743): the day and the ground on one line -- with the
          aggregate, a score a reader should not have to open anything for --
          then the freshness line, the rest of the facts behind its "Details". */}
      <div className="flex flex-col md:hidden" data-testid="match-facts-phone">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm text-muted">
          {kickoffDay}
          {facts.venue !== null && (
            <span>
              · <bdi>{facts.venue}</bdi>
            </span>
          )}
          {facts.aggregate !== null && <span>· {facts.aggregate}</span>}
        </p>
        <FreshnessLine
          checkedAt={f.last_checked_at}
          changedAt={f.last_updated_at}
          // The data may be old: in play and behind (D-045), or the kick-off
          // long past with no word (D-343). Said in the line, not behind it.
          stale={behind || (f.status === 'scheduled' && f.freshness === 'awaiting_update')}
          locale={locale}
          timeZone={timeZone}
          now={now}
          words={words}
        >
          <li>{facts.lastUpdate}</li>
          <li>
            {hero.zone === undefined ? (
              <FilledMessage message={m['scores.card.kickoff']} params={{ time: kickoffFull }} />
            ) : (
              <FilledMessage
                message={m['matchCentre.kickoffIn']}
                params={{ time: kickoffFull, zone: hero.zone }}
              />
            )}
          </li>
          <li>{facts.referee}</li>
          {facts.attendance !== null && <li>{facts.attendance}</li>}
          {facts.penalties !== null && <li>{facts.penalties}</li>}
          {/* Nothing listed and nothing to say: the watch line draws nothing. */}
          {hero.watch !== undefined && <li className="empty:hidden">{hero.watch}</li>}
        </FreshnessLine>
      </div>

      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted max-md:hidden">
        <li>
          <FilledMessage message={m['scores.card.kickoff']} params={{ time: kickoffFull }} />
        </li>
        {facts.venue !== null && (
          <li>
            <bdi>{facts.venue}</bdi>
          </li>
        )}
        <li>{facts.referee}</li>
        {facts.attendance !== null && <li>{facts.attendance}</li>}
        {facts.aggregate !== null && <li>{facts.aggregate}</li>}
        {facts.penalties !== null && <li>{facts.penalties}</li>}
        <li
          data-testid="last-update"
          className="font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        >
          <span aria-hidden="true">● </span>
          {facts.lastUpdate}
        </li>
      </ul>
    </header>
  );
}

/**
 * A postponed or cancelled match was not played (T-1550): its modules say
 * so, rather than "Not supplied". `null` for every other match.
 */
function unplayed(centre: MatchCentre): 'unplayed' | null {
  const status = centre.fixture.status;
  return status === 'postponed' || status === 'cancelled' ? 'unplayed' : null;
}

/**
 * The in-play modules: each one's title, the tab that holds it, the season
 * coverage it falls under, and its data in the match's payload.
 */
const IN_PLAY = [
  ['timeline', 'matchCentre.timeline', 'summary', 'incidents', (c) => c.timeline.data],
  ['statistics', 'matchCentre.statistics', 'stats', 'statistics', (c) => c.statistics.data],
  [
    'player_statistics',
    'matchCentre.playerStatistics',
    'stats',
    'advanced_statistics',
    (c) => c.player_statistics.data,
  ],
  [
    'expected_goals',
    'matchCentre.expectedGoals',
    'stats',
    'advanced_statistics',
    (c) => c.player_expected_goals.data,
  ],
  ['lineups', 'matchCentre.lineups', 'lineups', 'lineups', (c) => c.lineups.data],
] as const satisfies readonly (readonly [
  ComingItem['id'],
  Key,
  ComingItem['tab'],
  CoverageModule,
  (centre: MatchCentre) => unknown,
])[];

/**
 * What the "After kick-off you'll see" card names (T-1745, D-366): before
 * kick-off, every in-play module with nothing yet, with what the season's
 * declared coverage says of it -- `coming` where it is covered, `limited`
 * and `delayed` as declared, `not_supplied` where the season does not cover
 * it and it will not come (rule 3). None once there is play, for a postponed
 * or cancelled match, or for one long past its kick-off with no word from
 * the feed (T-1708): then each module says its own state. A module that
 * already has data -- line-ups, about an hour before kick-off -- is not in
 * the list and is drawn as itself. Pure.
 */
export function comingModules(centre: MatchCentre): ComingItem[] {
  const f = centre.fixture;
  if (f.status !== 'scheduled' || f.freshness === 'awaiting_update') return [];
  return IN_PLAY.filter(([, , , , data]) => data(centre) === null).map(
    ([id, title, tab, module]) => {
      const coverage = centre.coverage[module];
      return { id, title, tab, state: coverage === 'available' ? 'coming' : coverage };
    },
  );
}

/**
 * Each side's scorers for the band, "Jackson 6′, 60′", in the order they
 * scored, as [name, minutes] pairs. None at all when the timeline holds an own goal: which side it
 * counts for is not certain from the feed, and a scorer under the wrong
 * name would be invented (rule 3; the alerts make the same choice).
 */
function scorersOf(
  centre: MatchCentre,
  locale: string,
): Record<'home' | 'away', [string, string][]> {
  const none = { home: [], away: [] };
  const recorded = centre.timeline.data;
  if (recorded === null || recorded.some((i) => i.kind === 'own_goal')) return none;
  // A shoot-out's kicks are not goals of the match (T-1550): the band names
  // the scorers of play only, as the timeline splits them (T-1477).
  const kicksFrom = shootoutStart(
    recorded,
    centre.fixture.scores.penalties,
    centre.fixture.scores.current,
  );
  const incidents = kicksFrom === null ? recorded : recorded.slice(0, kicksFrom);
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
    [...by[side]].map(([name, minutes]): [string, string] => [name, minutes.join(', ')]);
  return { home: line('home'), away: line('away') };
}

/**
 * A side's scorers as one line that breaks only between scorers (T-1796,
 * D-395): each name isolated (a Latin name inside Persian), held to its
 * minutes by a no-break space, the minutes never split.
 */
function scorerLine(list: [string, string][]) {
  return list.map(([who, at], i) => (
    <Fragment key={who}>
      {i > 0 && ' · '}
      <bdi>{who}</bdi>
      {'\u00a0'}
      <span className="whitespace-nowrap">{at}</span>
    </Fragment>
  ));
}

/** A side's crest on a white tile, so a dark crest reads on the Night ground. */
function Crest({ team, className }: { team: MatchCentre['fixture']['home']; className?: string }) {
  return (
    <span
      className={cx(
        'inline-grid size-12 shrink-0 place-items-center rounded-tile border border-default bg-surface md:size-21 md:rounded-card',
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
      before={unplayed(centre)}
    >
      {(incidents) => {
        // A shoot-out is its own block, its kicks in order and numbered, never
        // penalties at minutes of added time (T-1477).
        const kicksFrom = shootoutStart(incidents, f.scores.penalties, f.scores.current);
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
 * While it is on and they have come, "Stats updated 2 min ago" under them
 * (T-1782, rule 4): asked every few minutes in play, they can stop while the
 * score moves (the budget's standard share spent, the provider refusing),
 * so past `LIVE_STATS_STALE_AFTER_MS` the line turns to "may be behind".
 */
function Statistics({
  centre,
  locale,
  now,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  now: number | undefined;
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
      before={unplayed(centre)}
    >
      {(rows) => (
        <>
          <p aria-hidden="true" className="-mt-1 flex gap-3.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-fg" />
              <bdi>{f.home.name}</bdi>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-caption" />
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
          {f.status === 'live' && centre.statistics.last_updated_at !== null && (
            <FreshnessStamp
              checkedAt={centre.statistics.last_updated_at}
              now={now}
              staleAfterMs={LIVE_STATS_STALE_AFTER_MS}
              locale={locale}
              words={{
                'freshness.checked': m['matchCentre.statsUpdated'],
                'freshness.behind': m['freshness.behind'],
              }}
              testId="stats-freshness"
            />
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
  return (
    <li data-metric={row.metric}>
      <StatBar
        label={<MessageText message={words.m[STAT_KEY[row.metric]]} />}
        home={row.home}
        away={row.away}
        homeText={statValue(row.metric, row.home, locale)}
        awayText={statValue(row.metric, row.away, locale)}
      />
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
      before={unplayed(centre)}
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
 * its own under the player statistics: "Expected goals by player", from
 * licensed match data, never named by its provider (D-014, T-1802), never a
 * column of the table above, `–` for a figure the source did not supply, and
 * an explicit state when it supplied none (rule 3). In play only: a finished
 * match's card is the server's (`match-stats-panels.tsx`, F9).
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
      before={unplayed(centre)}
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

/** One group of a side's absences: who, by status and by why (T-1746). */
export interface AbsenceGroup {
  status: MatchAbsence['status'];
  /** The group's reason in our words; `null` when the feed gave none we can name. */
  reason: Key | null;
  /** Closed whole behind "Show N names": a selection choice, not an injury. */
  folded: boolean;
  absences: MatchAbsence[];
}

/** How many of a group stand open before "Show N more". */
export const ABSENCES_SHOWN = 4;

/** A reason code that says no more than its broad kind does. */
const GENERIC_REASON = new Set<AbsenceReasonCode>(['injury', 'suspended', 'illness']);

/**
 * One side's absences grouped by status and by why (T-1746, D-367; board
 * P2-5), in reading order (`absenceOrder`): an injury, a suspension or an
 * illness by its broad kind, so "Out · Injury (7)" holds the knee and the
 * calf alike; every other reason by its own code, so "Not in the squad" is
 * its own group and never weighs like an injury. Pure.
 */
export function absenceGroups(absences: MatchAbsence[]): AbsenceGroup[] {
  const groups = new Map<string, AbsenceGroup>();
  for (const a of absenceOrder(absences)) {
    const broad = a.kind !== null && a.kind !== 'other';
    const by = broad ? a.kind : (a.reason_code ?? a.kind ?? 'none');
    const key = `${a.status}:${by}`;
    const group = groups.get(key) ?? {
      status: a.status,
      reason: a.kind !== null && broad ? ABSENCE_KIND_KEY[a.kind] : absenceReasonKey(a),
      folded: !broad && a.reason_code === 'off_roster',
      absences: [],
    };
    group.absences.push(a);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * What a row adds to its group's reason: the specific one ("Knee injury"
 * under "Injury"), nothing when it says the same.
 */
function rowReasonKey(a: MatchAbsence, group: AbsenceGroup): Key | null {
  const key = absenceReasonKey(a);
  if (key === null || key === group.reason) return null;
  return a.reason_code != null && GENERIC_REASON.has(a.reason_code) ? null : key;
}

/**
 * Who will or may miss the match (T-103), each side's list grouped by status
 * and by why with a count -- "Out · Injury (7)", "Out · Not in the squad
 * (5)" -- the status an icon and a word; a long group shows its first four
 * and folds the rest behind a native `<details>` ("Show 3 more"), and the
 * squad-selection group is closed whole ("Show 5 names"). No script. When
 * the feed was asked stands under the list, as before (rule 4).
 */
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
  const row = (a: MatchAbsence, group: AbsenceGroup) => {
    const reason = rowReasonKey(a, group);
    return (
      <li
        key={a.id}
        className="flex flex-wrap items-baseline justify-between gap-x-3"
        data-status={a.status}
        data-kind={a.kind ?? undefined}
      >
        <Link href={`/${locale}/player/${a.id}`}>{listName(locale, a.name)}</Link>
        {reason !== null ? (
          <span className="text-muted">
            <MessageText message={m[reason]} />
          </span>
        ) : group.reason === null && locale === 'en' && a.reason !== null ? (
          // A reason we cannot name: the feed's own words, on an English page only (T-1601).
          <span className="text-muted">{a.reason}</span>
        ) : null}
      </li>
    );
  };
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
          <div className="flex flex-col gap-4 text-sm">
            {(
              [
                ['home', f.home.name],
                ['away', f.away.name],
              ] as const
            ).map(([side, team]) => {
              const groups = absenceGroups(absences.filter((a) => a.side === side));
              if (groups.length === 0) return null;
              return (
                <div key={side} className="flex flex-col gap-2.5" data-absence-side={side}>
                  <h3 className="font-bold">{team}</h3>
                  {groups.map((group) => {
                    const count = formatNumber(locale, group.absences.length);
                    const status =
                      m[group.status === 'out' ? 'matchCentre.out' : 'matchCentre.doubtful'].text;
                    const open = group.folded ? [] : group.absences.slice(0, ABSENCES_SHOWN);
                    const rest = group.absences.slice(open.length);
                    return (
                      <div
                        key={`${group.status}:${group.reason ?? 'none'}`}
                        className="flex flex-col gap-1"
                        data-absence-group={group.status}
                        data-count={group.absences.length}
                      >
                        <h4 className="inline-flex items-center gap-1.5 text-xs font-extrabold text-muted">
                          {/* The status is an icon and a word: struck for out, half for doubtful. */}
                          <CoverageGlyph
                            state={group.status === 'out' ? 'not_supplied' : 'limited'}
                          />
                          <MessageText
                            message={
                              group.reason === null
                                ? filled(m['matchCentre.absences.groupPlain'], { status, count })
                                : filled(m['matchCentre.absences.group'], {
                                    status,
                                    reason: m[group.reason].text,
                                    count,
                                  })
                            }
                          />
                        </h4>
                        {open.length > 0 && (
                          <ul className="flex flex-col gap-1">{open.map((a) => row(a, group))}</ul>
                        )}
                        {rest.length > 0 && (
                          <details data-testid="absences-more">
                            <summary className="inline-flex min-h-touch cursor-pointer items-center font-semibold underline md:min-h-0">
                              <MessageText
                                message={filled(
                                  m[
                                    group.folded
                                      ? 'matchCentre.absences.names'
                                      : 'matchCentre.absences.more'
                                  ],
                                  { count: formatNumber(locale, rest.length) },
                                )}
                              />
                            </summary>
                            <ul className="mt-1 flex flex-col gap-1">
                              {rest.map((a) => row(a, group))}
                            </ul>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {askedStamp !== null && (
              // When the feed was asked, under the list too (rule 4).
              <p className="text-xs text-muted" data-testid="absences-asked">
                <MessageText
                  message={filled(m['matchCentre.absencesAsked'], { time: askedStamp.text })}
                />
                {askedStamp.stale && (
                  <>
                    {' '}
                    <MessageText message={m['player.availability.stale']} />
                  </>
                )}
              </p>
            )}
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
        <RatingChip
          value={ratings.get(top.id) ?? 0}
          text={formatFixed(locale, ratings.get(top.id) ?? 0, 1)}
          className="ms-auto"
        />
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
            <RatingChip
              value={ratings.get(p.id) ?? 0}
              text={formatFixed(locale, ratings.get(p.id) ?? 0, 1)}
              className="ms-auto"
            />
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
