'use client';

import type { ScoresResponse } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { useEffect, useState } from 'react';
import { EntityImage } from '@/components/entity-image';
import { ScoreCard } from '@/components/score-card';
import { scoresAnnouncements } from '@/lib/announce';
import { FreshnessStamp } from '@/components/freshness-stamp';
import { useLite } from '@/components/lite-mode';
import { INITIAL_CLOCK, type LiveClock, liveLabel, liveState, staleAfterMs } from '@/lib/live';
import { openLiveSource } from '@/lib/live-source';
import type { CardForecast } from '@/lib/score-card-products';
import { blockUpdatedLabel, formatKickoff } from '@/lib/scores';
import {
  applyFilters,
  isFiltered,
  onlyUnpicked,
  type ScoresFilterSelection,
} from '@/lib/scores-filters';
import { withLocale } from '@/lib/locale-query';
import type { ScoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';

/**
 * A block's heading stays at the top of the screen while its matches scroll
 * under it (T-605), on the block's own surface so nothing shows through.
 */
const HEADING =
  'sticky top-0 z-10 flex min-h-11 min-w-0 flex-wrap items-center gap-x-2.5 border-b border-default bg-surface px-4 py-1.5 text-sm font-extrabold';
/**
 * One card per block (T-1496, the canvas's competition groups), a hairline
 * between rows. `overflow-clip`, not `hidden`, so the sticky heading still sticks.
 */
const BLOCK = 'flex flex-col overflow-clip rounded-xl border border-default bg-surface';
const LIST = 'flex flex-col divide-y divide-default';

/** When this block's cards last changed, once for the block (rule 4). */
function Updated({
  cards,
  locale,
  timeZone,
  now,
  words,
}: {
  cards: Parameters<typeof blockUpdatedLabel>[0];
  locale: string;
  timeZone: string;
  now: number;
  words: ScoresWords;
}) {
  const label = blockUpdatedLabel(cards, locale, timeZone, words.m, now);
  return label === null ? null : (
    <span className="ms-auto text-xs font-normal text-muted" data-testid="block-updated">
      {label}
    </span>
  );
}

/**
 * The scores list that stays current (T-032). Renders the server's snapshot
 * first, then subscribes to the web app's own `/api/scores/stream` (the
 * browser never talks to the API, D-027). Every event replaces the whole
 * picture: the server sends full snapshots, so a reconnect can never leave a
 * stale card in place. The freshness line says exactly what is known.
 * The page's country / competition / stage filters (T-633) are applied to
 * every snapshot here, so the stream stays the same question for everyone
 * looking at the day.
 */
export function LiveScores({
  initial,
  streamQuery,
  timeZone,
  locale,
  filters,
  clearFiltersHref,
  forecasts,
  unpicked = false,
  live = false,
  picked = [],
  selected = null,
  pickBase,
  words,
}: {
  initial: ScoresResponse;
  streamQuery: string;
  timeZone: string;
  locale: string;
  filters: ScoresFilterSelection;
  /** The same day with the country / competition / stage filters removed. */
  clearFiltersHref: string;
  /**
   * The model's line for each card (T-940), loaded once with the page in
   * batches. The stream carries scores only; a match it adds later says its
   * line was not loaded. The community's and the viewing line are the
   * preview's (T-1496).
   */
  forecasts: Record<string, CardForecast>;
  /** "Not picked yet" (T-1496): only matches still open that the member has not picked. */
  unpicked?: boolean;
  /** The Live view (`?live=1`): an empty answer means nothing is in play (T-1545). */
  live?: boolean;
  /** The member's picked matches on this day. */
  picked?: readonly string[];
  /** The match whose preview is open. */
  selected?: string | null;
  /**
   * This page's address without a preview open, which each row's Pick extends
   * with `pick=`. Absent: the rows have no Pick.
   */
  pickBase?: string;
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: ScoresWords;
}) {
  const [scores, setScores] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // What the last snapshot changed, in words, for the polite live region (T-081).
  const [announcement, setAnnouncement] = useState('');
  const filterKey = JSON.stringify(filters);
  // Lite mode (T-1387): a snapshot a minute rather than an open stream.
  const { on: lite } = useLite();

  useEffect(() => {
    // Keyed on the selection's value, not the object, so a re-render with the
    // same filters never reopens the stream.
    const selection = JSON.parse(filterKey) as ScoresFilterSelection;
    const stamp = (snapshot: boolean): void =>
      setClock((c) => ({
        lastEventAt: Date.now(),
        lastSnapshotAt: snapshot ? Date.now() : c.lastSnapshotAt,
        broken: false,
      }));
    // The reader's names in every snapshot, as on the server-rendered page (T-1312).
    const stop = openLiveSource(
      withLocale(`/api/scores/stream?${streamQuery}`, locale),
      lite,
      (source) => {
        source.addEventListener('snapshot', (event) => {
          const next = JSON.parse((event as MessageEvent<string>).data) as ScoresResponse;
          setScores((previous) => {
            const said = scoresAnnouncements(
              applyFilters(previous, selection),
              applyFilters(next, selection),
              words,
            );
            if (said.length > 0) setAnnouncement(said.join(' '));
            return next;
          });
          stamp(true);
        });
        source.addEventListener('heartbeat', () => stamp(false));
        source.addEventListener('stale', () => setClock((c) => ({ ...c, broken: true })));
        source.onerror = () => setClock((c) => ({ ...c, broken: true }));
        source.onopen = () => setClock((c) => ({ ...c, broken: false }));
      },
    );
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(tick);
      stop();
    };
  }, [streamQuery, filterKey, words, locale, lite]);

  const staleAfter = staleAfterMs(lite);
  const state = liveState(clock, now, staleAfter);
  const pickedSet = new Set(picked);
  const filtered = applyFilters(scores, filters);
  const shown = unpicked ? onlyUnpicked(filtered, pickedSet, now) : filtered;
  const pickHref = (id: string): string | undefined =>
    pickBase === undefined
      ? undefined
      : `${pickBase}${pickBase.includes('?') ? '&' : '?'}pick=${id}#pick`;
  const row = (card: (typeof shown.groups)[number]['fixtures'][number], pinned: boolean) => (
    <ScoreCard
      key={card.id}
      card={card}
      timeZone={timeZone}
      locale={locale}
      now={now}
      showCompetition={pinned}
      forecast={forecasts[card.id]}
      picked={pickedSet.has(card.id)}
      selected={card.id === selected}
      pickHref={pickHref(card.id)}
      words={words}
    />
  );

  return (
    <>
      <p
        className={`text-xs ${
          state === 'live'
            ? 'text-muted'
            : state === 'connecting'
              ? 'font-medium'
              : 'font-medium text-warning'
        }`}
        data-testid="live-state"
        data-state={state}
        role={state === 'stale' || state === 'unavailable' ? 'status' : undefined}
      >
        {(state === 'live' || state === 'stale') && clock.lastEventAt !== null ? (
          // The freshness stamp (T-1388), the same one the match centre shows.
          <FreshnessStamp
            checkedAt={clock.lastEventAt}
            now={now}
            staleAfterMs={staleAfter}
            behind={state === 'stale'}
            locale={locale}
            words={words.m}
          />
        ) : (
          liveLabel(state, clock, locale, timeZone, words.m)
        )}
      </p>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-announcements"
      >
        {announcement}
      </div>

      {scores.total === 0 ? (
        // The Live view says nothing is in play, not that the day has no match (T-1545).
        <p className="text-muted" data-testid="scores-empty" data-view={live ? 'live' : 'all'}>
          <MessageText message={words.m[live ? 'scores.liveEmpty' : 'scores.empty']} />
        </p>
      ) : shown.total === 0 && unpicked ? (
        <p data-testid="scores-unpicked-empty">
          <MessageText message={words.m['scores.unpickedEmpty']} />
        </p>
      ) : shown.total === 0 && isFiltered(filters) ? (
        <p data-testid="scores-filtered-empty">
          <MessageText message={words.m['scores.filteredEmpty']} />{' '}
          <Link href={clearFiltersHref} className="underline" data-testid="clear-filters">
            <MessageText message={words.m['scores.filter.clear']} />
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.pinned.length > 0 && (
            <section className={BLOCK} data-testid="pinned">
              <div className={HEADING}>
                <h2>
                  <MessageText message={words.m['scores.favourites']} />
                </h2>
                <Updated
                  cards={shown.pinned}
                  locale={locale}
                  timeZone={timeZone}
                  now={now}
                  words={words}
                />
              </div>
              <ul className={LIST}>{shown.pinned.map((card) => row(card, true))}</ul>
            </section>
          )}
          {shown.groups.map((group) => (
            <section key={group.competition.id} className={BLOCK} data-testid="competition-group">
              <div className={HEADING}>
                <h2 className="flex min-w-0 flex-wrap items-center gap-x-2.5">
                  <Link
                    href={`/${locale}/competition/${group.competition.id}`}
                    className="flex min-h-11 min-w-0 items-center gap-2.5 hover:underline"
                    data-testid="competition-link"
                  >
                    <EntityImage
                      media={group.competition.logo}
                      kind="logo"
                      name={group.competition.name}
                      size={20}
                    />
                    <bdi className="truncate">{group.competition.name}</bdi>
                  </Link>
                  {group.country !== null && (
                    <span className="shrink-0 text-xs font-medium text-muted">
                      {group.country.name}
                    </span>
                  )}
                </h2>
                <Updated
                  cards={group.fixtures}
                  locale={locale}
                  timeZone={timeZone}
                  now={now}
                  words={words}
                />
              </div>
              <ul className={LIST}>{group.fixtures.map((card) => row(card, false))}</ul>
            </section>
          ))}
          <p dir="auto" className="text-xs text-muted">
            <FilledMessage
              message={words.m['scores.loadedAt']}
              params={{
                time: (
                  <time dateTime={scores.generated_at}>
                    {formatKickoff(locale, scores.generated_at, timeZone)}
                  </time>
                ),
              }}
            />
          </p>
        </div>
      )}
    </>
  );
}
