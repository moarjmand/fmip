import type { MatchCentre } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { isBehind } from '@/lib/live';
import { resultLine, statusLabel } from '@/lib/scores';
import type { MatchWords } from '@/lib/words-server';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import { Score, ScorePair } from '@/components/score';
import { cx } from '@/components/ui/cx';
import { LiveBadge } from '@/components/ui/live-badge';

type Fixture = MatchCentre['fixture'];

/**
 * What the score band says about the match, read once per render (T-1742,
 * D-363): the big band and the compact bar are both drawn from this, so the
 * two can never disagree about the score, the minute or whether the feed is
 * behind (rule 4).
 */
export interface BandState {
  /** The goals shown: the result once finished, else the current score; none supplied is `null`. */
  headline: Fixture['scores']['current'];
  /** The status cell's words: the kick-off time, the minute, "HT", "FT", "Behind". */
  status: string;
  /** In play and the data current: the only state drawn as live. */
  live: boolean;
  /** In play, the data older than the live threshold (D-045). */
  behind: boolean;
  /** Scheduled, the kick-off long past and no word from the feed (D-343). */
  awaiting: boolean;
  /** Finished, the recorded goals disagreeing with the result (D-347). */
  disputed: boolean;
  /**
   * Finished on penalties, the side with more shoot-out goals (T-1798,
   * D-396); `null` with no shoot-out, or one whose score names no winner.
   */
  won: 'home' | 'away' | null;
}

export function bandState(
  f: Fixture,
  hero: { awaiting?: unknown; disputed?: unknown },
  at: { locale: string; timeZone: string; now: number | undefined; words: MatchWords },
): BandState {
  const m = at.words.m;
  const behind = at.now !== undefined && isBehind(f, at.now);
  const pens = f.scores.penalties;
  return {
    headline: f.status === 'finished' ? resultLine(f.scores) : f.scores.current,
    // At the half-time interval the feed's minute stays at 45: the band says
    // "HT" rather than a clock that looks stalled (T-1551). A feed that has
    // fallen behind keeps its own words (rule 4).
    status:
      f.status === 'live' && f.at_half_time === true && !behind
        ? m['status.halfTime'].text
        : statusLabel(f, at.locale, at.timeZone, at.now, m),
    live: f.status === 'live' && !behind,
    behind,
    // Once a snapshot brings another status, the server's notice goes.
    awaiting: f.status === 'scheduled' && hero.awaiting != null,
    disputed: f.status === 'finished' && hero.disputed != null,
    won:
      f.status !== 'finished' || pens === null || pens.home === pens.away
        ? null
        : pens.home > pens.away
          ? 'home'
          : 'away',
  };
}

/** The surface across the page with a hairline under it, as the band draws itself. */
export const BLEED =
  '[box-shadow:0_0_0_100vmax_var(--token-surface),0_1px_0_100vmax_var(--token-border)] [clip-path:inset(0_-100vmax_-1px)]';

/**
 * The compact score bar (T-1742, D-363; boards P2-1a and P2-1b): 48px, the
 * match in one line once the big band has scrolled away -- "20:00 · Everton v
 * Coventry" before kick-off, "Palmeiras 2–0 Remo · ● Live · 14′" in play,
 * "Wrexham 2–0 Middlesbrough · FT" after. It sits directly above the sticky
 * tab row (absolutely placed in the same sticky box, so it takes no height
 * in the page) and is not drawn until the band has left the screen:
 * `globals.css` reveals it with a scroll-driven animation on the band's view
 * timeline, and a browser without one never shows it.
 *
 * Drawn from the same `BandState` and in the same render as the band, so a
 * live snapshot moves both at once (rule 4); a feed that is behind is amber
 * words here too, never the live badge. So is a live stream that has broken
 * (`stale`): the band says so in its own line, which has scrolled away by
 * the time this bar shows, so the bar does not go on saying "Live" over a
 * score nobody is updating. No club colour and no link: the bar repeats the
 * band, it is not a second header.
 *
 * `aria-hidden`: the band above is the page's heading and already says every
 * word of this, and score changes are announced by the live region; a region
 * that entered and left the accessibility tree with the scroll position
 * would only say the match twice. It holds nothing focusable.
 */
