import type { ScoreCard } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { EntityImage } from '@/components/entity-image';
import { LiveStripAge } from '@/components/live-strip-age';
import { MessageText } from '@/components/message-text';
import { LtrNumeric, ScorePair } from '@/components/score';
import { ScrollRow } from '@/components/scroll-row';
import { formatNumber } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import type { ChipState } from '@/lib/live-strip';

/**
 * The matchday rail's drawer (T-1624, D-292; the live strip of T-1381,
 * D-199, which it replaces as a bar of its own): one league's matches today
 * as a row of score chips that scrolls sideways, each opening its match,
 * then a link to the league's page. `components/matchday-rail.tsx` builds
 * one per league that plays today; the rail shows the chosen one.
 *
 * When the answer may be behind, the drawer says so (rule 4,
 * `LiveStripAge`), and its live chips read "Behind" in place of the minute
 * (T-1635). The rail asks for a new drawer while a match is being played
 * (D-297), so that happens only when the answers stop coming. On the surface
 * of the theme, as the header is (D-267).
 */
export function RailDrawer({
  locale,
  competition,
  chips,
  label,
  open,
  versus,
  note,
  behindAt,
  behind,
}: {
  locale: string;
  competition: string;
  chips: readonly { card: ScoreCard; state: ChipState }[];
  /** "Today · Pro League", resolved, with its marking. */
  label: Message;
  /** "Open Pro League": the last link, to the league's page. */
  open: Message;
  /** What stands between two names before a score exists: "v", "–" in Persian. */
  versus: Message;
  note: Message;
  behindAt: number | null;
  behind: boolean;
}) {
  const labelId = 'live-strip-label';
  return (
    <nav
      aria-labelledby={labelId}
      data-testid="live-strip"
      data-competition={competition}
      className="border-b border-default bg-surface"
    >
      <div className="page-frame flex items-center gap-3 py-2">
        {/* The design gives a phone no room for it; a screen reader still hears it. */}
        <span
          id={labelId}
          className="sr-only text-xs font-bold tracking-widest whitespace-nowrap text-caption uppercase md:not-sr-only md:shrink-0"
          data-testid="live-strip-label"
        >
          <MessageText message={label} />
        </span>
        <LiveStripAge behindAt={behindAt} initiallyBehind={behind} note={note}>
          <ScrollRow className="flex-1" listClassName="flex gap-2" testId="live-strip-chips">
            {chips.map(({ card, state }) => (
              <li key={card.id} className="shrink-0">
                <ScoreChip locale={locale} card={card} state={state} versus={versus} />
              </li>
            ))}
            <li className="shrink-0">
              <Link
                href={`/${locale}/competition/${competition}`}
                className="flex h-11 items-center gap-1 px-2 text-sm font-bold whitespace-nowrap text-accent hover:underline"
                data-testid="rail-open"
              >
                <MessageText message={open} />
                <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                  →
                </span>
              </Link>
            </li>
          </ScrollRow>
        </LiveStripAge>
      </div>
    </nav>
  );
}

/** Persian and Arabic draw their digits in the interface face; Geist Mono has none. */
const ARABIC_SCRIPT = new Set(['fa', 'ar']);

/**
 * One score chip: 44px, radius 10, white in both themes. Status first, then
 * the home side, the score or "v", the away side, laid from the inline start,
 * so on `/fa` the home team is on the right with its goals beside it, the
 * pair isolated in the page's direction (`ScorePair`, D-193).
 */
export function ScoreChip({
  locale,
  card,
  state,
  versus,
}: {
  locale: string;
  card: ScoreCard;
  state: ChipState;
  versus: Message;
}) {
  const name = (team: ScoreCard['home']) => team.short_name ?? team.name;
  const goals = 'font-sans text-xl leading-none font-black font-stretch-condensed tabular-nums';
  return (
    <Link
      href={`/${locale}/match/${card.id}`}
      data-testid="strip-chip"
      data-kind={state.kind}
      className="flex h-11 items-center gap-2 rounded-control border border-default bg-surface px-3 whitespace-nowrap text-fg hover:border-strong"
    >
      <ChipStatus locale={locale} card={card} state={state} />
      <EntityImage media={card.home.crest} kind="crest" name={card.home.name} size={20} />
      <bdi className="text-sm font-semibold" data-testid="strip-home">
        {name(card.home)}
      </bdi>
      {state.score === null ? (
        <span className="px-0.5 text-sm text-caption">
          <MessageText message={versus} />
        </span>
      ) : (
        <ScorePair locale={locale} className="inline-flex items-center gap-1" testId="strip-score">
          <b className={goals}>{formatNumber(locale, state.score.home)}</b>
          <span className="text-sm text-caption">–</span>
          <b className={goals}>{formatNumber(locale, state.score.away)}</b>
        </ScorePair>
      )}
      <bdi className="text-sm font-semibold" data-testid="strip-away">
        {name(card.away)}
      </bdi>
      <EntityImage media={card.away.crest} kind="crest" name={card.away.name} size={20} />
    </Link>
  );
}

function ChipStatus({
  locale,
  card,
  state,
}: {
  locale: string;
  card: ScoreCard;
  state: ChipState;
}) {
  switch (state.kind) {
    case 'before':
      return (
        <time
          dateTime={card.kickoff_at}
          className={`text-xs text-caption ${ARABIC_SCRIPT.has(locale) ? 'font-sans' : 'font-mono'}`}
          data-testid="strip-status"
        >
          {state.status}
        </time>
      );
    case 'live':
      // Once the drawer's answer has aged (`LiveStripAge` marks the row
      // `data-behind`), "Behind" stands in place of a minute it can no longer
      // vouch for (T-1635, rule 4); a newer answer brings the minute back.
      return (
        <>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-bold text-live group-data-[behind=true]/fresh:hidden"
            data-testid="strip-status"
          >
            <span aria-hidden="true" className="live-dot size-[7px] rounded-full bg-live" />
            <LtrNumeric>{state.status}</LtrNumeric>
          </span>
          {state.behindStatus !== undefined && (
            <span
              className="hidden text-xs font-bold text-warning group-data-[behind=true]/fresh:inline"
              data-testid="strip-status-behind"
            >
              {state.behindStatus}
            </span>
          )}
        </>
      );
    case 'behind':
      return (
        <span className="text-xs font-bold text-warning" data-testid="strip-status">
          {state.status}
        </span>
      );
    case 'final':
    case 'off':
      return (
        <span
          className="text-xs font-bold tracking-wide text-caption uppercase"
          data-testid="strip-status"
        >
          {state.status}
        </span>
      );
  }
}
