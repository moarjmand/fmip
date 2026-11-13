import type { CoverageModule, MatchCentre } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import Link from '@/components/ui/link';
import { shootoutStart } from '@/lib/match';
import { formatKickoff, formatStamp } from '@/lib/scores';
import { fill, filled, formatMinute } from '@/lib/words';
import { shortName } from '@/lib/person-name';
import type { MatchWords } from '@/lib/words-server';
import { NAME_WRAP, NARROW_STEPS, nameFit } from '@/lib/word-fit';
import { formatDate, formatDateTime, localDigits } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { ComingCard, type ComingItem } from '@/components/match-centre-cards';
import { LiveBadge } from '@/components/ui/live-badge';
import { FreshnessLine } from '@/components/match-freshness-line';
import { BLEED, type BandState, ScoreBar, bandState } from '@/components/match-score-bar';
import { MessageText } from '@/components/message-text';
import { Score, ScorePair } from '@/components/score';
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
  // The Top rated card (T-1814, D-409), drawn on the server (`match-top-rated.tsx`).
  | 'topRated'
  // Who will or may miss the match (T-1810, D-409), drawn on the server
  // (`match-availability.tsx`): a pre-match answer that does not move in play.
  | 'availability'
  | 'players'
  | 'forecast'
  | 'analysis'
  | 'community'
  | 'discussion'
  | 'watch'
  | 'news'
  // The key events (T-1799, D-397): the two-lane axis, the folded
  // substitutions and the shoot-out's circles, drawn on the server
  // (`match-key-events.tsx`), so none of it is in the page's JavaScript. In
  // every state since T-1812 (D-409); in play `LiveMatch` has it drawn again.
  | 'keyEvents';
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
  /**
   * A finished match decided on penalties (T-1798, D-396): the sentence under
   * the result ("Liverpool win 6–5 on penalties") and the compact bar's mark
   * beside the winner, drawn by the server (`shootoutHero`).
   */
  penalties?: { line: React.ReactNode; home?: React.ReactNode; away?: React.ReactNode };
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

/** Locales whose numerals and names are set in Vazirmatn: no condensed width, a smaller score (D-198). */
const ARABIC_SCRIPT = new Set(['fa', 'ar']);

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
      {/* The server's Stats cards in every state (T-1813, D-409); they leave
          out what the coming card names. */}
      {slots.matchStats}
    </Region>
  );
  const lineupsRegion = (
    <Region id="lineups" tab={lineupsComing ? 'lineups' : undefined}>
      {lineupsComing ? (
        <ComingCard items={coming.filter((item) => item.tab === 'lineups')} words={words} phone />
      ) : (
        // The server's line-ups in every state (T-1814, D-409).
        slots.matchLineups
      )}
    </Region>
  );
  // The match as it went: before kick-off, the one card of what will come.
  const played = (
    <Panel tab="summary">
      <Region id="timeline">
        {coming.length > 0 && <ComingCard items={coming} words={words} />}
        {/* The key events, from the server in every state (T-1812, D-409):
            before kick-off the coming card names them instead. */}
        {!isComing('timeline') && slots.keyEvents}
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
          marks={hero.penalties}
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
            {/* The best rated, from the server (T-1814, D-409). */}
            {slots.topRated}
            {/* Who will miss the match, from the server (T-1810, D-409). */}
            {slots.availability}
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
      {hero.penalties?.line}

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
    // The short form on every page, the Persian one too: the band's column
    // is about 115px on a phone (T-1796, D-395).
    const name = shortName(i.player.name);
    const minutes = by[i.side].get(name) ?? [];
    minutes.push(formatMinute(locale, i.minute, i.added_time));
    by[i.side].set(name, minutes);
  }
  const line = (side: 'home' | 'away') =>
    [...by[side]].map(([name, minutes]): [string, string] => [name, minutes.join(', ')]);
  return { home: line('home'), away: line('away') };
}

/**
 * A side's scorers, broken into lines only between scorers (T-1796, D-395):
 * each scorer is one unbreakable unit, his name isolated (a Latin name
 * inside Persian) and his minutes, the separator held to the unit before it.
 */
function scorerLine(list: [string, string][]) {
  return list.map(([who, at], i) => (
    <Fragment key={who}>
      {i > 0 && '\u00a0· '}
      <span className={cx('whitespace-nowrap', scorerFit(`${who} ${at}`))}>
        <bdi>{who}</bdi>
        {'\u00a0'}
        {at}
      </span>
    </Fragment>
  ));
}

/**
 * A scorer's unit on a phone (D-395): measured at 375, the band's column is
 * 113-116px and "A. Mac Allister 40′" 94-95px at 12px in both fonts, so up
 * to 22 characters stay as drawn; a longer one steps the size down, which
 * Vazirmatn needs too (it has no width axis), Archivo also narrowing.
 */
export function scorerFit(unit: string): string {
  const letters = Array.from(unit).length;
  if (letters <= 22) return '';
  if (letters <= 26) return 'max-md:text-[11px] max-md:font-stretch-semi-condensed';
  return 'max-md:text-[10px] max-md:font-stretch-condensed';
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
