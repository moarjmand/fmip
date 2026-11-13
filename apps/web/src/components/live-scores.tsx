'use client';

import type { ScoresResponse } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { type ReactNode, useEffect, useState } from 'react';
import { GROUP_BLOCK, GROUP_HEADING, GROUP_LIST, GroupTitle } from '@/components/match-group';
import { ScoreCard } from '@/components/score-card';
import { scoresAnnouncements } from '@/lib/announce';
import { FreshnessStamp } from '@/components/freshness-stamp';
import { useLite } from '@/components/lite-mode';
import {
  INITIAL_CLOCK,
  type LiveClock,
  isBehind,
  liveLabel,
  liveState,
  staleAfterMs,
} from '@/lib/live';
import { openLiveSource } from '@/lib/live-source';
import { signalLiveMoved } from '@/lib/live-signal';
import type { CardForecast } from '@/lib/score-card-products';
import { anyInPlay, blockUpdatedLabel, formatKickoff, formatStamp } from '@/lib/scores';
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
 * When this block's cards last changed, once for the block (rule 4), beside
 * the competition's name when the heading has room (T-1777, D-385). A block
 * with a match behind (T-083) says so in the warning colour as well as on
 * the row, so the stamp over it never reads as current.
 */
function Updated({
  cards,
  locale,
  timeZone,
  now,
  words,
}: {
  cards: ScoresResponse['pinned'];
  locale: string;
  timeZone: string;
  now: number;
  words: ScoresWords;
}) {
  const label = blockUpdatedLabel(cards, locale, timeZone, words.m, now);
  const behind = cards.some((card) => isBehind(card, now));
  return label === null ? null : (
    <span
      className={`ms-auto py-1 text-xs ${behind ? 'font-medium text-warning' : 'font-normal text-muted'}`}
      data-testid="block-updated"
      data-behind={behind ? '' : undefined}
    >
      {label}
    </span>
  );
}

/**
 * "Checked 03:55" (T-1778, D-385): the title row's stamp while nothing listed
 * is in play -- a clock reading in the machine-fact face, no dot and no
 * ticking age, as the match page says it before kick-off (D-364). It says
 * its day when that is not today (`formatStamp`, T-1371).
 */
function CheckedAt({
  at,
  locale,
  timeZone,
  now,
  words,
}: {
  at: number;
  locale: string;
  timeZone: string;
  now: number;
  words: ScoresWords;
}) {
  if (Number.isNaN(at)) return null;
  const iso = new Date(at).toISOString();
  return (
    <span
      className="font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
      data-testid="checked-at"
    >
      <FilledMessage
        message={words.m['scores.checkedAt']}
        params={{ time: <time dateTime={iso}>{formatStamp(locale, iso, timeZone, now)}</time> }}
      />
    </span>
  );
}

/** The page's next kick-off, as the list needs it to know when its frame stops holding. */
export type LiveNextMark = { id: string; kickoff_at: string };

/**
 * Whether the page's server-drawn next kick-off still holds (T-1779, D-386,
 * rule 4): its kick-off is still to come and the stream has not carried the
 * match. The frame is never redrawn, so on a page left open it would
 * otherwise come back, hours on, offering a match that started (or ended)
 * as next, Pick open.
 */
export function liveNextHolds(mark: LiveNextMark, now: number, carried: string | null): boolean {
  return carried !== mark.id && now < Date.parse(mark.kickoff_at);
}

