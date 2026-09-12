'use client';

import type { ScoresResponse } from '@fmip/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScoreCard } from '@/components/score-card';
import { scoresAnnouncements } from '@/lib/announce';
import { INITIAL_CLOCK, type LiveClock, liveLabel, liveState } from '@/lib/live';

/**
 * The scores list that stays current (T-032). Renders the server's snapshot
 * first, then subscribes to the web app's own `/api/scores/stream` (the
 * browser never talks to the API, D-027). Every event replaces the whole
 * picture: the server sends full snapshots, so a reconnect can never leave a
 * stale card in place. The freshness line says exactly what is known.
 */
export function LiveScores({
  initial,
  streamQuery,
  timeZone,
  locale,
}: {
  initial: ScoresResponse;
  streamQuery: string;
  timeZone: string;
  locale: string;
}) {
  const [scores, setScores] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // What the last snapshot changed, in words, for the polite live region (T-081).
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const source = new EventSource(`/api/scores/stream?${streamQuery}`);
    const stamp = (snapshot: boolean): void =>
      setClock((c) => ({
        lastEventAt: Date.now(),
        lastSnapshotAt: snapshot ? Date.now() : c.lastSnapshotAt,
        broken: false,
      }));
    source.addEventListener('snapshot', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as ScoresResponse;
      setScores((previous) => {
        const said = scoresAnnouncements(previous, next);
        if (said.length > 0) setAnnouncement(said.join(' '));
        return next;
      });
      stamp(true);
    });
    source.addEventListener('heartbeat', () => stamp(false));
    source.addEventListener('stale', () => setClock((c) => ({ ...c, broken: true })));
    source.onerror = () => setClock((c) => ({ ...c, broken: true }));
    source.onopen = () => setClock((c) => ({ ...c, broken: false }));
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(tick);
      source.close();
    };
  }, [streamQuery]);

  const state = liveState(clock, now);

  return (
    <>
      <p
        className={`text-xs ${state === 'live' ? 'opacity-70' : 'font-medium'}`}
        data-testid="live-state"
        data-state={state}
        role={state === 'stale' || state === 'unavailable' ? 'status' : undefined}
      >
        {liveLabel(state, clock, timeZone)}
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
        <p className="opacity-70" data-testid="scores-empty">
          No fixtures on this day.
        </p>
      ) : (
        <>
          {scores.pinned.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="pinned">
              <h2 className="text-lg font-semibold">Your favourites</h2>
              <ul className="flex flex-col gap-2">
                {scores.pinned.map((card) => (
                  <ScoreCard
                    key={card.id}
                    card={card}
                    timeZone={timeZone}
                    locale={locale}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          )}
          {scores.groups.map((group) => (
            <section
              key={group.competition.id}
              className="flex flex-col gap-2"
              data-testid="competition-group"
            >
              <h2 className="text-lg font-semibold">
                {group.country !== null && (
                  <span className="me-2 text-sm font-normal uppercase opacity-60">
                    {group.country.name}
                  </span>
                )}
                <Link
                  href={`/${locale}/competition/${group.competition.id}`}
                  className="underline"
                  data-testid="competition-link"
                >
                  {group.competition.name}
                </Link>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.fixtures.map((card) => (
                  <ScoreCard
                    key={card.id}
                    card={card}
                    timeZone={timeZone}
                    locale={locale}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs opacity-60">
            Snapshot <time dateTime={scores.generated_at}>{scores.generated_at}</time>.
          </p>
        </>
      )}
    </>
  );
}
