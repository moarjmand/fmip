'use client';

import type { MatchCentre } from '@fmip/contracts';
import { useEffect, useState } from 'react';
import { MatchCentreView } from '@/components/match-centre-view';
import { INITIAL_CLOCK, type LiveClock, liveLabel, liveState } from '@/lib/live';

/**
 * The match centre that stays current (T-032, T-034): renders the server's
 * snapshot, then subscribes to the web app's `/api/fixtures/:id/stream` and
 * replaces the whole payload on every `snapshot`. The freshness line is the
 * same one the scores page uses.
 */
export function LiveMatch({
  initial,
  timeZone,
  forecast,
}: {
  initial: MatchCentre;
  timeZone: string;
  /** The forecast panel, rendered by the server (T-065); forecasts change rarely. */
  forecast: React.ReactNode;
}) {
  const [centre, setCentre] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  const id = initial.fixture.id;

  useEffect(() => {
    const source = new EventSource(`/api/fixtures/${id}/stream`);
    const stamp = (snapshot: boolean): void =>
      setClock((c) => ({
        lastEventAt: Date.now(),
        lastSnapshotAt: snapshot ? Date.now() : c.lastSnapshotAt,
        broken: false,
      }));
    source.addEventListener('snapshot', (event) => {
      setCentre(JSON.parse((event as MessageEvent<string>).data) as MatchCentre);
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
  }, [id]);

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
      <MatchCentreView centre={centre} timeZone={timeZone} />
      {forecast}
    </>
  );
}