/** Whether a snapshot carries this match in any state but scheduled. */
export function carriesStarted(snapshot: ScoresResponse, id: string): boolean {
  return [...snapshot.pinned, ...snapshot.groups.flatMap((g) => g.fixtures)].some(
    (card) => card.id === id && card.status !== 'scheduled',
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
  liveEmpty,
  liveEmptyPlain,
  liveEmptyNext,
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
  /**
   * What the Live view says when nothing is in play (T-1779, D-386): the
   * page's server-drawn next kick-off and the way back to the day. Shown
   * while the stream's answer is empty; a match that starts replaces it.
   */
  liveEmpty?: ReactNode;
  /**
   * The same without the next row (the sentence and the way back to the
   * day), shown instead once `liveEmptyNext` no longer holds.
   */
  liveEmptyPlain?: ReactNode;
  /** The match `liveEmpty` names as next, if it names one. */
  liveEmptyNext?: LiveNextMark;
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: ScoresWords;
}) {
  const [scores, setScores] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // The next kick-off the stream has carried as started, if any (T-1779).
  const [carried, setCarried] = useState<string | null>(null);
  const nextId = liveEmptyNext?.id;
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
          if (nextId !== undefined && carriesStarted(next, nextId)) setCarried(nextId);
          setScores((previous) => {
            const said = scoresAnnouncements(
              applyFilters(previous, selection),
              applyFilters(next, selection),
              words,
            );
            if (said.length > 0) {
              setAnnouncement(said.join(' '));
              // The matchday rail over the page asks for its scores now (T-1635).
              signalLiveMoved();
            }
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
  }, [streamQuery, filterKey, words, locale, lite, nextId]);

  const staleAfter = staleAfterMs(lite);
  const state = liveState(clock, now, staleAfter);
  const pickedSet = new Set(picked);
  const filtered = applyFilters(scores, filters);
  const shown = unpicked ? onlyUnpicked(filtered, pickedSet, now) : filtered;
  // The ticking age and its dot only while a listed match is in play (T-1778,
  // D-385, D-364's rule for the match page); otherwise a clock reading.
  const inPlay = anyInPlay([...shown.pinned, ...shown.groups.flatMap((g) => g.fixtures)]);
  const calm = !inPlay && (state === 'live' || state === 'connecting');
  // The Live view's frame while nothing is in play, plain once its next
  // kick-off has passed or started (rule 4).
  const emptyFrame =
    liveEmptyNext === undefined || liveNextHolds(liveEmptyNext, now, carried)
      ? liveEmpty
      : liveEmptyPlain;
  const pickHref = (id: string): string | undefined =>
    pickBase === undefined
      ? undefined
      : // The fragment is the row's own anchor (T-1738): the sheet or the panel
        // opens without the list moving, and without JavaScript the page
        // comes back at the row that asked.
        `${pickBase}${pickBase.includes('?') ? '&' : '?'}pick=${id}#m-${id}`;
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
        // `scores-stamp`: on a phone it stands in the title row (globals.css, T-1757).
        className={`scores-stamp text-xs ${
          calm || state === 'live'
            ? 'text-muted'
            : state === 'connecting'
              ? 'font-medium'
              : 'font-medium text-warning'
        }`}
        data-testid="live-state"
        data-state={state}
        data-in-play={inPlay ? '' : undefined}
        role={state === 'stale' || state === 'unavailable' ? 'status' : undefined}
      >
        {calm ? (
          // Nothing in play: when the list last heard from the feed, or until
          // the stream answers, when the page's own list was made. A broken
          // or stale stream still says so below, in the warning colour.
          <CheckedAt
            at={clock.lastEventAt ?? Date.parse(scores.generated_at)}
            locale={locale}
            timeZone={timeZone}
            now={now}
            words={words}
          />
        ) : (state === 'live' || state === 'stale') && clock.lastEventAt !== null ? (
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
        live && emptyFrame !== undefined ? (
          // The next kick-off and the way back to the day (T-1779, D-386).
          emptyFrame
        ) : (
          // The Live view says nothing is in play, not that the day has no match (T-1545).
          <p className="text-muted" data-testid="scores-empty" data-view={live ? 'live' : 'all'}>
            <MessageText message={words.m[live ? 'scores.liveEmpty' : 'scores.empty']} />
          </p>
        )
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
            <section className={GROUP_BLOCK} data-testid="pinned">
              <div className={GROUP_HEADING}>
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
              <ul className={GROUP_LIST}>{shown.pinned.map((card) => row(card, true))}</ul>
            </section>
          )}
          {shown.groups.map((group) => (
            <section
              key={group.competition.id}
              className={GROUP_BLOCK}
              data-testid="competition-group"
            >
              <div className={GROUP_HEADING}>
                <GroupTitle
                  locale={locale}
                  competition={group.competition}
                  country={group.country}
                />
                <Updated
                  cards={group.fixtures}
                  locale={locale}
                  timeZone={timeZone}
                  now={now}
                  words={words}
                />
              </div>
              <ul className={GROUP_LIST}>{group.fixtures.map((card) => row(card, false))}</ul>
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