export function ScoreBar({
  fixture: f,
  state,
  stale = false,
  locale,
  words,
}: {
  fixture: Fixture;
  state: BandState;
  /** In play, and the page's live stream is stale or unreachable (rule 4). */
  stale?: boolean;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const live = state.live && !stale;
  const behind = state.behind || (state.live && stale);
  const n = (value: number): string => formatNumber(locale, value);
  const coming = f.status === 'scheduled' && !state.awaiting;
  // A long name gives way before the score or the status does: onto a second
  // line on a narrow screen (the bar holds two), and only then an ellipsis.
  const side = (team: Fixture['home'], crestFirst: boolean, won = false) => {
    const crest = (
      <span className="shrink-0">
        <EntityImage media={team.crest} kind="crest" name={team.name} size={20} />
      </span>
    );
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {crestFirst && crest}
        {/* The shoot-out's winner (T-1798): a tick, its words on hover. */}
        {won && (
          <span
            className="shrink-0 font-extrabold text-accent"
            title={m['matchCentre.wonOnPenalties'].text}
          >
            ✓
          </span>
        )}
        <bdi className="line-clamp-2 min-w-0 leading-4 font-bold [overflow-wrap:anywhere]">
          {team.name}
        </bdi>
        {!crestFirst && crest}
      </span>
    );
  };
  const versus = (
    <span className="shrink-0 font-medium text-muted">
      <MessageText message={m['home.versus']} />
    </span>
  );
  return (
    <div
      aria-hidden="true"
      className={cx(
        'absolute inset-x-0 bottom-full flex h-12 items-center justify-center gap-2 bg-surface text-sm text-fg',
        BLEED,
      )}
      data-score-bar=""
      data-state={coming ? 'scheduled' : live ? 'live' : behind ? 'behind' : f.status}
      data-testid="score-bar"
    >
      {coming ? (
        <>
          {/* Before kick-off the figure is the kick-off time, never a 0-0. */}
          <span className="shrink-0 font-extrabold tabular-nums">{state.status}</span>
          <span className="shrink-0 text-caption">·</span>
          {side(f.home, true)}
          {versus}
          {side(f.away, true)}
        </>
      ) : (
        <>
          {side(f.home, true, state.won === 'home')}
          {state.headline === null ? (
            // No score supplied: none, rather than a 0-0 (rule 3).
            f.status === 'live' ? (
              <span className="shrink-0 font-extrabold">–</span>
            ) : (
              versus
            )
          ) : (
            <ScorePair
              locale={locale}
              className={cx(
                'shrink-0 text-base font-extrabold tabular-nums',
                live && 'text-live',
                state.disputed && 'text-muted',
              )}
            >
              {n(state.headline.home)}–{n(state.headline.away)}
            </ScorePair>
          )}
          {side(f.away, false, state.won === 'away')}
          {live ? (
            <LiveBadge
              className="shrink-0"
              label={
                state.status !== m['status.live'].text ? (
                  <MessageText message={m['status.live']} />
                ) : undefined
              }
            >
              {state.status}
            </LiveBadge>
          ) : (
            <span
              className={cx(
                'shrink-0 text-xs font-bold',
                // Behind, or the kick-off long past: amber words, as in the band.
                behind || state.awaiting ? 'text-warning' : 'text-muted',
              )}
            >
              {state.status}
              {f.status === 'finished' && f.scores.penalties !== null && (
                <>
                  {' '}
                  <Score
                    home={f.scores.penalties.home}
                    away={f.scores.penalties.away}
                    locale={locale}
                  />
                </>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
